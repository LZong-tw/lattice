#!/usr/bin/env node
/**
 * lessons/size-check.mjs — terse warning when root lessons doc grows past
 * the soft cap.
 *
 * Pure function (`buildSizeCheckMessage`) + CLI entry. Importable from the
 * provider's Stop handler, the consumer's husky pre-commit hook, or run
 * standalone as `node node_modules/@lzong.tw/lattice/lessons/size-check.mjs`.
 *
 * Output policy: PRINT NOTHING when under both thresholds. Never blocks,
 * never errors — `main()` exits 0 even on caught exceptions. The purpose
 * is an *advisory nudge* surfaced in the AI client's terminal; hard
 * enforcement belongs in a separate pre-commit gate.
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLessonsConfig } from "./config.mjs";

function repoRootFromGit(fallback) {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

function countLines(path) {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8").split("\n").length;
}

function countTopLevelLessons(path) {
  if (!existsSync(path)) return 0;
  // A top-level lesson bullet starts with `- **` at column 0.
  return (readFileSync(path, "utf8").match(/^- \*\*/gm) || []).length;
}

/**
 * Pure: given a config + filesystem snapshot, return either a string to
 * print or `null` to print nothing. Exported so the provider's Stop
 * handler can route via `ctx.log` rather than direct stdout.
 */
export function buildSizeCheckMessage({ repoRoot, config }) {
  const docPath = resolve(repoRoot, config.rootDoc);
  if (!existsSync(docPath)) return null;

  const lines = countLines(docPath);
  const lessons = countTopLevelLessons(docPath);
  const { lines: lineCap, bullets: bulletCap } = config.cap;

  if (lines <= lineCap && lessons <= bulletCap) return null;

  const overLines = lines > lineCap;
  const overLessons = lessons > bulletCap;

  return (
    `[lattice/lessons size-check] ${config.rootDoc}: ${lines} lines, ${lessons} top-level lessons` +
    (overLines ? ` (>${lineCap} soft cap)` : "") +
    (overLessons ? ` (>${bulletCap} bullet cap)` : "") +
    `\n  → reorganize-audit: see what should move to per-domain files` +
    `\n  → promote-audit: see what should become audit tests / hooks`
  );
}

function main() {
  const repoRoot = repoRootFromGit(process.cwd());
  const config = loadLessonsConfig({ env: process.env, repoRoot });
  const message = buildSizeCheckMessage({ repoRoot, config });
  if (message) process.stdout.write(message + "\n");
}

// Run only when invoked as CLI (matches both Windows and POSIX paths).
const invokedAsScript =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedAsScript) {
  try {
    main();
  } catch {
    // never block the caller
  }
  process.exit(0);
}
