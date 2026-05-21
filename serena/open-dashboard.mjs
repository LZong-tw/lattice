#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDashboardOpenPlan,
  getClientPaths,
  isPortListening,
  isProcessAlive,
  normalizeSerenaClient,
  openExternalUrl,
  pickMostRecentActiveClient,
  readDashboardUrl,
  readDashboardUrlFile,
  readPidFile,
  wait,
} from "./dashboard-state.mjs";

const serenaDir = path.dirname(fileURLToPath(import.meta.url));
const startHttpScript = path.join(serenaDir, "start-http.mjs");

function printUsage() {
  console.error(
    [
      "Usage: node hooks/serena/open-dashboard.mjs [options] [copilot|claude|codex]",
      "",
      "Options:",
      "  --browser   Force opening the dashboard URL in the default browser.",
      "              On macOS and Linux this is the default. On Windows, Serena",
      "              ships a native tray icon; this flag bypasses it.",
      "  -h, --help  Show this help message.",
      "",
      "If no client is provided, the newest active Serena dashboard is used.",
      "",
      "Platform behavior:",
      "  Windows  — Prints the dashboard URL and instructs you to use Serena's",
      "             tray icon to show the window. Pass --browser to open the URL",
      "             directly in a browser instead.",
      "  macOS    — Opens the dashboard in the default browser. (Serena's native",
      "             macOS tray support is currently disabled upstream.)",
      "  Linux    — Opens the dashboard in the default browser.",
    ].join("\n"),
  );
}

// Parse flags from argv, separating known options from the positional client arg.
const rawArgs = process.argv.slice(2);
let forceBrowser = false;
let requestedClient = null;

for (const arg of rawArgs) {
  if (arg === "-h" || arg === "--help") {
    printUsage();
    process.exit(0);
  } else if (arg === "--browser") {
    forceBrowser = true;
  } else if (!requestedClient) {
    requestedClient = arg;
  } else {
    console.error(`Unexpected argument: ${arg}`);
    printUsage();
    process.exit(1);
  }
}

const normalizedRequestedClient = normalizeSerenaClient(requestedClient);
if (requestedClient && !normalizedRequestedClient) {
  console.error(`Unknown Serena client: ${requestedClient}`);
  printUsage();
  process.exit(1);
}

let clientState = null;

if (normalizedRequestedClient) {
  const paths = getClientPaths(normalizedRequestedClient);
  if (!paths) {
    console.error(`Unable to resolve Serena paths for client: ${requestedClient}`);
    process.exit(1);
  }

  const pid = readPidFile(paths.pidFile);
  const pidAlive = pid !== null && isProcessAlive(pid);
  const portListening = pidAlive ? true : await isPortListening(paths.port);

  if (!pidAlive && !portListening) {
    // Spawn `node start-http.mjs <client>` directly instead of the .sh
    // wrapper so Windows (no bash on PATH) works the same as macOS/Linux.
    const launcherResult = spawnSync(process.execPath, [startHttpScript, paths.client], {
      cwd: serenaDir,
      stdio: "inherit",
    });

    if (launcherResult.error) {
      console.error(`Failed to start Serena ${normalizedRequestedClient} launcher.`);
      console.error(launcherResult.error.message);
      process.exit(1);
    }

    if ((launcherResult.status ?? 0) !== 0) {
      process.exit(launcherResult.status ?? 1);
    }
  }

  let dashboardUrl = readDashboardUrlFile(paths.urlFile) ?? readDashboardUrl(paths.logFile);
  for (let i = 0; i < 12 && !dashboardUrl; i += 1) {
    await wait(250);
    dashboardUrl = readDashboardUrlFile(paths.urlFile) ?? readDashboardUrl(paths.logFile);
  }

  clientState = {
    ...paths,
    dashboardUrl,
  };
} else {
  clientState = await pickMostRecentActiveClient();
}

if (!clientState?.dashboardUrl) {
  console.error(
    normalizedRequestedClient
      ? `No dashboard URL was found in ${clientState?.logFile ?? "the Serena log"}.`
      : "No active Serena dashboard was found. Start one with `node hooks/serena/start-http.mjs <client>` first, or pass a client name to open that dashboard.",
  );
  process.exit(1);
}

const openPlan = getDashboardOpenPlan({ forceBrowser });

if (!openPlan.openInBrowser) {
  // Windows: Serena manages its own native tray window. We cannot reopen it
  // from outside the Serena process. Print the URL and guide the user.
  process.stdout.write(`${clientState.dashboardUrl}\n`);
  console.error(
    `Serena ${clientState.client} dashboard is running at the URL above.\n` +
    `On Windows, use the Serena tray icon in the system tray to show the window.\n` +
    `To open the URL in a browser instead, re-run with --browser.`,
  );
  process.exit(0);
}

// macOS, Linux, or Windows with --browser: open in the default browser.
const openResult = openExternalUrl(clientState.dashboardUrl);
process.stdout.write(`${clientState.dashboardUrl}\n`);

if (!openResult.ok) {
  console.error(`Serena dashboard is available at ${clientState.dashboardUrl}, but it could not be opened automatically.`);
  if (openResult.error instanceof Error) {
    console.error(openResult.error.message);
  }
  process.exit(1);
}

console.error(`Opened Serena ${clientState.client} dashboard in your default browser.`);
