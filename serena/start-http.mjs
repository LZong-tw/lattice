#!/usr/bin/env node
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";

import { repoRoot } from "../common.mjs";
import {
  getClientPaths,
  isPortListening,
  isProcessAlive,
  readDashboardUrl,
  readPidFile,
  writeDashboardUrlFile,
  wait,
} from "./dashboard-state.mjs";

const requestedClient = process.argv[2];
const spec = getClientPaths(requestedClient);

if (!spec) {
  console.error(`Unknown Serena launcher client: ${requestedClient ?? "(missing)"}`);
  process.exit(1);
}

const client = spec.client;
const repoPidFile = spec.pidFile;
const existingPid = readPidFile(repoPidFile);

if (existingPid !== null && isProcessAlive(existingPid)) {
  console.error(`Serena ${client} launcher already running (PID ${existingPid}).`);
  process.exit(0);
}

if (existingPid !== null && !isProcessAlive(existingPid)) {
  try {
    fs.unlinkSync(repoPidFile);
  } catch {
    // stale pid file; ignore
  }
}

if (await isPortListening(spec.port)) {
  const dashboardUrl = readDashboardUrl(spec.logFile);
  if (dashboardUrl) {
    writeDashboardUrlFile(spec.urlFile, dashboardUrl);
  }

  console.error(`Serena already listening on 127.0.0.1:${spec.port} for ${client}.`);
  process.exit(0);
}

// On Windows, uvx is typically installed as `uvx.cmd` (Scoop/winget/pip).
// Node won't spawn .cmd files without a shell, so use shell:true on win32
// only. POSIX doesn't need it and shell:true changes argument escaping.
const isWindows = process.platform === "win32";

const uvxCheck = spawnSync("uvx", ["--version"], { stdio: "ignore", shell: isWindows });
if (uvxCheck.error) {
  console.error("uvx is required to launch Serena, but it was not found on PATH.");
  process.exit(1);
}

fs.mkdirSync(spec.runtimeRoot, { recursive: true });

const logFd = fs.openSync(spec.logFile, "a");
const args = [
  "--from",
  "git+https://github.com/oraios/serena",
  "serena",
  "start-mcp-server",
  "--transport",
  "streamable-http",
  "--host",
  "127.0.0.1",
  "--port",
  String(spec.port),
  "--context",
  spec.context,
  "--project",
  repoRoot,
  "--open-web-dashboard",
  "false",
];

const child = spawn("uvx", args, {
  cwd: repoRoot,
  detached: true,
  stdio: ["ignore", logFd, logFd],
  env: { ...process.env },
  shell: isWindows,
});

fs.closeSync(logFd);

if (!child.pid) {
  console.error(`Failed to start Serena ${client} launcher.`);
  process.exit(1);
}

fs.writeFileSync(spec.pidFile, String(child.pid), "utf8");
child.unref();

let started = false;
for (let i = 0; i < 12; i += 1) {
  if (await isPortListening(spec.port)) {
    started = true;
    break;
  }

  if (!isProcessAlive(child.pid)) {
    const logTail = fs.readFileSync(spec.logFile, "utf8").split("\n").slice(-40).join("\n");
    try {
      fs.unlinkSync(spec.pidFile);
    } catch {
      // stale pid file; ignore
    }
    console.error(`Serena ${client} exited before the HTTP port became ready.`);
    if (logTail.trim()) {
      console.error(logTail);
    }
    process.exit(1);
  }

  await wait(250);
}

const endpoint = spec.mcpUrl;
let dashboardUrl = readDashboardUrl(spec.logFile);
for (let i = 0; i < 12 && !dashboardUrl; i += 1) {
  await wait(250);
  dashboardUrl = readDashboardUrl(spec.logFile);
}

if (dashboardUrl) {
  writeDashboardUrlFile(spec.urlFile, dashboardUrl);
}

if (started) {
  console.error(`Serena ${client} is ready at ${endpoint} (PID ${child.pid}).`);
} else {
  console.error(`Serena ${client} is starting in the background at ${endpoint} (PID ${child.pid}).`);
}

process.exit(0);
