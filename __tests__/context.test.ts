import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createContext } from "../context.mjs";

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeXdgDir() {
  const dir = mkdtempSync(join(tmpdir(), "lattice-context-test-"));
  createdDirs.push(dir);
  return dir;
}

describe("createContext", () => {
  it("returns a frozen ctx with normalized client and contract version 1", () => {
    const xdg = makeXdgDir();
    const { ctx, dispose } = createContext({
      client: "claude",
      event: "PreToolUse",
      providerName: "test",
      env: { XDG_STATE_HOME: xdg },
    });
    try {
      expect(ctx.client).toBe("claude-code");
      expect(ctx.contractVersion).toBe(1);
      expect(ctx.event).toBe("PreToolUse");
      expect(Object.isFrozen(ctx)).toBe(true);
      expect(Object.isFrozen(ctx.env)).toBe(true);
    } finally {
      dispose();
    }
  });

  it("creates the per-provider stateDir under XDG_STATE_HOME", () => {
    const xdg = makeXdgDir();
    const { ctx, dispose } = createContext({
      client: "claude-code",
      event: "SessionStart",
      providerName: "clawback",
      env: { XDG_STATE_HOME: xdg },
    });
    try {
      expect(ctx.stateDir).toBe(resolve(xdg, "lattice/providers/clawback"));
      expect(existsSync(ctx.stateDir)).toBe(true);
      expect(statSync(ctx.stateDir).isDirectory()).toBe(true);
    } finally {
      dispose();
    }
  });

  it("sanitizes scoped provider names in the stateDir path", () => {
    const xdg = makeXdgDir();
    const { ctx, dispose } = createContext({
      client: "claude-code",
      event: "SessionStart",
      providerName: "@lattice/clawback",
      env: { XDG_STATE_HOME: xdg },
    });
    try {
      expect(ctx.stateDir).toContain("@lattice/clawback");
      expect(existsSync(ctx.stateDir)).toBe(true);
    } finally {
      dispose();
    }
  });

  it("skips stateDir creation when skipStateDirCreation is true", () => {
    const xdg = makeXdgDir();
    const { ctx, dispose } = createContext({
      client: "claude-code",
      event: "PreToolUse",
      providerName: "test",
      env: { XDG_STATE_HOME: xdg },
      skipStateDirCreation: true,
    });
    try {
      expect(existsSync(ctx.stateDir)).toBe(false);
    } finally {
      dispose();
    }
  });

  it("exposes a frozen env snapshot independent of process.env", () => {
    const xdg = makeXdgDir();
    const { ctx, dispose } = createContext({
      client: "claude-code",
      event: "PreToolUse",
      providerName: "test",
      env: { XDG_STATE_HOME: xdg, CUSTOM: "1", DROPPED: undefined as unknown as string },
    });
    try {
      expect(ctx.env.CUSTOM).toBe("1");
      expect(ctx.env.DROPPED).toBeUndefined();
      expect(() => {
        (ctx.env as Record<string, string>).MUTATED = "x";
      }).toThrow();
    } finally {
      dispose();
    }
  });

  it("log writes prefixed lines to the provided stderr writer", () => {
    const xdg = makeXdgDir();
    const writes: string[] = [];
    const { ctx, dispose } = createContext({
      client: "claude-code",
      event: "PreToolUse",
      providerName: "clawback",
      env: { XDG_STATE_HOME: xdg },
      stderrWrite: (line) => writes.push(line),
    });
    try {
      ctx.log("hello");
      ctx.log("world");
      expect(writes).toEqual(["lattice[clawback]: hello\n", "lattice[clawback]: world\n"]);
    } finally {
      dispose();
    }
  });

  it("wires a signal that fires when the per-event timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      const xdg = makeXdgDir();
      const { ctx, dispose } = createContext({
        client: "claude-code",
        event: "PreToolUse",
        providerName: "test",
        env: { XDG_STATE_HOME: xdg, LATTICE_TIMEOUT_PRE_TOOL_USE: "100" },
      });
      try {
        expect(ctx.signal.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(150);
        expect(ctx.signal.aborted).toBe(true);
      } finally {
        dispose();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispose() aborts the signal and stops the timer", () => {
    vi.useFakeTimers();
    try {
      const xdg = makeXdgDir();
      const { ctx, dispose } = createContext({
        client: "claude-code",
        event: "Stop",
        providerName: "test",
        env: { XDG_STATE_HOME: xdg },
      });
      expect(ctx.signal.aborted).toBe(false);
      dispose();
      expect(ctx.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws when event or providerName is missing", () => {
    expect(() =>
      createContext({
        client: "claude-code",
        event: "",
        providerName: "x",
      }),
    ).toThrow(/event/);
    expect(() =>
      createContext({
        client: "claude-code",
        event: "Stop",
        providerName: "",
      }),
    ).toThrow(/providerName/);
  });

  it("accepts an external AbortController for cancellation", () => {
    const xdg = makeXdgDir();
    const controller = new AbortController();
    const { ctx, dispose } = createContext({
      client: "claude-code",
      event: "Stop",
      providerName: "test",
      env: { XDG_STATE_HOME: xdg },
      abortController: controller,
    });
    try {
      controller.abort(new Error("caller cancelled"));
      expect(ctx.signal.aborted).toBe(true);
    } finally {
      dispose();
    }
  });
});
