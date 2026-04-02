#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import path from "node:path";
import {
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

function printUsage() {
  console.error(
    [
      "Usage: node hooks/serena/open-dashboard.mjs [copilot|claude|codex]",
      "If no client is provided, the newest active Serena dashboard is opened.",
      "The helper prints the dashboard URL to stdout and opens it in the default browser when possible.",
    ].join("\n"),
  );
}

const requestedClient = process.argv[2];

if (requestedClient === "-h" || requestedClient === "--help") {
  printUsage();
  process.exit(0);
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
    const launcherResult = spawnSync("bash", [paths.launcherPath], {
      cwd: path.dirname(paths.launcherPath),
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
