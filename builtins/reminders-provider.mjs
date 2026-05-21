#!/usr/bin/env node
/**
 * builtins/reminders-provider.mjs — three independent reminder providers.
 *
 *   lattice/commit-checkpoint  — SessionStart + PreToolUse. Prints a
 *                                "stable checkpoint?" nudge when the tree
 *                                is dirty and the same nudge hasn't
 *                                fired in the cooldown window.
 *   lattice/screenshot-reminder — PreToolUse, claude-code only. Reminds
 *                                the agent to scroll all areas after a
 *                                screenshot tool use.
 *   lattice/edit-reminder      — PostToolUse. Prompts the agent to log
 *                                lessons after an edit.
 *
 * All three write to stderr via `ctx.log` (matching the historical
 * `printMessage` behavior) and return `{}` so they never affect dispatch
 * exit codes or stdout response shape.
 */

import {
  isEditTool,
  isScreenshotTool,
  messages,
  normalizeToolUse,
} from "../common.mjs";
import { buildCommitCheckpointReminder } from "../commit-checkpoint.mjs";

const CANONICAL_TO_BARE_CLIENT = Object.freeze({
  "claude-code": "claude",
  codex: "codex",
  "copilot-cli": "copilot",
});

function toBareClient(canonical) {
  return CANONICAL_TO_BARE_CLIENT[canonical] ?? canonical;
}

function maybeReminder(ctx) {
  const reminder = buildCommitCheckpointReminder({
    repoPath: ctx.repoRoot,
    stateHome: ctx.env.XDG_STATE_HOME,
  });
  if (reminder) {
    ctx.log(reminder);
  }
  return {};
}

export const commitCheckpointProvider = Object.freeze({
  name: "lattice/commit-checkpoint",
  contractVersion: 1,
  handlers: Object.freeze({
    SessionStart(ctx) {
      return maybeReminder(ctx);
    },
    PreToolUse(ctx, payload) {
      // Suppress on `git commit` Bash invocations to avoid double-noise
      // with the protection provider's commit gate.
      const bareClient = toBareClient(ctx.client);
      const { toolName, command } = normalizeToolUse(bareClient, payload);
      if (toolName?.toLowerCase() === "bash" && /(^|\s)git\s+commit(\s|$)/.test(command)) {
        return {};
      }
      return maybeReminder(ctx);
    },
  }),
});

export const screenshotReminderProvider = Object.freeze({
  name: "lattice/screenshot-reminder",
  contractVersion: 1,
  supportedClients: Object.freeze(["claude-code"]),
  handlers: Object.freeze({
    PreToolUse(ctx, payload) {
      const { toolName } = normalizeToolUse(toBareClient(ctx.client), payload);
      if (isScreenshotTool(toolName)) {
        ctx.log(messages.screenshotReminder);
      }
      return {};
    },
  }),
});

export const editReminderProvider = Object.freeze({
  name: "lattice/edit-reminder",
  contractVersion: 1,
  handlers: Object.freeze({
    PostToolUse(ctx, payload) {
      const { toolName } = normalizeToolUse(toBareClient(ctx.client), payload);
      if (isEditTool(toolName)) {
        ctx.log(messages.editReminder);
      }
      return {};
    },
  }),
});
