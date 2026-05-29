#!/usr/bin/env node
/**
 * rtk/provider.mjs — optional RTK command-rewrite provider.
 *
 * RTK is a command-output compaction proxy. This provider only asks RTK for a
 * rewrite and lets the AI client run the rewritten command. Filtering stays in
 * the `rtk` binary; Lattice owns only hook integration and graceful fallback.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CLIENTS } from "../client-enum.mjs";
import {
  isBashTool,
  isGitCommitCommand,
  normalizeToolUse,
} from "../common.mjs";

const DEFAULT_TIMEOUT_MS = 2_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 10_000;

function resolveRtkBin(env) {
  const configured = env.LATTICE_RTK_BIN?.trim();
  return configured || "rtk";
}

function resolveTimeoutMs(env) {
  const raw = env.LATTICE_RTK_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(parsed, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

function isRtkDisabled(command, env) {
  return (
    env.LATTICE_RTK_DISABLED === "1" ||
    env.RTK_DISABLED === "1" ||
    /(^|\s)RTK_DISABLED=1(\s|$)/.test(command)
  );
}

function isRtkCommand(command) {
  return /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*rtk(?:\.exe|\.cmd)?(?:\s|$)/i.test(command);
}

function getHomeDir(env) {
  return env.USERPROFILE || env.HOME || "";
}

function containsClaudeRtkHook(value) {
  if (typeof value === "string") {
    return /\brtk(?:\.exe|\.cmd)?\s+hook\s+claude\b/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsClaudeRtkHook);
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(containsClaudeRtkHook);
  }
  return false;
}

function hasClaudeNativeRtkHook(env) {
  const home = getHomeDir(env);
  if (!home) return false;

  const settingsPath = join(home, ".claude", "settings.json");
  if (!existsSync(settingsPath)) return false;

  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    return containsClaudeRtkHook(settings?.hooks?.PreToolUse);
  } catch {
    return false;
  }
}

function shouldPreferNativeRtk(command, ctx) {
  if (ctx.env.LATTICE_RTK_FORCE_PROVIDER === "1") {
    return false;
  }
  if (ctx.env.LATTICE_RTK_NATIVE_HOOK === "1") {
    return true;
  }
  if (ctx.env.LATTICE_RTK_NATIVE_HOOK === "0") {
    return false;
  }
  if (isRtkCommand(command)) {
    return true;
  }
  if (ctx.client === CLIENTS.CLAUDE_CODE) {
    return hasClaudeNativeRtkHook(ctx.env);
  }
  return false;
}

function runRtk(bin, args, ctx, timeoutMs) {
  return new Promise((resolve) => {
    const child = execFile(
      bin,
      args,
      {
        cwd: ctx.cwd,
        env: { ...ctx.env },
        maxBuffer: 512 * 1024,
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        const code = error?.code ?? 0;
        const timedOut = error?.killed === true || error?.signal === "SIGTERM";
        resolve({
          ok: !timedOut && (code === 0 || code === 3),
          code,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          timedOut,
        });
      },
    );

    const abort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // best-effort cancellation
      }
    };

    if (ctx.signal.aborted) {
      abort();
    } else {
      ctx.signal.addEventListener("abort", abort, { once: true });
      child.once("exit", () => {
        ctx.signal.removeEventListener("abort", abort);
      });
    }
  });
}

async function rewriteCommand(command, ctx) {
  const bin = resolveRtkBin(ctx.env);
  const timeoutMs = resolveTimeoutMs(ctx.env);
  const result = await runRtk(bin, ["rewrite", command], ctx, timeoutMs);

  if (!result.ok) {
    if (ctx.env.LATTICE_RTK_DEBUG === "1") {
      ctx.log(
        `rewrite skipped: rtk exited with code ${String(result.code)}${result.timedOut ? " after timeout" : ""}`,
      );
    }
    return command;
  }

  const rewritten = result.stdout.trim();
  return rewritten || command;
}

async function checkRtkAvailable(ctx) {
  const bin = resolveRtkBin(ctx.env);
  const timeoutMs = resolveTimeoutMs(ctx.env);
  const result = await runRtk(bin, ["--version"], ctx, timeoutMs);

  if (!result.ok) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${String(result.code)}`;
    return {
      ok: false,
      failures: [`rtk binary is required but not available via ${bin}: ${detail}`],
    };
  }

  return { ok: true };
}

export const rtkProvider = Object.freeze({
  name: "rtk",
  contractVersion: 1,
  supportedClients: Object.freeze([CLIENTS.CLAUDE_CODE, CLIENTS.CODEX]),
  async validate(ctx) {
    if (ctx.env.LATTICE_REQUIRE_RTK !== "1") {
      return { ok: true };
    }

    return checkRtkAvailable(ctx);
  },
  handlers: Object.freeze({
    async PreToolUse(ctx, payload) {
      const { toolName, command } = normalizeToolUse(ctx.client, payload);
      if (!isBashTool(toolName) || !command.trim()) {
        return {};
      }

      if (
        isGitCommitCommand(command) ||
        isRtkDisabled(command, ctx.env) ||
        shouldPreferNativeRtk(command, ctx)
      ) {
        return {};
      }

      const rewritten = await rewriteCommand(command, ctx);
      if (rewritten === command) {
        return {};
      }

      return {
        decision: "allow",
        hookSpecificOutput: {
          updatedInput: { command: rewritten },
        },
      };
    },
  }),
});
