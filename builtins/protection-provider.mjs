#!/usr/bin/env node
/**
 * builtins/protection-provider.mjs — file-edit protection + commit gate.
 *
 * Built-in v1 provider that:
 *   - Denies edits to protected files (.env*, .git/, lockfiles for the
 *     detected stack) — wraps `protection.getProtectedFileEditFailure`.
 *   - Denies `git commit` invocations from Bash, surfacing the
 *     pre-commit checklist as the deny reason.
 *
 * The underlying helpers (`common.normalizeToolUse`, `protection.*`,
 * `messages.commitGate`) are unchanged — this provider is a v1-shape
 * adapter on top of them.
 */

import {
  isBashTool,
  isEditTool,
  isGitCommitCommand,
  messages,
  normalizeToolUse,
} from "../common.mjs";
import { getProtectedFileEditFailure } from "../protection.mjs";

const CANONICAL_TO_BARE_CLIENT = Object.freeze({
  "claude-code": "claude",
  codex: "codex",
  "copilot-cli": "copilot",
});

function toBareClient(canonical) {
  return CANONICAL_TO_BARE_CLIENT[canonical] ?? canonical;
}

function checkProtection(ctx, payload) {
  const bareClient = toBareClient(ctx.client);
  const { toolName, command, filePaths } = normalizeToolUse(bareClient, payload);

  if (isEditTool(toolName)) {
    const reason = getProtectedFileEditFailure(filePaths);
    if (reason) {
      return { decision: "deny", reason };
    }
  }

  if (isBashTool(toolName) && isGitCommitCommand(command)) {
    return { decision: "deny", reason: messages.commitGate };
  }

  return {};
}

export const protectionProvider = Object.freeze({
  name: "lattice/protection",
  contractVersion: 1,
  handlers: Object.freeze({
    PreToolUse(ctx, payload) {
      return checkProtection(ctx, payload);
    },
  }),
});
