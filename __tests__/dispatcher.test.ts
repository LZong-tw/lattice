import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EVENT_NAMES,
  PERMISSION_DECISIONS,
  STOP_DECISIONS,
  dispatch,
} from "../dispatcher.mjs";
import {
  clearRegistrations,
  getRegisteredProviders,
  registerProvider,
  resolveEffectiveProviders,
} from "../provider-registry.mjs";

const baseEnv = {
  XDG_STATE_HOME: "/tmp/lattice-dispatcher-test-state",
  LATTICE_PROVIDERS: "",
};

beforeEach(() => {
  clearRegistrations();
});

afterEach(() => {
  clearRegistrations();
});

function captureStreams() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    write: (line: string) => stdout.push(line),
    err: (line: string) => stderr.push(line),
  };
}

function providerNames(selection: { providers: Array<{ name?: string }> }) {
  return selection.providers.map((provider) => provider.name);
}

describe("dispatch — registration + selection", () => {
  it("invokes a registered handler for the matching event", async () => {
    const handler = vi.fn().mockResolvedValue({});
    registerProvider({
      name: "alpha",
      contractVersion: 1,
      handlers: { PreToolUse: handler },
    });

    const streams = captureStreams();
    const code = await dispatch(
      "PreToolUse",
      { tool_name: "Bash" },
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "alpha" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    expect(code).toBe(0);
    expect(handler).toHaveBeenCalledOnce();
    const [ctx, payload] = handler.mock.calls[0]!;
    expect(ctx.client).toBe("claude-code");
    expect(ctx.event).toBe("PreToolUse");
    expect(payload).toEqual({ tool_name: "Bash" });
  });

  it("uses LATTICE_PROVIDERS as a strict allowlist, not an optional-provider opt-in", () => {
    registerProvider({
      name: "lattice/protection",
      contractVersion: 1,
      handlers: { PreToolUse: vi.fn() },
    });
    registerProvider({
      name: "serena",
      contractVersion: 1,
      handlers: { SessionStart: vi.fn() },
    });
    registerProvider({
      name: "rtk",
      contractVersion: 1,
      handlers: { PreToolUse: vi.fn() },
    });

    const defaultSelection = resolveEffectiveProviders({
      env: {} as NodeJS.ProcessEnv,
      legacy: {},
      onWarn: () => {},
    });
    expect(providerNames(defaultSelection)).toEqual([
      "lattice/protection",
      "serena",
      "rtk",
    ]);

    const allowlistSelection = resolveEffectiveProviders({
      env: { LATTICE_PROVIDERS: "serena,rtk" } as NodeJS.ProcessEnv,
      legacy: {},
      onWarn: () => {},
    });
    expect(providerNames(allowlistSelection)).toEqual([
      "serena",
      "rtk",
    ]);
    expect(
      providerNames(allowlistSelection).some((name) => name === "lattice/protection"),
    ).toBe(false);

    const subtractiveSelection = resolveEffectiveProviders({
      env: { LATTICE_DISABLE: "serena" } as NodeJS.ProcessEnv,
      legacy: {},
      onWarn: () => {},
    });
    expect(providerNames(subtractiveSelection)).toEqual([
      "lattice/protection",
      "rtk",
    ]);
  });

  it("skips providers whose handlers map omits the event", async () => {
    const handler = vi.fn().mockResolvedValue({});
    registerProvider({
      name: "alpha",
      contractVersion: 1,
      handlers: { Stop: handler },
    });

    const streams = captureStreams();
    const code = await dispatch(
      "PreToolUse",
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "alpha" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    expect(code).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("filters providers by supportedClients", async () => {
    const handler = vi.fn().mockResolvedValue({});
    registerProvider({
      name: "claude-only",
      contractVersion: 1,
      supportedClients: ["claude-code"],
      handlers: { PreToolUse: handler },
    });

    const streams = captureStreams();
    await dispatch(
      "PreToolUse",
      {},
      {
        client: "copilot-cli",
        env: { ...baseEnv, LATTICE_PROVIDERS: "claude-only" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    expect(handler).not.toHaveBeenCalled();
  });

  it("fails fast when LATTICE_PROVIDERS names an unknown provider", async () => {
    registerProvider({
      name: "alpha",
      contractVersion: 1,
      handlers: { PreToolUse: () => ({}) },
    });

    const streams = captureStreams();
    const code = await dispatch(
      "PreToolUse",
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "alpha,ghost" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    expect(code).toBe(1);
    expect(streams.stderr.join("")).toContain("unknown provider");
    expect(streams.stderr.join("")).toContain("ghost");
  });
});

describe("dispatch — merge rules", () => {
  it("deny beats allow regardless of order", async () => {
    registerProvider({
      name: "permitter",
      contractVersion: 1,
      handlers: { PreToolUse: () => ({ decision: "allow" }) },
    });
    registerProvider({
      name: "denier",
      contractVersion: 1,
      handlers: { PreToolUse: () => ({ decision: "deny", reason: "policy" }) },
    });

    const streams = captureStreams();
    await dispatch(
      "PreToolUse",
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "permitter,denier" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    const out = JSON.parse(streams.stdout.join("").trim());
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("denier: policy");
  });

  it("ignores allow-voter reasons when a deny lands", async () => {
    registerProvider({
      name: "permitter",
      contractVersion: 1,
      handlers: {
        PreToolUse: () => ({ decision: "allow", reason: "user is admin" }),
      },
    });
    registerProvider({
      name: "denier",
      contractVersion: 1,
      handlers: {
        PreToolUse: () => ({ decision: "deny", reason: "blocked path" }),
      },
    });

    const streams = captureStreams();
    await dispatch(
      "PreToolUse",
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "permitter,denier" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    const out = JSON.parse(streams.stdout.join("").trim());
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    const reason = out.hookSpecificOutput.permissionDecisionReason as string;
    expect(reason).toContain("denier: blocked path");
    expect(reason).not.toContain("permitter");
    expect(reason).not.toContain("user is admin");
  });

  it("concatenates reasons with bullets prefixed by provider name", async () => {
    registerProvider({
      name: "first",
      contractVersion: 1,
      handlers: { PreToolUse: () => ({ decision: "deny", reason: "env file" }) },
    });
    registerProvider({
      name: "second",
      contractVersion: 1,
      handlers: { PreToolUse: () => ({ decision: "deny", reason: "lockfile" }) },
    });

    const streams = captureStreams();
    await dispatch(
      "PreToolUse",
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "first,second" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    const out = JSON.parse(streams.stdout.join("").trim());
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe("• first: env file\n• second: lockfile");
  });

  it("concatenates additionalContext with double newlines for Stop", async () => {
    registerProvider({
      name: "first",
      contractVersion: 1,
      handlers: { Stop: () => ({ additionalContext: "context A" }) },
    });
    registerProvider({
      name: "second",
      contractVersion: 1,
      handlers: { Stop: () => ({ additionalContext: "context B" }) },
    });

    const streams = captureStreams();
    await dispatch(
      "Stop",
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "first,second" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    const out = JSON.parse(streams.stdout.join("").trim());
    expect(out.additionalContext).toBe("context A\n\ncontext B");
  });

  it("takes the max exitCode across providers", async () => {
    registerProvider({
      name: "soft",
      contractVersion: 1,
      handlers: { PostToolUse: () => ({ exitCode: 0 }) },
    });
    registerProvider({
      name: "hard",
      contractVersion: 1,
      handlers: { PostToolUse: () => ({ exitCode: 3 }) },
    });

    const streams = captureStreams();
    const code = await dispatch(
      "PostToolUse",
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "soft,hard" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    expect(code).toBe(3);
  });

  it("preserves block decision in hookSpecificOutput merge", async () => {
    registerProvider({
      name: "blocker",
      contractVersion: 1,
      handlers: {
        Stop: () => ({ hookSpecificOutput: { decision: "block", reason: "lint failed" } }),
      },
    });
    registerProvider({
      name: "noiseproducer",
      contractVersion: 1,
      handlers: {
        Stop: () => ({ hookSpecificOutput: { extra: "info" } }),
      },
    });

    const streams = captureStreams();
    await dispatch(
      "Stop",
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "blocker,noiseproducer" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    const out = JSON.parse(streams.stdout.join("").trim());
    expect(out.hookSpecificOutput.decision).toBe("block");
    expect(out.hookSpecificOutput.extra).toBe("info");
  });

  it("emits no stdout for side-effect-only events when no decision is produced", async () => {
    registerProvider({
      name: "noop",
      contractVersion: 1,
      handlers: { Notification: () => ({}) },
    });

    const streams = captureStreams();
    await dispatch(
      "Notification",
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "noop" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    expect(streams.stdout.join("")).toBe("");
  });
});

describe("dispatch — validators", () => {
  it("runs validators before handlers and fails the dispatch on validator failure", async () => {
    const handler = vi.fn().mockResolvedValue({});
    registerProvider({
      name: "gated",
      contractVersion: 1,
      validate: () => ({ ok: false, failures: ["missing config A", "missing config B"] }),
      handlers: { SessionStart: handler },
    });

    const streams = captureStreams();
    const code = await dispatch(
      "SessionStart",
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "gated" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    expect(code).toBe(1);
    expect(handler).not.toHaveBeenCalled();
    const stderrText = streams.stderr.join("");
    expect(stderrText).toContain('provider "gated" validation failed');
    expect(stderrText).toContain("missing config A");
    expect(stderrText).toContain("missing config B");
  });

  it("aggregates thrown validator errors across providers", async () => {
    const handler = vi.fn().mockResolvedValue({});
    registerProvider({
      name: "alpha",
      contractVersion: 1,
      validate: () => {
        throw new Error("alpha boom");
      },
      handlers: { SessionStart: handler },
    });
    registerProvider({
      name: "bravo",
      contractVersion: 1,
      validate: () => {
        throw new Error("bravo boom");
      },
      handlers: { SessionStart: handler },
    });

    const streams = captureStreams();
    const code = await dispatch(
      "SessionStart",
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "alpha,bravo" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    expect(code).toBe(1);
    expect(handler).not.toHaveBeenCalled();
    const stderrText = streams.stderr.join("");
    expect(stderrText).toContain('provider "alpha" validation failed');
    expect(stderrText).toContain("alpha boom");
    expect(stderrText).toContain('provider "bravo" validation failed');
    expect(stderrText).toContain("bravo boom");
  });

  it("proceeds when validators return ok:true", async () => {
    const handler = vi.fn().mockResolvedValue({});
    registerProvider({
      name: "gated",
      contractVersion: 1,
      validate: () => ({ ok: true }),
      handlers: { SessionStart: handler },
    });

    const streams = captureStreams();
    const code = await dispatch(
      "SessionStart",
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "gated" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    expect(code).toBe(0);
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("dispatch — error handling", () => {
  it("returns 1 and logs when a handler throws", async () => {
    registerProvider({
      name: "boom",
      contractVersion: 1,
      handlers: {
        PreToolUse: () => {
          throw new Error("kaboom");
        },
      },
    });

    const streams = captureStreams();
    const code = await dispatch(
      "PreToolUse",
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "boom" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    expect(code).toBe(1);
    expect(streams.stderr.join("")).toContain('provider "boom" handler failed: kaboom');
  });

  it("treats a timed-out handler as skipped, not fatal", async () => {
    registerProvider({
      name: "slow",
      contractVersion: 1,
      handlers: {
        PreToolUse: () =>
          new Promise(() => {
            /* never resolves */
          }),
      },
    });
    registerProvider({
      name: "fast",
      contractVersion: 1,
      handlers: { PreToolUse: () => ({ decision: "deny", reason: "fast lane" }) },
    });

    const streams = captureStreams();
    const code = await dispatch(
      "PreToolUse",
      {},
      {
        client: "claude-code",
        env: {
          ...baseEnv,
          LATTICE_PROVIDERS: "slow,fast",
          LATTICE_TIMEOUT_PRE_TOOL_USE: "50",
        },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    expect(code).toBe(0);
    const stderrText = streams.stderr.join("");
    expect(stderrText).toContain('provider "slow" timed out at event PreToolUse');
    const out = JSON.parse(streams.stdout.join("").trim());
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("fast: fast lane");
  });
});

describe("dispatch — legacy bootstrap auto-wrap", () => {
  it("aborts a hung legacy bootstrap when ctx.signal fires", async () => {
    // Legacy bootstrap signature is (client) => exitCode — no signal slot.
    // The wrapper races bootstrap against ctx.signal so dispatcher
    // timeouts surface as errors instead of hanging the hook even though
    // the bootstrap function itself can't be cancelled.
    const legacyRegistry = {
      stuck: {
        bootstrap: () =>
          new Promise(() => {
            /* never resolves */
          }),
      },
    };

    const selection = resolveEffectiveProviders({
      env: { LATTICE_PROVIDERS: "stuck" } as NodeJS.ProcessEnv,
      runtime: new Map(),
      legacy: legacyRegistry,
      onWarn: () => {
        /* swallow deprecation warning */
      },
    });

    expect(selection.providers).toHaveLength(1);
    const wrapped = selection.providers[0]! as {
      handlers: { SessionStart: (ctx: unknown, payload: unknown) => Promise<unknown> };
    };
    const handler = wrapped.handlers.SessionStart;

    const controller = new AbortController();
    const fakeCtx = {
      client: "claude-code",
      signal: controller.signal,
    };

    // Fire the abort shortly after invocation; the race should reject and
    // surface as a rejected promise from the wrapped handler.
    setTimeout(() => controller.abort(new Error("test: timed out")), 25);

    await expect(handler(fakeCtx, {})).rejects.toThrow(/timed out/);
  });

  it("auto-wraps a legacy {bootstrap} provider into a SessionStart handler", async () => {
    // Register a legacy-shape provider via the runtime registry to avoid
    // mutating the real providerRegistry export.
    const bootstrap = vi.fn().mockResolvedValue(0);
    registerProvider({
      name: "wrapme",
      contractVersion: 1,
      handlers: {
        SessionStart: async (ctx: { client: string }) => {
          const exitCode = await bootstrap(ctx.client);
          return exitCode === 0 ? {} : { exitCode };
        },
      },
    });

    const streams = captureStreams();
    const code = await dispatch(
      "SessionStart",
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "wrapme" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    expect(code).toBe(0);
    expect(bootstrap).toHaveBeenCalledWith("claude-code");
  });
});

describe("dispatch — client-aware rendering", () => {
  it("emits the flat Copilot shape for PreToolUse deny", async () => {
    registerProvider({
      name: "denier",
      contractVersion: 1,
      handlers: {
        PreToolUse: () => ({ decision: PERMISSION_DECISIONS.DENY, reason: "no" }),
      },
    });

    const streams = captureStreams();
    await dispatch(
      EVENT_NAMES.PreToolUse,
      {},
      {
        client: "copilot-cli",
        env: { ...baseEnv, LATTICE_PROVIDERS: "denier" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    const out = JSON.parse(streams.stdout.join("").trim());
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain("denier: no");
    expect(out.hookSpecificOutput).toBeUndefined();
  });

  it("emits the nested Claude/Codex shape for PreToolUse deny", async () => {
    registerProvider({
      name: "denier",
      contractVersion: 1,
      handlers: {
        PreToolUse: () => ({ decision: PERMISSION_DECISIONS.DENY, reason: "no" }),
      },
    });

    const streams = captureStreams();
    await dispatch(
      EVENT_NAMES.PreToolUse,
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "denier" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    const out = JSON.parse(streams.stdout.join("").trim());
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("denier: no");
    expect((out as Record<string, unknown>).permissionDecision).toBeUndefined();
  });
});

describe("dispatch — PostCompact round-trip", () => {
  it("emits empty JSON when no PostCompact provider adds context", async () => {
    registerProvider({
      name: "noop-postcompact",
      contractVersion: 1,
      handlers: {
        PostCompact: () => ({}),
      },
    });

    const streams = captureStreams();
    const code = await dispatch(
      EVENT_NAMES.PostCompact,
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "noop-postcompact" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    expect(code).toBe(0);
    const out = JSON.parse(streams.stdout.join("").trim());
    expect(out).toEqual({});
  });

  it("renders additionalContext from a PostCompact handler", async () => {
    registerProvider({
      name: "reinjector",
      contractVersion: 1,
      handlers: {
        PostCompact: () => ({ additionalContext: "git status: clean" }),
      },
    });

    const streams = captureStreams();
    const code = await dispatch(
      EVENT_NAMES.PostCompact,
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "reinjector" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    expect(code).toBe(0);
    const out = JSON.parse(streams.stdout.join("").trim());
    expect(out.additionalContext).toBe("git status: clean");
  });
});

describe("STOP_DECISIONS", () => {
  it("exposes the block literal for Stop hookSpecificOutput", async () => {
    expect(STOP_DECISIONS.BLOCK).toBe("block");

    registerProvider({
      name: "blocker",
      contractVersion: 1,
      handlers: {
        Stop: () => ({
          hookSpecificOutput: { decision: STOP_DECISIONS.BLOCK, reason: "verify failed" },
        }),
      },
    });

    const streams = captureStreams();
    await dispatch(
      EVENT_NAMES.Stop,
      {},
      {
        client: "claude-code",
        env: { ...baseEnv, LATTICE_PROVIDERS: "blocker" },
        stdout: streams.write,
        stderr: streams.err,
      },
    );

    const out = JSON.parse(streams.stdout.join("").trim());
    expect(out.hookSpecificOutput.decision).toBe("block");
  });
});

describe("registerProvider — validation", () => {
  it("rejects definitions missing required fields", () => {
    expect(() =>
      registerProvider({ name: "x" } as unknown as Parameters<typeof registerProvider>[0]),
    ).toThrow(/contractVersion/);
    expect(() =>
      registerProvider({
        contractVersion: 1,
        handlers: {},
      } as unknown as Parameters<typeof registerProvider>[0]),
    ).toThrow(/non-empty name/);
  });

  it("freezes registered definitions", () => {
    const registered = registerProvider({
      name: "frozen",
      contractVersion: 1,
      handlers: { PreToolUse: () => ({}) },
    });
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered.handlers)).toBe(true);
  });

  it("supports re-registration (last write wins)", () => {
    registerProvider({
      name: "swap",
      contractVersion: 1,
      handlers: { PreToolUse: () => ({ decision: "allow" }) },
    });
    registerProvider({
      name: "swap",
      contractVersion: 1,
      handlers: { PreToolUse: () => ({ decision: "deny", reason: "swapped" }) },
    });
    expect(getRegisteredProviders()).toHaveLength(1);
  });
});
