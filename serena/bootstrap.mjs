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
import { spawnSync } from "node:child_process";

import { getClientPaths } from "./dashboard-state.mjs";

/**
 * Start the Serena MCP server for the given client.
 * Returns the exit code from the launcher (0 = success or skipped).
 */
export function bootstrapSerena(client) {
  const spec = getClientPaths(client);
  if (!spec?.launcherPath) {
    return 0;
  }

  if (!fs.existsSync(spec.launcherPath)) {
    return 0;
  }

  const result = spawnSync("bash", [spec.launcherPath], {
    cwd: path.dirname(spec.launcherPath),
    stdio: "inherit",
  });

  return result.status ?? 0;
}
