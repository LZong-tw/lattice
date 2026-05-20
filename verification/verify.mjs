#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { getStateNamespace, repoRoot } from "../common.mjs";
import { detectProjectStack } from "./detect-stack.mjs";

const DEFAULT_MAX_STRIKES = 3;

function runGit(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0 || result.error) return null;
  return result.stdout;
}

export function parseGitStatusFiles(statusOutput) {
  return statusOutput
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rawPath = line.slice(3);
      return rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() : rawPath;
    })
    .filter(Boolean);
}

export function getChangedFiles(root) {
  const status = runGit(root, ["status", "--short", "--untracked-files=normal"]);
  if (status === null) return null;
  return parseGitStatusFiles(status);
}

function stateRoot(stateHome, root) {
  return resolve(stateHome ?? resolve(homedir(), ".local", "state"), getStateNamespace(root), "hooks");
}

function counterPath({ stateHome, root, sessionId }) {
  const safeSessionId = String(sessionId || "default").replace(/[^A-Za-z0-9_.-]/g, "_");
  return resolve(stateRoot(stateHome, root), `verification-${safeSessionId}.json`);
}

function readCounter(options) {
  try {
    const data = JSON.parse(readFileSync(counterPath(options), "utf8"));
    return typeof data.count === "number" ? data.count : 0;
  } catch {
    return 0;
  }
}

function writeCounter(options, count) {
  const target = counterPath(options);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ count, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

function runCommand(command, { cwd, timeout }) {
  return spawnSync(command.cmd, command.args, {
    cwd,
    encoding: "utf8",
    timeout,
  });
}

export function filterRelevantOutput(output, changedFiles) {
  if (!Array.isArray(changedFiles)) return output.trim();
  if (changedFiles.length === 0) return "";

  const normalizedFiles = changedFiles.map((file) => file.replaceAll("\\", "/"));
  const relevant = output
    .split(/\r?\n/)
    .filter((line) => {
      const normalizedLine = line.replaceAll("\\", "/");
      return normalizedFiles.some((file) => {
        const name = basename(file);
        return normalizedLine.includes(file) || (name && normalizedLine.includes(name));
      });
    });

  return relevant.join("\n").trim();
}

function commandLabel(command) {
  return [command.cmd, ...command.args].join(" ");
}

function rootFromPayload(payload, fallbackRoot) {
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  return cwd ? resolve(cwd) : fallbackRoot;
}

export function formatVerificationFailure(failures) {
  return [
    "Lattice verification failed before stop.",
    "Fix the relevant errors, rerun validation, then finish.",
    "",
    ...failures,
  ].join("\n");
}

export function runProjectVerification({
  payload = {},
  root = repoRoot,
  stateHome = process.env.XDG_STATE_HOME,
  maxStrikes = Number(process.env.LATTICE_VERIFY_MAX_STRIKES || DEFAULT_MAX_STRIKES),
} = {}) {
  const startRoot = rootFromPayload(payload, root);
  const stack = detectProjectStack(startRoot);
  const commands = [
    stack.typecheck ? { kind: "TYPECHECK", command: stack.typecheck, timeout: 60_000 } : null,
    stack.lint ? { kind: "LINT", command: stack.lint, timeout: 15_000 } : null,
  ].filter(Boolean);

  if (commands.length === 0) {
    return { status: "skipped", message: "No typecheck or lint command detected.", stack };
  }

  const changedFiles = getChangedFiles(stack.projectRoot);
  if (Array.isArray(changedFiles) && changedFiles.length === 0) {
    const counterOptions = { stateHome, root: stack.projectRoot, sessionId: payload.session_id ?? payload.sessionId };
    writeCounter(counterOptions, 0);
    return { status: "passed", message: "No changed files require verification.", stack };
  }

  const counterOptions = { stateHome, root: stack.projectRoot, sessionId: payload.session_id ?? payload.sessionId };
  const count = readCounter(counterOptions);
  if (count >= maxStrikes) {
    return {
      status: "allowed",
      message: `Circuit breaker: allowing stop after ${maxStrikes} consecutive verification failures.`,
      stack,
    };
  }

  const failures = [];
  for (const { kind, command, timeout } of commands) {
    const result = runCommand(command, { cwd: stack.projectRoot, timeout });
    if (!result.error && result.status === 0) continue;

    const timedOut = result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM";
    if (timedOut) {
      failures.push(`[${kind} TIMEOUT] ${commandLabel(command)} exceeded ${timeout / 1000}s.`);
      continue;
    }

    if (result.error?.code === "ENOENT") continue;

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const relevant = filterRelevantOutput(output, changedFiles);
    if (relevant) {
      failures.push(`[${kind} ERRORS]\n${relevant.slice(0, 3000)}`);
    }
  }

  if (failures.length > 0) {
    writeCounter(counterOptions, count + 1);
    return { status: "failed", message: formatVerificationFailure(failures), failures, stack };
  }

  writeCounter(counterOptions, 0);
  return { status: "passed", message: "Verification passed.", stack };
}

export function buildStopBlockOutput(message) {
  return {
    hookSpecificOutput: {
      hookEventName: "Stop",
      decision: "block",
    },
    additionalContext: message,
  };
}
