#!/usr/bin/env node
/**
 * testing.mjs — provider-author test helpers (`@lattice/core/testing`).
 *
 * Lets external providers (clawback, future packages) write unit tests
 * without booting a real Claude Code session. Three exports:
 *
 *   mockContext({ client, event, providerName, ... })
 *     → builds a LatticeContext with sensible defaults, an in-memory log
 *       sink, an isolated temp stateDir, and a real AbortSignal driven by
 *       the per-event timeout.
 *
 *   runProvider(provider, event, payload, opts?)
 *     → invokes one provider's handler for one event in isolation,
 *       returning the raw LatticeHandlerResult plus stderr capture.
 *       Skips validators by default; pass { runValidator: true } to run.
 *
 *   mockPayload.<event>(overrides?)
 *     → per-event payload builders matching Anthropic's documented shape.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createContext } from "./context.mjs";

function makeTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lattice-testing-"));
}

/**
 * Build a LatticeContext for use in tests.
 *
 * @param {Object} [overrides]
 * @param {string} [overrides.client]         Defaults to "claude-code".
 * @param {string} [overrides.event]          Defaults to "PreToolUse".
 * @param {string} [overrides.providerName]   Defaults to "test".
 * @param {string} [overrides.cwd]            Defaults to process.cwd().
 * @param {string} [overrides.repoRoot]       Defaults to process.cwd().
 * @param {NodeJS.ProcessEnv} [overrides.env] Defaults to a minimal env with XDG_STATE_HOME set.
 * @param {AbortController} [overrides.abortController]
 * @returns {{
 *   ctx: import("./context.mjs").LatticeContext,
 *   stderr: string[],
 *   dispose: () => void,
 * }}
 */
export function mockContext(overrides = {}) {
  const stateDir = makeTempStateDir();
  const env = {
    XDG_STATE_HOME: stateDir,
    ...(overrides.env ?? {}),
  };

  const stderr = [];
  const stderrWrite = (line) => stderr.push(line);

  const { ctx, dispose: ctxDispose } = createContext({
    client: overrides.client ?? "claude-code",
    event: overrides.event ?? "PreToolUse",
    providerName: overrides.providerName ?? "test",
    cwd: overrides.cwd ?? process.cwd(),
    repoRoot: overrides.repoRoot ?? process.cwd(),
    env,
    abortController: overrides.abortController,
    stderrWrite,
  });

  const dispose = () => {
    ctxDispose();
    try {
      fs.rmSync(stateDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  };

  return { ctx, stderr, dispose };
}

/**
 * Run a single provider's handler for a single event in isolation.
 *
 * @param {Object} provider                Provider definition.
 * @param {string} event                   Event name to dispatch.
 * @param {object} payload                 Event payload.
 * @param {Object} [opts]
 * @param {boolean} [opts.runValidator]    Run provider.validate first. Default false.
 * @param {Object} [opts.contextOverrides] Forwarded to mockContext.
 * @returns {Promise<{
 *   result: import("./lattice").LatticeHandlerResult,
 *   stderr: string[],
 *   validatorResult?: import("./lattice").ValidatorResult,
 * }>}
 */
export async function runProvider(provider, event, payload, opts = {}) {
  if (!provider || typeof provider !== "object") {
    throw new Error("runProvider: provider is required");
  }
  if (typeof event !== "string" || event.length === 0) {
    throw new Error("runProvider: event must be a non-empty string");
  }

  const handler = provider.handlers?.[event];
  if (typeof handler !== "function") {
    throw new Error(
      `runProvider: provider "${provider.name}" has no handler for event "${event}"`,
    );
  }

  const { ctx, stderr, dispose } = mockContext({
    providerName: provider.name,
    event,
    ...(opts.contextOverrides ?? {}),
  });

  try {
    let validatorResult;
    if (opts.runValidator && typeof provider.validate === "function") {
      validatorResult = await provider.validate(ctx);
      if (validatorResult && validatorResult.ok === false) {
        return { result: {}, stderr, validatorResult };
      }
    }

    const raw = await handler(ctx, payload);
    const result = raw == null ? {} : raw;
    return { result, stderr, validatorResult };
  } finally {
    dispose();
  }
}

/**
 * Per-event payload builders matching Anthropic's documented hook input
 * shapes. Each builder accepts an overrides object and shallow-merges it
 * onto a sensible default.
 */
export const mockPayload = Object.freeze({
  preToolUse(overrides = {}) {
    return {
      hook_event_name: "PreToolUse",
      session_id: "test-session",
      transcript_path: "/tmp/transcript",
      cwd: process.cwd(),
      tool_name: "Bash",
      tool_input: { command: "ls" },
      ...overrides,
    };
  },
  postToolUse(overrides = {}) {
    return {
      hook_event_name: "PostToolUse",
      session_id: "test-session",
      transcript_path: "/tmp/transcript",
      cwd: process.cwd(),
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: { output: "" },
      ...overrides,
    };
  },
  stop(overrides = {}) {
    return {
      hook_event_name: "Stop",
      session_id: "test-session",
      transcript_path: "/tmp/transcript",
      cwd: process.cwd(),
      stop_hook_active: false,
      ...overrides,
    };
  },
  sessionStart(overrides = {}) {
    return {
      hook_event_name: "SessionStart",
      session_id: "test-session",
      transcript_path: "/tmp/transcript",
      cwd: process.cwd(),
      matcher: "startup",
      ...overrides,
    };
  },
  postCompact(overrides = {}) {
    return {
      hook_event_name: "PostCompact",
      session_id: "test-session",
      transcript_path: "/tmp/transcript",
      cwd: process.cwd(),
      ...overrides,
    };
  },
  notification(overrides = {}) {
    return {
      hook_event_name: "Notification",
      session_id: "test-session",
      transcript_path: "/tmp/transcript",
      cwd: process.cwd(),
      message: "test notification",
      ...overrides,
    };
  },
});
