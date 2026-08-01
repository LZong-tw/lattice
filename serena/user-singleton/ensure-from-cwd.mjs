#!/usr/bin/env node
/**
 * SessionStart entry: resolve Serena project from cwd and ensure its HTTP singleton.
 *
 * Requires a machine install of serena-http-singleton (see install-user-singletons.mjs
 * or docs/USER-MCP-SINGLETONS.md). Falls back to lattice serena/start-http.mjs style
 * launch only when SERENA_HTTP_SINGLETON_CMD is set.
 *
 * Exit 0 even when no project matches (hooks must not fail the session).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  readHookStdin,
  resolveSerenaProject,
  resolveStartDir,
} from "./project-resolve.mjs";

const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir();
const USER_SINGLETON = path.join(
  HOME,
  ".serena",
  "http-singleton",
  "serena-http-singleton.mjs",
);

function parseArgs(argv) {
  const out = { dryRun: false, project: null };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--dry-run") out.dryRun = true;
    else if (t === "--project") out.project = argv[++i];
    else if (t.startsWith("--project=")) out.project = t.slice("--project=".length);
  }
  return out;
}

function runEnsure(project, port) {
  return new Promise((resolve) => {
    if (!fs.existsSync(USER_SINGLETON)) {
      resolve({
        code: 1,
        stdout: "",
        stderr: `Missing ${USER_SINGLETON}. Install user singletons (docs/USER-MCP-SINGLETONS.md).\n`,
      });
      return;
    }
    const child = spawn(
      process.execPath,
      [USER_SINGLETON, "ensure", "--project", project, "--port", String(port)],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: process.env,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("exit", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = await readHookStdin();
  const startDir = resolveStartDir(payload, args.project);
  const resolved = resolveSerenaProject(startDir);

  if (!resolved) {
    console.error(`[serena-ensure-from-cwd] no Serena project for ${startDir} (skip)`);
    process.exit(0);
  }

  console.error(
    `[serena-ensure-from-cwd] ${resolved.reason}: ${resolved.project} → ${resolved.endpoint}`,
  );

  if (args.dryRun) {
    console.log(JSON.stringify({ startDir, ...resolved }, null, 2));
    process.exit(0);
  }

  const result = await runEnsure(resolved.project, resolved.port);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[serena-ensure-from-cwd] ${err.stack || err.message || err}`);
  process.exit(0);
});
