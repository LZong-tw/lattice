import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { mockContext, mockPayload, runProvider } from "../testing.mjs";

describe("mockContext", () => {
  it("returns a ready-to-use ctx with sensible defaults", () => {
    const { ctx, dispose } = mockContext();
    try {
      expect(ctx.client).toBe("claude-code");
      expect(ctx.event).toBe("PreToolUse");
      expect(ctx.contractVersion).toBe(1);
      expect(existsSync(ctx.stateDir)).toBe(true);
    } finally {
      dispose();
    }
  });

  it("captures log output into the returned stderr array", () => {
    const { ctx, stderr, dispose } = mockContext({ providerName: "captured" });
    try {
      ctx.log("hello");
      expect(stderr).toEqual(["lattice[captured]: hello\n"]);
    } finally {
      dispose();
    }
  });

  it("cleans up the stateDir on dispose", () => {
    const { ctx, dispose } = mockContext();
    const stateDir = ctx.stateDir;
    expect(existsSync(stateDir)).toBe(true);
    dispose();
    expect(existsSync(stateDir)).toBe(false);
  });

  it("forwards env overrides into the context env snapshot", () => {
    const { ctx, dispose } = mockContext({ env: { CUSTOM: "yes" } });
    try {
      expect(ctx.env.CUSTOM).toBe("yes");
    } finally {
      dispose();
    }
  });
});

describe("runProvider", () => {
  it("invokes the handler for the requested event and returns the result", async () => {
    const handler = vi.fn().mockResolvedValue({ decision: "deny", reason: "test" });
    const provider = {
      name: "p1",
      contractVersion: 1 as const,
      handlers: { PreToolUse: handler },
    };

    const { result } = await runProvider(provider, "PreToolUse", mockPayload.preToolUse());
    expect(result).toEqual({ decision: "deny", reason: "test" });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("throws when the provider has no handler for the event", async () => {
    const provider = {
      name: "p2",
      contractVersion: 1 as const,
      handlers: { Stop: () => ({}) },
    };
    await expect(runProvider(provider, "PreToolUse", {})).rejects.toThrow(
      /no handler for event "PreToolUse"/,
    );
  });

  it("runs validator when opts.runValidator is true and short-circuits on failure", async () => {
    const handler = vi.fn().mockResolvedValue({});
    const provider = {
      name: "gated",
      contractVersion: 1 as const,
      validate: () => ({ ok: false, failures: ["missing"] }),
      handlers: { SessionStart: handler },
    };

    const { validatorResult } = await runProvider(
      provider,
      "SessionStart",
      mockPayload.sessionStart(),
      { runValidator: true },
    );
    expect(validatorResult).toEqual({ ok: false, failures: ["missing"] });
    expect(handler).not.toHaveBeenCalled();
  });

  it("skips validators by default", async () => {
    const validate = vi.fn();
    const provider = {
      name: "gated",
      contractVersion: 1 as const,
      validate,
      handlers: { SessionStart: () => ({}) },
    };

    await runProvider(provider, "SessionStart", mockPayload.sessionStart());
    expect(validate).not.toHaveBeenCalled();
  });

  it("normalizes a void/undefined handler return to {}", async () => {
    const provider = {
      name: "void",
      contractVersion: 1 as const,
      handlers: {
        PostToolUse: () => undefined,
      },
    };
    const { result } = await runProvider(provider, "PostToolUse", mockPayload.postToolUse());
    expect(result).toEqual({});
  });

  it("forwards contextOverrides to the underlying context", async () => {
    let observedClient = "";
    const provider = {
      name: "observer",
      contractVersion: 1 as const,
      handlers: {
        PreToolUse: (ctx: { client: string }) => {
          observedClient = ctx.client;
          return {};
        },
      },
    };
    await runProvider(provider, "PreToolUse", mockPayload.preToolUse(), {
      contextOverrides: { client: "codex" },
    });
    expect(observedClient).toBe("codex");
  });
});

describe("mockPayload", () => {
  it("ships builders for every v1 event with sensible defaults", () => {
    expect(mockPayload.preToolUse().hook_event_name).toBe("PreToolUse");
    expect(mockPayload.postToolUse().hook_event_name).toBe("PostToolUse");
    expect(mockPayload.stop().hook_event_name).toBe("Stop");
    expect(mockPayload.sessionStart().hook_event_name).toBe("SessionStart");
    expect(mockPayload.postCompact().hook_event_name).toBe("PostCompact");
    expect(mockPayload.notification().hook_event_name).toBe("Notification");
  });

  it("shallow-merges overrides onto the default shape", () => {
    const payload = mockPayload.preToolUse({ tool_name: "Edit", custom: "x" });
    expect(payload.tool_name).toBe("Edit");
    expect((payload as Record<string, unknown>).custom).toBe("x");
    expect(payload.hook_event_name).toBe("PreToolUse");
  });
});
