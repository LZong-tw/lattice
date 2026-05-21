#!/usr/bin/env node
/**
 * Serena bootstrap — called from the general-purpose session-start hook
 * to start the Serena MCP server for the active AI client.
 *
 * Separated from session-start.mjs so general hook policy stays
 * Serena-agnostic.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { getClientPaths } from "./dashboard-state.mjs";

const serenaDir = path.dirname(fileURLToPath(import.meta.url));
const startHttpScript = path.join(serenaDir, "start-http.mjs");

/**
 * Start the Serena MCP server for the given client.
 * Returns the exit code from the launcher (0 = success or skipped).
 *
 * We spawn `node start-http.mjs <client>` directly instead of running the
 * matching `.sh` launcher. The shell wrappers were 3-line bash shims that
 * just `exec node start-http.mjs <client>`, and Windows boxes don't have
 * `bash` on PATH — spawnSync("bash", ...) silently returns ENOENT and the
 * old `status ?? 0` made the failure look like success. Going Node-direct
 * removes both the bash dependency and the silent-failure trap. The .sh
 * files are kept on disk for users who prefer to launch from a shell.
 */
export function bootstrapSerena(client) {
  const spec = getClientPaths(client);
  if (!spec) {
    return 0;
  }

  if (!fs.existsSync(startHttpScript)) {
    return 0;
  }

  const result = spawnSync(process.execPath, [startHttpScript, spec.client], {
    cwd: serenaDir,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`lattice: failed to launch Serena (${spec.client}): ${result.error.message}`);
    return 1;
  }

  return result.status ?? 0;
}
