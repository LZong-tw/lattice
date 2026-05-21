import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sembleProvider } from "../semble/provider.mjs";
import { mockContext } from "../testing.mjs";

vi.mock("../semble/mcp-config-guard.mjs", () => ({
  validateRequiredSembleMcpConfig: vi.fn(),
}));

// Imported after the mock is declared so the test sees the mocked symbol.
const { validateRequiredSembleMcpConfig } = await import(
  "../semble/mcp-config-guard.mjs"
);
const validateMock = validateRequiredSembleMcpConfig as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  validateMock.mockReset();
});

afterEach(() => {
  validateMock.mockReset();
});

describe("sembleProvider — shape", () => {
  it("declares the v1 provider surface", () => {
    expect(sembleProvider.name).toBe("semble");
    expect(sembleProvider.contractVersion).toBe(1);
    expect(typeof sembleProvider.validate).toBe("function");
    expect("handlers" in sembleProvider).toBe(false);
  });

  it("encodes the Copilot exclusion via supportedClients", () => {
    expect(Array.from(sembleProvider.supportedClients ?? [])).toEqual([
      "claude-code",
      "codex",
    ]);
  });
});

describe("sembleProvider.validate", () => {
  it("returns {ok: true} and skips the guard when LATTICE_REQUIRE_SEMBLE_MCP is unset", async () => {
    const { ctx, dispose } = mockContext({ client: "claude-code" });
    try {
      const result = await sembleProvider.validate!(ctx);
      expect(result).toEqual({ ok: true });
      expect(validateMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("forwards a passing guard result when the flag is '1'", async () => {
    validateMock.mockReturnValue({ ok: true, failures: [] });

    const { ctx, dispose } = mockContext({
      client: "claude-code",
      env: { LATTICE_REQUIRE_SEMBLE_MCP: "1" },
    });
    try {
      const result = await sembleProvider.validate!(ctx);
      expect(result).toEqual({ ok: true, failures: [] });
      expect(validateMock).toHaveBeenCalledOnce();
      // Canonical "claude-code" maps to the bare "claude" the guard expects.
      expect(validateMock).toHaveBeenCalledWith("claude");
    } finally {
      dispose();
    }
  });

  it("forwards a failing guard result with failure bullets", async () => {
    validateMock.mockReturnValue({
      ok: false,
      failures: [".mcp.json mcpServers.semble must define args as a string array."],
    });

    const { ctx, dispose } = mockContext({
      client: "codex",
      env: { LATTICE_REQUIRE_SEMBLE_MCP: "1" },
    });
    try {
      const result = await sembleProvider.validate!(ctx);
      expect(result).toEqual({
        ok: false,
        failures: [
          ".mcp.json mcpServers.semble must define args as a string array.",
        ],
      });
      // Canonical "codex" passes through as bare "codex".
      expect(validateMock).toHaveBeenCalledWith("codex");
    } finally {
      dispose();
    }
  });

  it("passes the raw client through when no canonical mapping applies", async () => {
    validateMock.mockReturnValue({ ok: true, failures: [] });

    const { ctx, dispose } = mockContext({
      client: "codex",
      env: { LATTICE_REQUIRE_SEMBLE_MCP: "1" },
    });
    try {
      await sembleProvider.validate!(ctx);
      expect(validateMock).toHaveBeenCalledWith("codex");
    } finally {
      dispose();
    }
  });
});
