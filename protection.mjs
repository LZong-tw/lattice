#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";

import { repoRoot } from "./common.mjs";
import { detectProjectStack } from "./verification/detect-stack.mjs";

function isEnvFile(fileName) {
  const lower = fileName.toLowerCase();
  return lower === ".env" || lower.startsWith(".env.") || lower === ".envrc";
}

function isGitPath(filePath) {
  // Match `.git` segment using both separators so forward-slash payloads on
  // Windows (Claude/Codex hooks frequently emit "/"-style paths even on
  // win32) cannot bypass the guard. Case-insensitive because Windows and
  // macOS default filesystems are case-insensitive.
  return filePath.split(/[\\/]/).some((segment) => segment.toLowerCase() === ".git");
}

function resolveCandidate(filePath, root) {
  const rawPath = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);

  try {
    return [rawPath, realpathSync(rawPath)];
  } catch {
    return [rawPath];
  }
}

export function getProtectedFileEditReason(filePath, { root = repoRoot } = {}) {
  if (!filePath || typeof filePath !== "string") {
    return null;
  }

  const candidates = resolveCandidate(filePath, root);

  for (const candidate of candidates) {
    const baseName = path.basename(candidate);

    if (isEnvFile(baseName)) {
      return `Editing ${baseName} is blocked. Environment files should not be modified by AI.`;
    }

    if (isGitPath(candidate)) {
      return "Editing files inside .git/ is blocked.";
    }
  }

  const rawPath = candidates[0];
  try {
    const stack = detectProjectStack(path.dirname(rawPath));
    const baseName = path.basename(rawPath).toLowerCase();
    const lockfiles = stack.lockfiles ?? [];

    if (lockfiles.some((lockfile) => lockfile.toLowerCase() === baseName)) {
      return `Editing lockfile ${path.basename(rawPath)} is blocked. Regenerate it through the package manager instead.`;
    }
  } catch {
    // Protection should never break normal tool use if stack detection fails.
  }

  return null;
}

export function getProtectedFileEditFailure(filePaths, options = {}) {
  for (const filePath of filePaths) {
    const reason = getProtectedFileEditReason(filePath, options);
    if (reason) {
      return reason;
    }
  }

  return null;
}
