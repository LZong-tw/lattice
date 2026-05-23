#!/usr/bin/env node
/**
 * lessons/provider.mjs — `lattice/lessons` v1 provider.
 *
 * Three handlers, all opt-in by config:
 *
 *   Stop          — print size-check warning if the root lessons doc
 *                   has grown past `config.cap.lines` or
 *                   `config.cap.bullets`.
 *
 *   PostToolUse   — when Edit/Write/MultiEdit touches a file that
 *                   matches a configured `domains[].match` regex,
 *                   print a one-line nudge naming the relevant
 *                   per-domain doc.
 *
 *   PreToolUse    — when `config.writeGate.enabled === true` AND the
 *                   command is `git commit`, evaluate the write-gate
 *                   (block commits that touch watched paths without
 *                   also editing a docs path, unless the bypass
 *                   token is in the commit message).
 *
 * Zero-config behaviour: only the size-check warning fires. Everything
 * else stays silent until the consumer adds domains / opts in to the
 * write-gate. This means adding `lattice/lessons` to a registry is
 * always safe — you opt into intrusive behaviour deliberately, never
 * by accident.
 */

import {
  isEditTool,
  isBashTool,
  isGitCommitCommand,
  normalizeToolUse,
} from "../common.mjs";

const CANONICAL_TO_BARE_CLIENT = Object.freeze({
  "claude-code": "claude",
  codex: "codex",
  "copilot-cli": "copilot",
});

function toBareClient(client) {
  if (typeof client !== "string") return client;
  return CANONICAL_TO_BARE_CLIENT[client] ?? client;
}

export const lessonsProvider = Object.freeze({
  name: "lattice/lessons",
  contractVersion: 1,

  handlers: Object.freeze({
    async Stop(ctx) {
      const { loadLessonsConfig } = await import("./config.mjs");
      const { buildSizeCheckMessage } = await import("./size-check.mjs");

      const config = loadLessonsConfig({ env: ctx.env, repoRoot: ctx.repoRoot });
      const message = buildSizeCheckMessage({ repoRoot: ctx.repoRoot, config });
      if (message) ctx.log(message);
      return {};
    },

    async PostToolUse(ctx, payload) {
      const { toolName, filePaths } = normalizeToolUse(toBareClient(ctx.client), payload);
      if (!isEditTool(toolName)) return {};
      if (!Array.isArray(filePaths) || filePaths.length === 0) return {};

      const { loadLessonsConfig } = await import("./config.mjs");
      const config = loadLessonsConfig({ env: ctx.env, repoRoot: ctx.repoRoot });
      if (!config.domains || config.domains.length === 0) return {};

      const { buildResurfaceMessage } = await import("./resurface.mjs");
      const message = buildResurfaceMessage({
        repoRoot: ctx.repoRoot,
        filePaths,
        config,
      });
      if (message) ctx.log(message);
      return {};
    },

    async PreToolUse(ctx, payload) {
      const { toolName, command } = normalizeToolUse(toBareClient(ctx.client), payload);
      if (!isBashTool(toolName)) return {};
      if (!isGitCommitCommand(command)) return {};

      const { loadLessonsConfig } = await import("./config.mjs");
      const config = loadLessonsConfig({ env: ctx.env, repoRoot: ctx.repoRoot });
      if (!config.writeGate?.enabled) return {};

      const { evaluateWriteGate } = await import("./write-gate.mjs");
      const verdict = evaluateWriteGate({ command, repoRoot: ctx.repoRoot, config });
      if (verdict?.block) {
        return { decision: "deny", reason: verdict.reason };
      }
      return {};
    },
  }),
});
