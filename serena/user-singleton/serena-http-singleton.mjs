#!/usr/bin/env node
/**
 * Per-project Serena HTTP singleton (user-level).
 *
 * Serena natively supports streamable-HTTP. This supervisor keeps one long-lived
 * process per (project, port) under ~/.serena/http-singleton/.
 *
 * Windows: uses Start-Process so the server outlives the ensure parent.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir();
const ROOT_DIR = path.join(HOME, ".serena", "http-singleton");
const LOG_DIR = path.join(ROOT_DIR, "logs");
const LOCK_DIR = path.join(ROOT_DIR, "locks");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_CONTEXT = "claude-code";
const DEFAULT_TIMEOUT_MS = 60000;
const SERENA_FROM = process.env.SERENA_HTTP_SINGLETON_FROM || "serena-agent@latest";

function usage() {
  console.error(
    [
      "Usage:",
      "  node serena-http-singleton.mjs ensure --project <path> --port <port>",
      "  node serena-http-singleton.mjs status --project <path> --port <port>",
      "  node serena-http-singleton.mjs stop --project <path> --port <port>",
      "  node serena-http-singleton.mjs restart --project <path> --port <port>",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const [command = "ensure", ...rest] = argv;
  const values = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq !== -1) {
      values[token.slice(2, eq)] = token.slice(eq + 1);
    } else {
      const next = rest[index + 1];
      if (!next || next.startsWith("--")) values[token.slice(2)] = true;
      else {
        values[token.slice(2)] = next;
        index += 1;
      }
    }
  }
  return values;
}

function hash(value) {
  return crypto.createHash("sha1").update(String(value).toLowerCase()).digest("hex").slice(0, 10);
}

function defaultPort(projectPath) {
  const value = Number.parseInt(hash(path.resolve(projectPath)).slice(0, 6), 16);
  return 18000 + (value % 2000);
}

function configFromArgs(args) {
  const project = path.resolve(args.project || process.env.SERENA_HTTP_SINGLETON_PROJECT || process.cwd());
  const port = Number(args.port || process.env.SERENA_HTTP_SINGLETON_PORT || defaultPort(project));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${args.port}`);
  }
  return {
    command: args.command,
    context: args.context || process.env.SERENA_HTTP_SINGLETON_CONTEXT || DEFAULT_CONTEXT,
    host: args.host || process.env.SERENA_HTTP_SINGLETON_HOST || DEFAULT_HOST,
    port,
    project,
    timeoutMs: Number(args.timeout || DEFAULT_TIMEOUT_MS),
  };
}

function endpoint(config) {
  return `http://${config.host}:${config.port}/mcp`;
}

function slugFor(project, port) {
  const base =
    path.basename(project).replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "") || "project";
  return `${base}-${hash(`${project}:${port}`)}`;
}

function pathsFor(config) {
  const slug = slugFor(config.project, config.port);
  return {
    lock: path.join(LOCK_DIR, `${slug}.lock`),
    log: path.join(LOG_DIR, `${slug}.log`),
    state: path.join(ROOT_DIR, `${slug}.json`),
    supervisorLog: path.join(LOG_DIR, `${slug}.supervisor.log`),
  };
}

function ensureDirs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  fs.mkdirSync(ROOT_DIR, { recursive: true });
}

function appendLog(file, line) {
  fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`);
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeState(file, config, extra = {}) {
  const previous = readState(file) || {};
  fs.writeFileSync(
    file,
    `${JSON.stringify(
      {
        ...previous,
        context: config.context,
        endpoint: endpoint(config),
        host: config.host,
        port: config.port,
        project: config.project,
        serenaFrom: SERENA_FROM,
        updatedAt: new Date().toISOString(),
        ...extra,
      },
      null,
      2,
    )}\n`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpRequest(config, options = {}) {
  return new Promise((resolve) => {
    const body = options.body || "";
    const req = http.request(
      endpoint(config),
      {
        headers: options.headers || {},
        method: options.method || "GET",
        timeout: options.timeoutMs || 1500,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          if (size < 65536) chunks.push(chunk);
          size += chunk.length;
        });
        res.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
            ok: true,
            status: res.statusCode,
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ body: "", headers: {}, ok: false, status: "timeout" });
    });
    req.on("error", (error) =>
      resolve({ body: "", headers: {}, ok: false, status: error.code || error.message }),
    );
    if (body) req.write(body);
    req.end();
  });
}

async function closeMcpSession(config, sessionId) {
  if (!sessionId) return;
  await httpRequest(config, {
    headers: { "mcp-session-id": sessionId },
    method: "DELETE",
    timeoutMs: 1000,
  });
}

async function probe(config, timeoutMs = 5000) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "serena-http-singleton", version: "1.0.0" },
    },
  });
  const response = await httpRequest(config, {
    body,
    headers: {
      accept: "application/json, text/event-stream",
      "content-length": Buffer.byteLength(body),
      "content-type": "application/json",
    },
    method: "POST",
    timeoutMs,
  });
  const sessionId = response.headers?.["mcp-session-id"];
  if (sessionId) closeMcpSession(config, sessionId).catch(() => {});
  if (!response.ok) return { ok: false, status: response.status };
  const respBody = response.body || "";
  const hasMcpResult =
    response.status === 200 &&
    (respBody.includes('"result"') || respBody.includes("serverInfo") || Boolean(sessionId));
  if (response.status === 200 && !respBody.trim() && !sessionId) {
    return { ok: false, status: "empty-200" };
  }
  return {
    ok: hasMcpResult,
    status: hasMcpResult ? `mcp:${response.status}` : response.status,
  };
}

async function waitForHealth(config, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = { ok: false, status: "not-started" };
  while (Date.now() < deadline) {
    last = await probe(config);
    if (last.ok) return last;
    await sleep(750);
  }
  return last;
}

function acquireLock(lockPath) {
  try {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "pid"), `${process.pid}\n`);
    return true;
  } catch {
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > 120000) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        return acquireLock(lockPath);
      }
    } catch {
      return false;
    }
    return false;
  }
}

function releaseLock(lockPath) {
  fs.rmSync(lockPath, { recursive: true, force: true });
}

function serenaUvxArgs(config) {
  return [
    "--from",
    SERENA_FROM,
    "--prerelease",
    "allow",
    "serena",
    "start-mcp-server",
    "--transport",
    "streamable-http",
    "--host",
    config.host,
    "--port",
    String(config.port),
    "--project",
    config.project,
    "--context",
    config.context,
    "--enable-web-dashboard",
    "false",
    "--open-web-dashboard",
    "false",
    "--enable-gui-log-window",
    "false",
  ];
}

function startSerena(config, files) {
  const args = serenaUvxArgs(config);
  appendLog(files.supervisorLog, `starting uvx ${args.join(" ")}`);

  if (process.platform === "win32") {
    // Break out of the ensure job object.
    const argList = args.map((a) => `'${String(a).replace(/'/g, "''")}'`).join(",");
    const ps = [
      `$p = Start-Process -FilePath 'uvx' -ArgumentList @(${argList}) -WindowStyle Hidden -PassThru`,
      "Write-Output $p.Id",
    ].join("; ");
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
      cwd: config.project,
    });
    const pid = Number(String(out).trim().split(/\r?\n/).filter(Boolean).pop());
    appendLog(files.supervisorLog, `Start-Process uvx pid=${pid}`);
    return Number.isFinite(pid) ? pid : 0;
  }

  const logFd = fs.openSync(files.log, "a");
  const child = spawn("uvx", args, {
    cwd: config.project,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

function killPort(port) {
  if (process.platform !== "win32") return;
  try {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: "ignore", windowsHide: true, timeout: 20000 },
    );
  } catch {
    // ignore
  }
}

async function ensure(config) {
  ensureDirs();
  const files = pathsFor(config);
  if (!fs.existsSync(config.project)) {
    throw new Error(`Project path does not exist: ${config.project}`);
  }

  const current = await probe(config);
  if (current.ok) {
    writeState(files.state, config, { healthy: true, lastStatus: current.status });
    console.error(`[serena-http-singleton] already healthy ${endpoint(config)} (${config.project})`);
    return;
  }

  if (!acquireLock(files.lock)) {
    const health = await waitForHealth(config, Math.min(config.timeoutMs, 30000));
    if (health.ok) {
      console.error(`[serena-http-singleton] healthy after waiting ${endpoint(config)}`);
      return;
    }
    throw new Error(`Another ensure is running and ${endpoint(config)} is still not healthy (${health.status})`);
  }

  try {
    const afterLock = await probe(config);
    if (afterLock.ok) {
      writeState(files.state, config, { healthy: true, lastStatus: afterLock.status });
      return;
    }
    const serenaPid = startSerena(config, files);
    writeState(files.state, config, {
      healthy: false,
      serenaPid,
      startedAt: new Date().toISOString(),
    });
    const health = await waitForHealth(config, config.timeoutMs);
    if (!health.ok) {
      throw new Error(`Serena HTTP did not become healthy at ${endpoint(config)} (${health.status})`);
    }
    writeState(files.state, config, {
      healthy: true,
      lastStatus: health.status,
      serenaPid,
      lastHealthyAt: new Date().toISOString(),
    });
    console.error(`[serena-http-singleton] started ${endpoint(config)} (${config.project})`);
  } finally {
    releaseLock(files.lock);
  }
}

async function status(config) {
  ensureDirs();
  const files = pathsFor(config);
  const health = await probe(config);
  if (health.ok) {
    writeState(files.state, config, {
      healthy: true,
      lastStatus: health.status,
      lastHealthyAt: new Date().toISOString(),
    });
  }
  console.log(
    JSON.stringify(
      {
        endpoint: endpoint(config),
        healthy: health.ok,
        lastStatus: health.status,
        project: config.project,
        state: readState(files.state),
      },
      null,
      2,
    ),
  );
}

function stop(config) {
  ensureDirs();
  const files = pathsFor(config);
  killPort(config.port);
  writeState(files.state, config, { healthy: false, stoppedAt: new Date().toISOString() });
  console.error(`[serena-http-singleton] stopped ${endpoint(config)} (${config.project})`);
}

async function restart(config) {
  stop(config);
  await sleep(1000);
  return ensure(config);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.command === "help") {
    usage();
    return;
  }
  const config = configFromArgs(args);
  if (config.command === "ensure") return ensure(config);
  if (config.command === "status") return status(config);
  if (config.command === "stop") return stop(config);
  if (config.command === "restart") return restart(config);
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(`[serena-http-singleton] ${err.stack || err.message || err}`);
  process.exit(1);
});
