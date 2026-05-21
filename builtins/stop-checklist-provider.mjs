#!/usr/bin/env node
/**
 * builtins/stop-checklist-provider.mjs — Stop hook checklist + verify gate.
 *
 * Built-in v1 provider that handles the Stop event:
 *   - Always prints the end-of-turn checklist to stderr via ctx.log.
 *   - When `LATTICE_VERIFY_ON_STOP === "1"`, runs project verification
 *     (typecheck + lint on changed files, with a circuit breaker after
 *     N consecutive failures) via `verification/verify.mjs`.
 *
 * Result shapes per verification status:
 *   - "passed" / "skipped": `{}` (no stdout)
 *   - "allowed" (circuit breaker tripped): `{ additionalContext }`
 *   - "failed": `{ hookSpecificOutput: { decision: "block" }, additionalContext }`
 *
 * Verification is synchronous (spawnSync). ctx.signal cannot interrupt it
 * mid-flight — the underlying child-process timeouts in verify.mjs handle
 * cancellation.
 */

import path from "node:path";

import { messages } from "../common.mjs";
import { STOP_DECISIONS } from "../dispatcher.mjs";

/**
 * Sanitize `payload.cwd` against `ctx.repoRoot` before handing it to
 * `runProjectVerification`. A hostile payload that points cwd outside
 * the hook's repoRoot could otherwise trick verification into running
 * an attacker-staged package.json `scripts.typecheck`.
 *
 * Containment check: resolved payload.cwd must equal or be a descendant
 * of ctx.repoRoot. If it isn't, replace cwd with repoRoot (so verify
 * runs inside the trusted root) and log a warning via ctx.log.
 *
 * The check is gated on `LATTICE_REPO_ROOT` being set — that env var is
 * the operator's explicit assertion of "this is the real repo, enforce
 * it". Without it, ctx.repoRoot may resolve to the lattice install dir
 * (via common.mjs heuristics), in which case enforcing containment
 * would incorrectly redirect every legitimate user's payload.cwd into
 * the lattice install dir. The defense-in-depth check in verify.mjs
 * still applies regardless.
 */
function sanitizePayloadCwd(payload, ctx) {
  if (!payload || typeof payload !== "object") return payload;
  if (!ctx.env.LATTICE_REPO_ROOT) return payload;

  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  if (!cwd) return payload;

  const resolvedCwd = path.resolve(cwd);
  const repoRoot = path.resolve(ctx.repoRoot);
  const boundary = repoRoot.endsWith(path.sep) ? repoRoot : repoRoot + path.sep;
  if (resolvedCwd === repoRoot || resolvedCwd.startsWith(boundary)) {
    return payload;
  }

  ctx.log(
    `ignoring payload.cwd "${cwd}" — outside LATTICE_REPO_ROOT "${repoRoot}". Verification will run inside repoRoot.`,
  );
  return { ...payload, cwd: repoRoot };
}

function runVerification(payload) {
  // Dynamic import keeps the verify module out of the hot path when
  // LATTICE_VERIFY_ON_STOP is unset.
  return import("../verification/verify.mjs").then(({ runProjectVerification }) =>
    runProjectVerification({ payload }),
  );
}

function buildStopResult(status, message) {
  if (status === "failed") {
    return {
      hookSpecificOutput: { decision: STOP_DECISIONS.BLOCK },
      additionalContext: message,
    };
  }
  if (status === "allowed") {
    return { additionalContext: message };
  }
  return {};
}

export const stopChecklistProvider = Object.freeze({
  name: "lattice/stop-checklist",
  contractVersion: 1,
  handlers: Object.freeze({
    async Stop(ctx, payload) {
      ctx.log(`\n${messages.stopChecklist}`);

      if (ctx.env.LATTICE_VERIFY_ON_STOP !== "1") {
        return {};
      }

      const safePayload = sanitizePayloadCwd(payload, ctx);
      const result = await runVerification(safePayload);

      if (ctx.env.LATTICE_VERIFY_VERBOSE === "1" && result.status !== "failed") {
        ctx.log(`verification: ${result.message}`);
      }

      return buildStopResult(result.status, result.message);
    },
  }),
});
