#!/usr/bin/env node
/**
 * clawback-provider.mjs — proof-of-concept lattice adapter for clawback.
 *
 * Shows how the five hooks shipped by https://github.com/lzong-tw/clawback
 * map onto the lattice v1 multi-event provider contract. This file is
 * intentionally a stub: every handler logs what the real implementation
 * would do and returns the shape the v1 dispatcher expects. The real
 * `@lattice/clawback` package would import its existing `hooks/*.cjs`
 * modules and call them from these handlers.
 *
 * Mapping (clawback hook file → lattice event):
 *   hooks/protect-files.cjs         → PreToolUse
 *   hooks/post-edit.cjs             → PostToolUse
 *   hooks/stop-verify.cjs           → Stop
 *   hooks/post-compact-reinject.cjs → PostCompact
 *   hooks/notification.cjs          → Notification
 *
 * NOT registered automatically. Consumers wire it via:
 *
 *   import { registerProvider } from "lattice/provider-registry";
 *   import { clawbackProvider } from "./examples/clawback-adapter/clawback-provider.mjs";
 *   registerProvider(clawbackProvider);
 *
 * The real `@lattice/clawback` package would call `registerProvider` as
 * an import side-effect so consumers only need `import "@lattice/clawback"`.
 */

// Files clawback's protect-files hook refuses to let Claude touch. Mirrors
// the patterns in hooks/protect-files.cjs in the real repo; kept lean here
// so the example stays self-contained and deterministic.
const PROTECTED_BASENAME_PATTERNS = [
  /^\.env(\..+)?$/,             // .env, .env.local, .env.production, ...
  /^package-lock\.json$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /^Gemfile\.lock$/,
  /^Cargo\.lock$/,
  /^poetry\.lock$/,
];

function basename(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return "";
  // Split on both separators so Windows-style backslash paths resolve the
  // same as POSIX forward-slash paths. Trailing separators are tolerated by
  // filtering empty trailing segments.
  const segments = filePath.split(/[\\/]/);
  while (segments.length > 0 && segments[segments.length - 1] === "") {
    segments.pop();
  }
  return segments[segments.length - 1] ?? "";
}

function isProtectedPath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return false;
  // .git/ tree is always off-limits (mirrors protect-files.cjs). Match
  // segment-wise on both separators and case-insensitively so Windows-style
  // paths and case variants (".GIT/HEAD") cannot bypass the guard.
  const segments = filePath.split(/[\\/]/);
  if (segments.some((segment) => segment.toLowerCase() === ".git")) {
    return true;
  }
  const base = basename(filePath);
  return PROTECTED_BASENAME_PATTERNS.some((rx) => rx.test(base));
}

/**
 * @type {import("../../lattice.d.ts").LatticeProvider}
 */
export const clawbackProvider = {
  name: "clawback",
  contractVersion: 1,
  handlers: {
    // ── PreToolUse ────────────────────────────────────────────────────
    // Real impl: hooks/protect-files.cjs. Inspects payload.tool_input
    // for file_path / edits[].file_path and denies edits to protected
    // files. Returns a v1 `decision: "deny"` so the dispatcher renders
    // the canonical PreToolUse JSON.
    PreToolUse(ctx, payload) {
      const filePath = payload?.tool_input?.file_path;
      if (isProtectedPath(filePath)) {
        return {
          decision: "deny",
          reason: `clawback: protected file: ${filePath}`,
        };
      }
      return {};
    },

    // ── PostToolUse ───────────────────────────────────────────────────
    // Real impl: hooks/post-edit.cjs. Detects the project stack via
    // lib/detect-stack.cjs, then runs the matching formatter + linter
    // (prettier/eslint, gofmt, cargo fmt, ruff, pint, ...). Pure
    // side-effect: returns `{}` because the v1 PostToolUse dispatcher
    // emits no decision JSON for an empty result.
    PostToolUse(ctx, payload) {
      const toolName = payload?.tool_name ?? "unknown-tool";
      ctx.log(`would format+lint after ${toolName}`);
      return {};
    },

    // ── Stop ──────────────────────────────────────────────────────────
    // Real impl: hooks/stop-verify.cjs. Runs typecheck + lint, and if
    // either fails surfaces a `hookSpecificOutput.decision: "block"`
    // back to Claude so the model is forced to fix before completing.
    // The CLAWBACK_FORCE_BLOCK env var is the test/demo lever — the
    // real impl would derive the block decision from subprocess exit
    // codes.
    Stop(ctx, _payload) {
      ctx.log("would run typecheck+lint");
      const result = {
        additionalContext:
          "clawback: verification gate stub (real impl would run typecheck+lint here)",
      };
      if (ctx.env.CLAWBACK_FORCE_BLOCK === "1") {
        result.hookSpecificOutput = {
          decision: "block",
          reason: "clawback: stubbed block",
        };
      }
      return result;
    },

    // ── PostCompact ───────────────────────────────────────────────────
    // PostCompact is side-effect-only in current Claude/Codex hook schemas.
    // Re-injection should run through SessionStart's compact matcher instead.
    PostCompact(_ctx, _payload) {
      return {};
    },

    // ── Notification ──────────────────────────────────────────────────
    // Real impl: hooks/notification.cjs. Fires a desktop notification
    // (osascript on macOS, notify-send on Linux) when Claude pauses for
    // input. Pure side-effect: returns `{}` because Notification has no
    // dispatcher-rendered response shape in v1.
    Notification(ctx, payload) {
      const message = payload?.message ?? "";
      ctx.log(`would send desktop notification: ${message}`);
      return {};
    },
  },
};

export default clawbackProvider;
