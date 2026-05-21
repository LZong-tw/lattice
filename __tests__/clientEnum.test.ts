import { describe, expect, it, vi } from "vitest";

import {
  ALL_CLIENTS,
  CLIENTS,
  __resetClientWarnings,
  isKnownClient,
  normalizeClient,
  normalizeClientStrict,
} from "../client-enum.mjs";

describe("CLIENTS", () => {
  it("exposes the three canonical identifiers", () => {
    expect(CLIENTS.CLAUDE_CODE).toBe("claude-code");
    expect(CLIENTS.CODEX).toBe("codex");
    expect(CLIENTS.COPILOT_CLI).toBe("copilot-cli");
  });

  it("freezes the record and the all-clients list", () => {
    expect(Object.isFrozen(CLIENTS)).toBe(true);
    expect(Object.isFrozen(ALL_CLIENTS)).toBe(true);
    expect(ALL_CLIENTS).toEqual(["claude-code", "codex", "copilot-cli"]);
  });
});

describe("normalizeClient", () => {
  it("passes canonical forms through unchanged without warning", () => {
    __resetClientWarnings();
    const warn = vi.fn();

    expect(normalizeClient("claude-code", { warn })).toBe("claude-code");
    expect(normalizeClient("codex", { warn })).toBe("codex");
    expect(normalizeClient("copilot-cli", { warn })).toBe("copilot-cli");
    expect(warn).not.toHaveBeenCalled();
  });

  it("maps bare forms to canonical and warns once per form", () => {
    __resetClientWarnings();
    const warn = vi.fn();

    expect(normalizeClient("claude", { warn })).toBe("claude-code");
    expect(normalizeClient("claude", { warn })).toBe("claude-code");
    expect(normalizeClient("copilot", { warn })).toBe("copilot-cli");

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('"claude" is deprecated'),
    );
    expect(warn).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('"copilot" is deprecated'),
    );
  });

  it("returns unknown identifiers as-is", () => {
    expect(normalizeClient("zed", { warn: vi.fn() })).toBe("zed");
  });

  it("returns undefined for non-string or empty input", () => {
    expect(normalizeClient(undefined)).toBeUndefined();
    expect(normalizeClient(null)).toBeUndefined();
    expect(normalizeClient(123)).toBeUndefined();
    expect(normalizeClient("")).toBeUndefined();
    expect(normalizeClient("   ")).toBeUndefined();
  });

  it("trims and lowercases canonical lookups", () => {
    __resetClientWarnings();
    expect(normalizeClient("  CLAUDE-CODE  ", { warn: vi.fn() })).toBe("claude-code");
  });
});

describe("normalizeClientStrict", () => {
  it("returns canonical for valid inputs", () => {
    __resetClientWarnings();
    expect(normalizeClientStrict("claude-code", { warn: vi.fn() })).toBe("claude-code");
    expect(normalizeClientStrict("codex", { warn: vi.fn() })).toBe("codex");
  });

  it("throws on unknown inputs", () => {
    expect(() => normalizeClientStrict("zed")).toThrow(/unknown client identifier "zed"/);
    expect(() => normalizeClientStrict(undefined as unknown as string)).toThrow();
  });
});

describe("isKnownClient", () => {
  it("recognizes both canonical and bare forms", () => {
    expect(isKnownClient("claude-code")).toBe(true);
    expect(isKnownClient("claude")).toBe(true);
    expect(isKnownClient("CODEX")).toBe(true);
    expect(isKnownClient("zed")).toBe(false);
    expect(isKnownClient(undefined)).toBe(false);
  });
});
