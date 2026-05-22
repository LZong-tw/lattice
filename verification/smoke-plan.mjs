#!/usr/bin/env node
/**
 * smoke-plan.mjs — cross-platform smoke checks emitted by `lattice init`.
 *
 * The install plan can't rely on `printf`, `grep`, `env VAR=…`, or pipes:
 * those don't run on Windows cmd.exe or PowerShell without quoting tricks.
 * Instead the plan emits `node hooks/verification/smoke-plan.mjs <check> <client>`
 * and this script does the equivalent in pure Node.
 *
 * Checks:
 *   session-start <client>     — pipes `{}` to hooks/session-start.mjs <client>
 *                                with LATTICE_PROVIDER=none. Passes iff the
 *                                hook exits 0.
 *   pre-tool-deny <client>     — pipes a synthetic Bash `git commit -m test`
 *                                tool-use payload to hooks/pre-tool-policy.mjs
 *                                <client>. Passes iff stdout contains
 *                                `"permissionDecision":"deny"`.
 *
 * Exit 0 on success, non-zero with a one-line diagnostic on failure.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = resolve(SCRIPT_DIR, "..");

function usage() {
  return [
    "Usage:",
    "  node hooks/verification/smoke-plan.mjs session-start <client>",
    "  node hooks/verification/smoke-plan.mjs pre-tool-deny <client>",
  ].join("\n");
}

function fail(message) {
  process.stderr.write(`smoke-plan: ${message}\n`);
  process.exit(1);
}

function runHook({ script, client, stdin, env }) {
  return new Promise((resolvePromise) => {
    const scriptPath = resolve(HOOKS_DIR, script);
    if (!existsSync(scriptPath)) {
      resolvePromise({ code: 127, stdout: "", stderr: `missing ${script}\n` });
      return;
    }
    const child = spawn(process.execPath, [scriptPath, client], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      resolvePromise({ code: 1, stdout, stderr: stderr + String(err) + "\n" });
    });
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 0, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

function preToolPayload(client) {
  if (client === "copilot") {
    return JSON.stringify({
      toolName: "bash",
      toolArgs: JSON.stringify({ command: "git commit -m test" }),
    });
  }
  return JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: "git commit -m test" },
  });
}

async function checkSessionStart(client) {
  const result = await runHook({
    script: "session-start.mjs",
    client,
    stdin: "{}\n",
    env: { LATTICE_PROVIDER: "none" },
  });
  if (result.code !== 0) {
    fail(
      `session-start ${client} exited ${result.code}` +
        (result.stderr ? `: ${result.stderr.trim()}` : ""),
    );
  }
}

async function checkPreToolDeny(client) {
  const result = await runHook({
    script: "pre-tool-policy.mjs",
    client,
    stdin: preToolPayload(client),
    env: {},
  });
  if (result.code !== 0) {
    fail(
      `pre-tool-policy ${client} exited ${result.code}` +
        (result.stderr ? `: ${result.stderr.trim()}` : ""),
    );
  }
  if (!result.stdout.includes('"permissionDecision":"deny"')) {
    fail(
      `pre-tool-policy ${client} did not deny git commit; stdout: ${result.stdout.slice(0, 200)}`,
    );
  }
}

async function main() {
  const [check, client] = process.argv.slice(2);
  if (!check || !client) {
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }

  switch (check) {
    case "session-start":
      await checkSessionStart(client);
      break;
    case "pre-tool-deny":
      await checkPreToolDeny(client);
      break;
    default:
      process.stderr.write(`smoke-plan: unknown check "${check}"\n${usage()}\n`);
      process.exit(2);
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
