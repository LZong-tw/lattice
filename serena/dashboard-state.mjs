import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const serenaDir = path.dirname(__filename);

export const SERENA_CLIENTS = {
  copilot: {
    context: "ide",
    launcher: "start-http-ide.sh",
    port: 9121,
  },
  claude: {
    context: "claude-code",
    launcher: "start-http-claude-code.sh",
    port: 9122,
  },
  codex: {
    context: "codex",
    launcher: "start-http-codex.sh",
    port: 9123,
  },
};

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function stripTrailingPunctuation(value) {
  return value.replace(/[)\],.'"'"'"]+$/, "");
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

export function getStateRoot() {
  return process.env.XDG_STATE_HOME
    ? process.env.XDG_STATE_HOME
    : path.join(os.homedir(), ".local", "state");
}

export function getRuntimeRoot() {
  return path.join(getStateRoot(), "lattice", "serena");
}

export function normalizeSerenaClient(client) {
  if (typeof client !== "string" || !client) {
    return null;
  }

  const normalized = client.toLowerCase();
  if (normalized === "ide" || normalized === "github-copilot-cli") {
    return "copilot";
  }

  if (normalized === "claude-code") {
    return "claude";
  }

  return hasOwn(SERENA_CLIENTS, normalized) ? normalized : null;
}

export function getClientSpec(client) {
  const normalized = normalizeSerenaClient(client);
  return normalized ? SERENA_CLIENTS[normalized] : null;
}

export function getClientPaths(client) {
  const normalized = normalizeSerenaClient(client);
  const spec = normalized ? SERENA_CLIENTS[normalized] : null;

  if (!normalized || !spec) {
    return null;
  }

  const runtimeRoot = getRuntimeRoot();

  return {
    client: normalized,
    context: spec.context,
    launcherName: spec.launcher,
    launcherPath: path.join(serenaDir, spec.launcher),
    logFile: path.join(runtimeRoot, `${normalized}.log`),
    mcpUrl: `http://127.0.0.1:${spec.port}/mcp`,
    pidFile: path.join(runtimeRoot, `${normalized}.pid`),
    port: spec.port,
    urlFile: path.join(runtimeRoot, `${normalized}.url`),
    runtimeRoot,
  };
}

export function readPidFile(pidFile) {
  try {
    const raw = fs.readFileSync(pidFile, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.end();
      resolve(true);
    });

    socket.once("error", () => {
      resolve(false);
    });

    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function extractDashboardUrl(logText) {
  if (!logText || typeof logText !== "string") {
    return null;
  }

  let dashboardUrl = null;
  let dashboardHost = null;
  let dashboardPort = null;

  for (const line of logText.split(/\r?\n/)) {
    const explicitMatch = line.match(/Serena web dashboard started at (https?:\/\/\S+)/);
    if (explicitMatch?.[1]) {
      dashboardUrl = stripTrailingPunctuation(explicitMatch[1]);
    }

    const listenMatch = line.match(/Starting dashboard \(listen_address=([^,]+), port=(\d+)\)/);
    if (listenMatch) {
      dashboardHost = listenMatch[1].trim();
      dashboardPort = listenMatch[2];
    }
  }

  if (dashboardUrl) {
    return dashboardUrl;
  }

  if (dashboardHost && dashboardPort) {
    const host = dashboardHost.includes(":") && !dashboardHost.startsWith("[")
      ? `[${dashboardHost}]`
      : dashboardHost;
    return `http://${host}:${dashboardPort}/dashboard/index.html`;
  }

  return null;
}

export function readDashboardUrl(logFile) {
  try {
    const raw = fs.readFileSync(logFile, "utf8");
    return extractDashboardUrl(raw);
  } catch {
    return null;
  }
}

export function readDashboardUrlFile(urlFile) {
  try {
    const raw = fs.readFileSync(urlFile, "utf8").trim();
    if (!raw) {
      return null;
    }

    new URL(raw);
    return raw;
  } catch {
    return null;
  }
}

export function writeDashboardUrlFile(urlFile, dashboardUrl) {
  fs.mkdirSync(path.dirname(urlFile), { recursive: true });
  fs.writeFileSync(urlFile, `${dashboardUrl}\n`, "utf8");
}

export async function pickMostRecentActiveClient() {
  const candidates = [];

  for (const client of Object.keys(SERENA_CLIENTS)) {
    const paths = getClientPaths(client);
    if (!paths) {
      continue;
    }

    const pid = readPidFile(paths.pidFile);
    const pidAlive = pid !== null && isProcessAlive(pid);
    const portListening = pidAlive ? true : await isPortListening(paths.port);

    if (!pidAlive && !portListening) {
      continue;
    }

    const dashboardUrl = readDashboardUrlFile(paths.urlFile) ?? readDashboardUrl(paths.logFile);
    if (!dashboardUrl) {
      continue;
    }

    const stat = safeStat(paths.logFile);
    candidates.push({
      ...paths,
      dashboardUrl,
      logMtimeMs: stat?.mtimeMs ?? 0,
      pid,
      pidAlive,
      portListening,
    });
  }

  candidates.sort((left, right) => right.logMtimeMs - left.logMtimeMs);
  return candidates[0] ?? null;
}

export function openExternalUrl(url) {
  let command = "xdg-open";
  let args = [url];

  if (process.platform === "darwin") {
    command = "open";
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  }

  const result = spawnSync(command, args, {
    stdio: "ignore",
    windowsHide: true,
  });

  return {
    command,
    ok: !result.error && (result.status === 0 || result.status === null),
    result,
  };
}
