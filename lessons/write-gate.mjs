#!/usr/bin/env node
/**
 * lessons/write-gate.mjs — optional pre-commit decision-gate.
 *
 * When `config.writeGate.enabled === true`, the provider's PreToolUse
 * handler intercepts `git commit` Bash invocations and inspects the
 * staged diff:
 *
 *   - IF any staged file matches a `watchPaths` regex (i.e. the commit
 *     touches code domains the operator wants lessons-coupled), AND
 *   - NO staged file matches `requireDocsUpdate` regex (i.e. no lesson
 *     doc was edited in the same commit), AND
 *   - The commit message does NOT contain `bypassToken` (default
 *     `[no-decision]`),
 *
 *   THEN deny the commit with a reason explaining the policy.
 *
 * This is the strongest layer in the lessons lifecycle: it BLOCKS the
 * action rather than just printing a warning. Default config has
 * `enabled: false` so adding `lattice/lessons` to your builtins never
 * blocks unexpectedly — opt in deliberately.
 *
 * Bypass: include `[no-decision]` in the commit message for chores
 * (formatting, dep bumps, doc-only edits) that genuinely have no
 * lesson to record.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function tryRegex(source, flags = "") {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

function listStagedFiles(repoRoot) {
  try {
    return execSync("git diff --cached --name-only", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Best-effort extraction of the commit message from a `git commit`
 * command line. Supports:
 *   - `git commit -m "msg"`        / `git commit -m 'msg'`
 *   - `git commit -m msg`          (single-word)
 *   - `git commit --message="msg"` / `--message msg`
 *   - `git commit -F path`         → read file relative to cwd
 *   - `git commit --file=path`
 *
 * Anything else (interactive `-e`, template, amend without -m) returns
 * "" — the gate falls back to checking the staged diff only.
 */
function extractCommitMessage(command, repoRoot) {
  if (typeof command !== "string") return "";

  const quoted = command.match(/-(?:m|-message)(?:=|\s+)(['"])([\s\S]*?)\1/);
  if (quoted) return quoted[2];

  const bare = command.match(/-(?:m|-message)(?:=|\s+)(\S+)/);
  if (bare) return bare[1];

  const fileMatch = command.match(/-(?:F|-file)(?:=|\s+)(\S+)/);
  if (fileMatch) {
    try {
      return readFileSync(resolve(repoRoot, fileMatch[1]), "utf8");
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * Pure-ish: returns a `{ block: true, reason }` object when the commit
 * should be blocked, or `null` to allow it through. Reads from git only
 * when the command is a `git commit` invocation and the write-gate is
 * enabled.
 *
 * @param {object} input
 * @param {string} input.command - Bash command from the tool payload
 * @param {string} input.repoRoot
 * @param {object} input.config - resolved LessonsConfig
 */
export function evaluateWriteGate({ command, repoRoot, config }) {
  if (!config?.writeGate?.enabled) return null;
  if (typeof command !== "string") return null;
  if (!/(^|\s)git\s+commit(\s|$)/.test(command)) return null;

  const watchRes = (config.writeGate.watchPaths || [])
    .map((s) => tryRegex(s))
    .filter(Boolean);
  if (watchRes.length === 0) return null;

  const docRes = (config.writeGate.requireDocsUpdate || [])
    .map((s) => tryRegex(s))
    .filter(Boolean);

  const staged = listStagedFiles(repoRoot);
  if (staged.length === 0) return null;

  const codeTouched = staged.some((file) => watchRes.some((re) => re.test(file)));
  if (!codeTouched) return null;

  const docsTouched = staged.some((file) => docRes.some((re) => re.test(file)));
  if (docsTouched) return null;

  const message = extractCommitMessage(command, repoRoot);
  const bypassToken = config.writeGate.bypassToken || "[no-decision]";
  if (message.includes(bypassToken)) return null;

  return {
    block: true,
    reason:
      `[lattice/lessons write-gate] this commit touches code under ` +
      `${config.writeGate.watchPaths.join(", ")} but does not edit any of ` +
      `${config.writeGate.requireDocsUpdate.join(", ")}. ` +
      `Either record the decision/lesson, or add \`${bypassToken}\` to the ` +
      `commit message to mark this as an intentional chore.`,
  };
}
