#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  getStateNamespace,
  printMessage,
  readJsonStdin,
  repoRoot as defaultRepoRoot,
} from "./common.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const CHECKPOINT_COOLDOWN_MS = 15 * 60 * 1000;

function getStateRoot(stateHome = process.env.XDG_STATE_HOME, repoPath = defaultRepoRoot) {
  return resolve(
    stateHome ?? resolve(homedir(), ".local", "state"),
    getStateNamespace(repoPath),
    "hooks",
  );
}

function getStatePath(stateHome = process.env.XDG_STATE_HOME, repoPath = defaultRepoRoot) {
  return resolve(getStateRoot(stateHome, repoPath), "commit-checkpoint.json");
}

function readState(stateHome = process.env.XDG_STATE_HOME, repoPath = defaultRepoRoot) {
  const statePath = getStatePath(stateHome, repoPath);
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

function writeState(stateHome, repoPath, state) {
  const statePath = getStatePath(stateHome, repoPath);
  mkdirSync(resolve(statePath, ".."), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function clearState(stateHome, repoPath) {
  const statePath = getStatePath(stateHome, repoPath);
  try {
    writeFileSync(statePath, "", "utf8");
  } catch {
    // If the state file cannot be cleared, the reminder still remains advisory.
  }
}

function runGit(repoPath, args) {
  const result = spawnSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
  });

  if (result.status !== 0 || result.error) {
    return null;
  }

  return result.stdout.replace(/\r?\n$/, "");
}

function getBranchName(repoPath) {
  return runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? "unknown";
}

function getDirtyStatusLines(repoPath) {
  const output = runGit(repoPath, ["status", "--short", "--untracked-files=normal"]);
  if (output === null) {
    return null;
  }

  const lines = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !line.includes(".serena/"));

  return lines;
}

function summarizeStatus(lines) {
  const untrackedCount = lines.filter((line) => line.startsWith("?? ")).length;
  const trackedCount = lines.length - untrackedCount;

  return {
    changedCount: lines.length,
    trackedCount,
    untrackedCount,
  };
}

function buildReminderMessage({ branchName, summary }) {
  const trackedLabel = summary.trackedCount === 1 ? "tracked file" : "tracked files";
  const trackedVerb = summary.trackedCount === 1 ? "is" : "are";
  const changedLabel = summary.changedCount === 1 ? "changed file" : "changed files";
  const untrackedLine =
    summary.untrackedCount > 0
      ? `Untracked files: ${summary.untrackedCount}.`
      : "Untracked files: none.";

  return [
    "💡 COMMIT CHECKPOINT",
    "──────────────────────",
    `You have ${summary.changedCount} ${changedLabel} on ${branchName}.`,
    `${summary.trackedCount} ${trackedLabel} ${trackedVerb} already modified or staged.`,
    untrackedLine,
    "If this is a stable checkpoint, commit now before the diff grows.",
    "If you're still iterating, keep going and ignore this reminder.",
  ].join("\n");
}

export function buildCommitCheckpointReminder({
  repoPath = defaultRepoRoot,
  stateHome = process.env.XDG_STATE_HOME,
  now = Date.now(),
} = {}) {
  const lines = getDirtyStatusLines(repoPath);
  if (lines === null) {
    return null;
  }

  if (lines.length === 0) {
    clearState(stateHome, repoPath);
    return null;
  }

  const branchName = getBranchName(repoPath);
  const signature = `${branchName}\n${lines.join("\n")}`;
  const state = readState(stateHome, repoPath);

  if (
    state &&
    state.signature === signature &&
    typeof state.lastReminderAt === "number" &&
    now - state.lastReminderAt < CHECKPOINT_COOLDOWN_MS
  ) {
    return null;
  }

  const reminder = buildReminderMessage({
    branchName,
    summary: summarizeStatus(lines),
  });

  try {
    writeState(stateHome, repoPath, { signature, lastReminderAt: now });
  } catch {
    // If persistence fails, keep the hook advisory rather than breaking tool use.
  }

  return reminder;
}

export function maybePrintCommitCheckpointReminder(options = {}) {
  const reminder = buildCommitCheckpointReminder(options);
  if (!reminder) {
    return false;
  }

  printMessage(reminder);
  return true;
}

if (process.argv[1] === scriptPath) {
  await readJsonStdin();
  maybePrintCommitCheckpointReminder();
}
