#!/usr/bin/env node
/**
 * doctor.mjs — single-command health check for the lattice package.
 *
 * Usage:
 *   node doctor.mjs          (from lattice root)
 *   pnpm run doctor          (via package.json script)
 *
 * Exit codes:
 *   0 — all required checks passed
 *   1 — one or more required checks failed
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
let failures = 0;

function pass(label) {
  console.log(`✓ ${label}`);
}

function fail(label, detail) {
  console.log(`✗ ${label}`);
  if (detail) {
    console.log(`  → ${detail}`);
  }
  failures += 1;
}

function info(label) {
  console.log(`⚠ ${label}`);
}

function firstLine(value) {
  return (value || "").trim().split(/\r?\n/)[0] || "";
}

function runCli(command, args = [], timeout = 10_000) {
  const spec =
    process.platform === "win32"
      ? { command: "cmd.exe", args: ["/d", "/c", command, ...args] }
      : { command, args };
  return spawnSync(spec.command, spec.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });
}

function optionalCli(label, command, args = ["--version"], options = {}) {
  const result = runCli(command, args, options.timeout ?? 10_000);
  if (!result.error && result.status === 0) {
    const output = firstLine(result.stdout) || firstLine(result.stderr);
    pass(`${label} available${output ? ` — ${output}` : ""}`);
    return true;
  }

  info(`${label} not found or not runnable${options.detail ? ` — ${options.detail}` : ""} (non-blocking)`);
  return false;
}

// --- Node.js version ---
const [major] = process.versions.node.split(".").map(Number);
if (major >= 20) {
  pass(`Node.js >= 20 (v${process.versions.node})`);
} else {
  fail(`Node.js >= 20 (v${process.versions.node})`, "Upgrade to Node 20+");
}

// --- Entry point syntax checks ---
const entryPoints = [
  "index.mjs",
  "init.mjs",
  "common.mjs",
  "session-start.mjs",
  "provider-registry.mjs",
  "codex-hook-runner.mjs",
  "mcp-config-common.mjs",
  "pre-tool-policy.mjs",
  "protection.mjs",
  "commit-checkpoint.mjs",
  "post-tool-reminder.mjs",
  "stop-checklist.mjs",
  "client-enum.mjs",
  "context.mjs",
  "dispatcher.mjs",
  "timeouts.mjs",
  "testing.mjs",
  "register-builtins.mjs",
  "builtins/protection-provider.mjs",
  "builtins/stop-checklist-provider.mjs",
  "builtins/reminders-provider.mjs",
  "verification/detect-stack.mjs",
  "verification/verify.mjs",
  "serena/bootstrap.mjs",
  "serena/dashboard-state.mjs",
  "serena/mcp-config-guard.mjs",
  "serena/start-http.mjs",
  "serena/cleanup-processes.mjs",
  "serena/open-dashboard.mjs",
  "serena/provider.mjs",
  "semble/mcp-config-guard.mjs",
  "semble/provider.mjs",
  "rtk/provider.mjs",
];

for (const entry of entryPoints) {
  const filePath = resolve(__dirname, entry);
  if (!existsSync(filePath)) {
    fail(`${entry} exists`, "file not found");
    continue;
  }

  const result = spawnSync(process.execPath, ["--check", filePath], {
    encoding: "utf8",
    timeout: 10_000,
  });

  if (result.status === 0) {
    pass(`${entry} parses`);
  } else {
    fail(`${entry} parses`, (result.stderr || "").trim().split("\n")[0]);
  }
}

// --- package.json exports are valid ---
function collectExportTargets(value) {
  if (typeof value === "string") {
    return [value];
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.values(value).flatMap(collectExportTargets);
}

try {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8"));
  const exports = pkg.exports ?? {};
  let allExist = true;

  for (const [key, targetSpec] of Object.entries(exports)) {
    for (const target of collectExportTargets(targetSpec)) {
      const targetPath = resolve(__dirname, target);
      if (!existsSync(targetPath)) {
        fail(`package.json export ${key} → ${target}`, "target file not found");
        allExist = false;
      }
    }

    if (collectExportTargets(targetSpec).length === 0) {
      fail(`package.json export ${key}`, "no file target found");
      allExist = false;
    }
  }

  if (allExist) {
    pass("package.json exports are valid");
  }
} catch (err) {
  fail("package.json exports are valid", err.message);
}

// --- Optional: uvx availability ---
// On Windows, uvx ships as `uvx.cmd` (Scoop/winget/pip). Node cannot spawn
// .cmd shims directly; route through cmd.exe /c instead of enabling the
// shell option (the codebase forbids that flag for argument-escape sanity).
const uvxCommand =
  process.platform === "win32"
    ? { command: "cmd.exe", args: ["/c", "uvx", "--version"] }
    : { command: "uvx", args: ["--version"] };
const uvxResult = spawnSync(uvxCommand.command, uvxCommand.args, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  timeout: 10_000,
});

if (!uvxResult.error && uvxResult.status === 0) {
  pass(`uvx available — Serena and Semble launchers ready (${(uvxResult.stdout || "").trim()})`);
} else {
  info("uvx not found — Serena/Semble launchers unavailable (non-blocking)");
}

// --- Optional AI-client and provider CLIs ---
optionalCli("Claude Code CLI", "claude", ["--version"]);
optionalCli("Codex CLI", "codex", ["--version"]);
optionalCli("GitHub Copilot CLI", "gh", ["copilot", "--help"], {
  detail: "requires gh plus the copilot extension",
});
optionalCli("RTK CLI", "rtk", ["--version"]);
optionalCli("ripgrep", "rg", ["--version"]);

// --- Summary ---
console.log("");
if (failures === 0) {
  console.log("doctor: all checks passed");
} else {
  console.log(`doctor: ${failures} check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
