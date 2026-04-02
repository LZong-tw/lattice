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

// --- Node.js version ---
const [major] = process.versions.node.split(".").map(Number);
if (major >= 18) {
  pass(`Node.js >= 18 (v${process.versions.node})`);
} else {
  fail(`Node.js >= 18 (v${process.versions.node})`, "Upgrade to Node 18+");
}

// --- Entry point syntax checks ---
const entryPoints = [
  "common.mjs",
  "session-start.mjs",
  "provider-registry.mjs",
  "pre-tool-policy.mjs",
  "commit-checkpoint.mjs",
  "post-tool-reminder.mjs",
  "stop-checklist.mjs",
  "serena/bootstrap.mjs",
  "serena/dashboard-state.mjs",
  "serena/start-http.mjs",
  "serena/open-dashboard.mjs",
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
try {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8"));
  const exports = pkg.exports ?? {};
  let allExist = true;

  for (const [key, target] of Object.entries(exports)) {
    const targetPath = resolve(__dirname, target);
    if (!existsSync(targetPath)) {
      fail(`package.json export ${key} → ${target}`, "target file not found");
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
const uvxResult = spawnSync("uvx", ["--version"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  timeout: 10_000,
});

if (!uvxResult.error && uvxResult.status === 0) {
  pass(`uvx available — Serena provider ready (${(uvxResult.stdout || "").trim()})`);
} else {
  info("uvx not found — Serena provider unavailable (non-blocking)");
}

// --- Summary ---
console.log("");
if (failures === 0) {
  console.log("doctor: all checks passed");
} else {
  console.log(`doctor: ${failures} check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
