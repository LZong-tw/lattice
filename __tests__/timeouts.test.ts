import { describe, expect, it } from "vitest";

import {
  DEFAULT_FALLBACK_MS,
  DEFAULT_TIMEOUTS,
  pascalToScreamingSnake,
  resolveTimeout,
} from "../timeouts.mjs";

describe("DEFAULT_TIMEOUTS", () => {
  it("ships budgets for the six events lattice dispatches in v1", () => {
    expect(DEFAULT_TIMEOUTS.PreToolUse).toBe(5_000);
    expect(DEFAULT_TIMEOUTS.PostToolUse).toBe(5_000);
    expect(DEFAULT_TIMEOUTS.Stop).toBe(60_000);
    expect(DEFAULT_TIMEOUTS.SessionStart).toBe(30_000);
    expect(DEFAULT_TIMEOUTS.PostCompact).toBe(10_000);
    expect(DEFAULT_TIMEOUTS.Notification).toBe(5_000);
  });

  it("freezes the defaults table", () => {
    expect(Object.isFrozen(DEFAULT_TIMEOUTS)).toBe(true);
  });
});

describe("pascalToScreamingSnake", () => {
  it("converts simple PascalCase", () => {
    expect(pascalToScreamingSnake("PreToolUse")).toBe("PRE_TOOL_USE");
    expect(pascalToScreamingSnake("Stop")).toBe("STOP");
    expect(pascalToScreamingSnake("SessionStart")).toBe("SESSION_START");
    expect(pascalToScreamingSnake("PostCompact")).toBe("POST_COMPACT");
  });

  it("handles acronym boundaries", () => {
    expect(pascalToScreamingSnake("MCPReady")).toBe("MCP_READY");
    expect(pascalToScreamingSnake("HTTPRequest")).toBe("HTTP_REQUEST");
  });

  it("returns empty for empty or non-string input", () => {
    expect(pascalToScreamingSnake("")).toBe("");
    expect(pascalToScreamingSnake(undefined as unknown as string)).toBe("");
  });
});

describe("resolveTimeout", () => {
  it("returns the per-event default when env is empty", () => {
    expect(resolveTimeout("PreToolUse", { env: {} })).toBe(5_000);
    expect(resolveTimeout("Stop", { env: {} })).toBe(60_000);
  });

  it("honors LATTICE_TIMEOUT_<EVENT> overrides", () => {
    expect(
      resolveTimeout("PreToolUse", { env: { LATTICE_TIMEOUT_PRE_TOOL_USE: "1234" } }),
    ).toBe(1234);
    expect(resolveTimeout("Stop", { env: { LATTICE_TIMEOUT_STOP: "120000" } })).toBe(120_000);
  });

  it("falls back to LATTICE_TIMEOUT_DEFAULT for unknown events", () => {
    expect(
      resolveTimeout("UserPromptSubmit", { env: { LATTICE_TIMEOUT_DEFAULT: "7777" } }),
    ).toBe(7777);
  });

  it("falls back to DEFAULT_FALLBACK_MS when nothing matches", () => {
    expect(resolveTimeout("UserPromptSubmit", { env: {} })).toBe(DEFAULT_FALLBACK_MS);
  });

  it("prefers per-event env over the global default", () => {
    expect(
      resolveTimeout("Stop", {
        env: { LATTICE_TIMEOUT_STOP: "1000", LATTICE_TIMEOUT_DEFAULT: "9999" },
      }),
    ).toBe(1000);
  });

  it("throws on invalid timeout values", () => {
    expect(() =>
      resolveTimeout("PreToolUse", { env: { LATTICE_TIMEOUT_PRE_TOOL_USE: "0" } }),
    ).toThrow(/invalid timeout value/);
    expect(() =>
      resolveTimeout("PreToolUse", { env: { LATTICE_TIMEOUT_PRE_TOOL_USE: "-5" } }),
    ).toThrow(/invalid timeout value/);
    expect(() =>
      resolveTimeout("PreToolUse", { env: { LATTICE_TIMEOUT_PRE_TOOL_USE: "abc" } }),
    ).toThrow(/invalid timeout value/);
    expect(() =>
      resolveTimeout("PreToolUse", { env: { LATTICE_TIMEOUT_PRE_TOOL_USE: "10.5" } }),
    ).toThrow(/invalid timeout value/);
  });

  it("ignores empty env values and falls through", () => {
    expect(
      resolveTimeout("PreToolUse", {
        env: { LATTICE_TIMEOUT_PRE_TOOL_USE: "  " },
      }),
    ).toBe(5_000);
  });
});
