#!/usr/bin/env node
/**
 * Machine-wide Semble MCP HTTP singleton (Windows-friendly).
 *
 * Official Semble is stdio-only. We keep ONE long-lived process:
 *   start-gateway.cmd → supergateway → uvx semble[mcp]
 * exposed at http://127.0.0.1:9131/mcp
 *
 * No nested Node "daemon job" on Windows (those get torn down with ensure).
 * Lifecycle = Start-Process for start-gateway.cmd + port probe.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(SCRIPT_PATH);
const LOG_DIR = path.join(ROOT_DIR, 'logs');
const LOCK_DIR = path.join(ROOT_DIR, 'locks');
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 9131;
const DEFAULT_TIMEOUT_MS = 90000;
const START_GATEWAY = path.join(ROOT_DIR, 'start-gateway.cmd');
const SLUG = 'semble-global';

function usage() {
  console.error(
    [
      'Usage:',
      '  node semble-http-singleton.mjs ensure [--port 9131]',
      '  node semble-http-singleton.mjs status [--port 9131]',
      '  node semble-http-singleton.mjs restart [--port 9131]',
      '  node semble-http-singleton.mjs stop [--port 9131]',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const [command = 'ensure', ...rest] = argv;
  const values = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq !== -1) {
      values[token.slice(2, eq)] = token.slice(eq + 1);
    } else {
      const next = rest[index + 1];
      if (!next || next.startsWith('--')) values[token.slice(2)] = true;
      else {
        values[token.slice(2)] = next;
        index += 1;
      }
    }
  }
  return values;
}

function configFromArgs(args) {
  const port = Number(args.port || process.env.SEMBLE_HTTP_SINGLETON_PORT || DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${args.port}`);
  }
  return {
    command: args.command,
    host: args.host || process.env.SEMBLE_HTTP_SINGLETON_HOST || DEFAULT_HOST,
    port,
    timeoutMs: Number(args.timeout || DEFAULT_TIMEOUT_MS),
  };
}

function endpoint(config) {
  return `http://${config.host}:${config.port}/mcp`;
}

function pathsFor(config) {
  return {
    lock: path.join(LOCK_DIR, `${SLUG}-${config.port}.lock`),
    log: path.join(LOG_DIR, `${SLUG}-${config.port}.log`),
    state: path.join(ROOT_DIR, `${SLUG}-${config.port}.json`),
    supervisorLog: path.join(LOG_DIR, `${SLUG}-${config.port}.supervisor.log`),
  };
}

function ensureDirs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(LOCK_DIR, { recursive: true });
}

function appendLog(file, line) {
  fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`);
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
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
        endpoint: endpoint(config),
        host: config.host,
        port: config.port,
        updatedAt: new Date().toISOString(),
        ...extra,
      },
      null,
      2
    )}\n`
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpRequest(config, options = {}) {
  return new Promise((resolve) => {
    const body = options.body || '';
    const req = http.request(
      endpoint(config),
      {
        headers: options.headers || {},
        method: options.method || 'GET',
        timeout: options.timeoutMs || 1500,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          if (size < 65536) chunks.push(chunk);
          size += chunk.length;
        });
        res.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
            ok: true,
            status: res.statusCode,
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ body: '', headers: {}, ok: false, status: 'timeout' });
    });
    req.on('error', (error) => resolve({ body: '', headers: {}, ok: false, status: error.code || error.message }));
    if (body) req.write(body);
    req.end();
  });
}

async function closeMcpSession(config, sessionId) {
  if (!sessionId) return;
  await httpRequest(config, {
    headers: { 'mcp-session-id': sessionId },
    method: 'DELETE',
    timeoutMs: 1000,
  });
}

async function probe(config, timeoutMs = 8000) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'semble-http-singleton', version: '1.0.0' },
    },
  });
  const response = await httpRequest(config, {
    body,
    headers: {
      accept: 'application/json, text/event-stream',
      'content-length': Buffer.byteLength(body),
      'content-type': 'application/json',
    },
    method: 'POST',
    timeoutMs,
  });
  const sessionId = response.headers?.['mcp-session-id'];
  if (sessionId) closeMcpSession(config, sessionId).catch(() => {});
  if (!response.ok) return { ok: false, status: response.status };
  const respBody = response.body || '';
  const hasMcpResult =
    response.status === 200 &&
    (respBody.includes('"result"') ||
      respBody.includes('serverInfo') ||
      respBody.includes('protocolVersion') ||
      Boolean(sessionId));
  if (response.status === 200 && !respBody.trim() && !sessionId) {
    return { ok: false, status: 'empty-200' };
  }
  return {
    ok: hasMcpResult,
    status: hasMcpResult ? `mcp:${response.status}` : response.status,
  };
}

async function waitForHealth(config, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = { ok: false, status: 'not-started' };
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
    fs.writeFileSync(path.join(lockPath, 'pid'), `${process.pid}\n`);
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

function killPortListeners(port) {
  if (process.platform !== 'win32') return;
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: 'ignore', windowsHide: true, timeout: 20000 }
    );
  } catch {
    // ignore
  }
}

function killSembleTrees() {
  if (process.platform !== 'win32') return;
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ( $_.CommandLine -match 'supergateway' -or $_.CommandLine -match 'run-semble-stdio' -or $_.CommandLine -match 'start-gateway\\.cmd' -or ($_.CommandLine -match 'semble\\[mcp\\]' -and $_.CommandLine -match 'uvx') ) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: 'ignore', windowsHide: true, timeout: 20000 }
    );
  } catch {
    // ignore
  }
}

function startGateway(config, files) {
  if (!fs.existsSync(START_GATEWAY)) {
    throw new Error(`Missing ${START_GATEWAY}`);
  }
  if (process.platform === 'win32') {
    // Independent process tree (survives ensure exit). No nested quotes on path.
    const gw = START_GATEWAY.replace(/'/g, "''");
    const ps = [
      `$p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d','/c','${gw}','${config.port}') -WindowStyle Hidden -PassThru`,
      'Write-Output $p.Id',
    ].join('; ');
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    });
    const pid = Number(String(out).trim().split(/\r?\n/).filter(Boolean).pop());
    appendLog(files.supervisorLog, `Start-Process start-gateway.cmd pid=${pid} port=${config.port}`);
    return Number.isFinite(pid) ? pid : 0;
  }

  const logFd = fs.openSync(files.log, 'a');
  const child = spawn('npx', [
    '-y',
    'supergateway',
    '--stdio',
    path.join(ROOT_DIR, 'run-semble-stdio.cmd'),
    '--outputTransport',
    'streamableHttp',
    '--port',
    String(config.port),
    '--streamableHttpPath',
    '/mcp',
    '--logLevel',
    'info',
    '--cors',
  ], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  child.unref();
  appendLog(files.supervisorLog, `spawned npx supergateway pid=${child.pid}`);
  return child.pid;
}

async function ensure(config) {
  ensureDirs();
  const files = pathsFor(config);

  const current = await probe(config);
  if (current.ok) {
    writeState(files.state, config, { healthy: true, lastStatus: current.status });
    console.error(`[semble-http-singleton] already healthy ${endpoint(config)}`);
    return;
  }

  if (!acquireLock(files.lock)) {
    const health = await waitForHealth(config, Math.min(config.timeoutMs, 30000));
    if (health.ok) {
      console.error(`[semble-http-singleton] healthy after waiting ${endpoint(config)}`);
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

    const gatewayPid = startGateway(config, files);
    writeState(files.state, config, {
      healthy: false,
      gatewayPid,
      startedAt: new Date().toISOString(),
    });

    const health = await waitForHealth(config, config.timeoutMs);
    if (!health.ok) {
      throw new Error(`Semble HTTP did not become healthy at ${endpoint(config)} (${health.status})`);
    }
    writeState(files.state, config, {
      healthy: true,
      lastStatus: health.status,
      lastHealthyAt: new Date().toISOString(),
      gatewayPid,
    });
    console.error(`[semble-http-singleton] started ${endpoint(config)}`);
  } finally {
    releaseLock(files.lock);
  }
}

async function status(config) {
  ensureDirs();
  const files = pathsFor(config);
  const state = readState(files.state);
  const health = await probe(config);
  if (health.ok) {
    writeState(files.state, config, { healthy: true, lastStatus: health.status, lastHealthyAt: new Date().toISOString() });
  }
  console.log(
    JSON.stringify(
      {
        endpoint: endpoint(config),
        healthy: health.ok,
        lastStatus: health.status,
        state: readState(files.state) || state,
      },
      null,
      2
    )
  );
}

function stop(config) {
  ensureDirs();
  const files = pathsFor(config);
  appendLog(files.supervisorLog, `stop requested port=${config.port}`);
  killPortListeners(config.port);
  killSembleTrees();
  writeState(files.state, config, { healthy: false, stoppedAt: new Date().toISOString() });
  console.error(`[semble-http-singleton] stopped ${endpoint(config)}`);
}

async function restart(config) {
  stop(config);
  await sleep(1500);
  return ensure(config);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.command === 'help') {
    usage();
    return;
  }
  const config = configFromArgs(args);
  if (config.command === 'ensure') return ensure(config);
  if (config.command === 'status') return status(config);
  if (config.command === 'restart') return restart(config);
  if (config.command === 'stop') return stop(config);
  // ignore legacy "daemon" invocations
  if (config.command === 'daemon') {
    console.error('[semble-http-singleton] daemon mode removed; use ensure');
    return ensure(config);
  }
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(`[semble-http-singleton] ${err.stack || err.message || err}`);
  process.exit(1);
});
