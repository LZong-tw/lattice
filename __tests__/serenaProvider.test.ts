import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serenaProvider } from "../serena/provider.mjs";
import { mockContext } from "../testing.mjs";

vi.mock("../serena/mcp-config-guard.mjs", () => ({
  validateRequiredSerenaMcpConfig: vi.fn(),
}));

vi.mock("../serena/bootstrap.mjs", () => ({
  bootstrapSerena: vi.fn(),
}));

vi.mock("../serena/cleanup-processes.mjs", () => ({
  cleanupSerenaProcesses: vi.fn(),
}));

// Importing the mocked modules pulls them through vitest's mock factory so we
// can assert on the spies. Top-level imports of the provider above resolve
// against the same mocked modules because the dynamic imports inside provider
// methods go through the same module graph.
const { validateRequiredSerenaMcpConfig } = await import("../serena/mcp-config-guard.mjs");
const { bootstrapSerena } = await import("../serena/bootstrap.mjs");
const { cleanupSerenaProcesses } = await import("../serena/cleanup-processes.mjs");

const validateMock = validateRequiredSerenaMcpConfig as unknown as ReturnType<typeof vi.fn>;
const bootstrapMock = bootstrapSerena as unknown as ReturnType<typeof vi.fn>;
const cleanupMock = cleanupSerenaProcesses as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  validateMock.mockReset();
  bootstrapMock.mockReset();
  cleanupMock.mockReset();
});

afterEach(() => {
  validateMock.mockReset();
  bootstrapMock.mockReset();
  cleanupMock.mockReset();
});

describe("serenaProvider shape", () => {
  it("declares the v1 contract surface", () => {
    expect(serenaProvider.name).toBe("serena");
    expect(serenaProvider.contractVersion).toBe(1);
    expect(typeof serenaProvider.validate).toBe("function");
    expect(typeof serenaProvider.handlers.SessionStart).toBe("function");
  });
});

describe("serenaProvider.validate", () => {
  it("returns { ok: true } when LATTICE_REQUIRE_SERENA_MCP is unset", async () => {
    const { ctx, dispose } = mockContext({ providerName: "serena", event: "SessionStart" });
    try {
      const result = await serenaProvider.validate(ctx);
      expect(result).toEqual({ ok: true });
      expect(validateMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("returns { ok: true } when LATTICE_REQUIRE_SERENA_MCP is not exactly '1'", async () => {
    const { ctx, dispose } = mockContext({
      providerName: "serena",
      event: "SessionStart",
      env: { LATTICE_REQUIRE_SERENA_MCP: "true" },
    });
    try {
      const result = await serenaProvider.validate(ctx);
      expect(result).toEqual({ ok: true });
      expect(validateMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("forwards to validateRequiredSerenaMcpConfig with the bare client form for claude-code", async () => {
    validateMock.mockReturnValue({ ok: true, failures: [] });

    const { ctx, dispose } = mockContext({
      client: "claude-code",
      providerName: "serena",
      event: "SessionStart",
      env: { LATTICE_REQUIRE_SERENA_MCP: "1" },
    });
    try {
      const result = await serenaProvider.validate(ctx);
      expect(validateMock).toHaveBeenCalledOnce();
      expect(validateMock).toHaveBeenCalledWith("claude");
      expect(result).toEqual({ ok: true, failures: [] });
    } finally {
      dispose();
    }
  });

  it("passes codex through unchanged (canonical === bare)", async () => {
    validateMock.mockReturnValue({ ok: true, failures: [] });

    const { ctx, dispose } = mockContext({
      client: "codex",
      providerName: "serena",
      event: "SessionStart",
      env: { LATTICE_REQUIRE_SERENA_MCP: "1" },
    });
    try {
      await serenaProvider.validate(ctx);
      expect(validateMock).toHaveBeenCalledWith("codex");
    } finally {
      dispose();
    }
  });

  it("surfaces failures from the underlying guard", async () => {
    validateMock.mockReturnValue({
      ok: false,
      failures: [".mcp.json mcpServers.serena must launch Serena with uvx directly."],
    });

    const { ctx, dispose } = mockContext({
      client: "claude-code",
      providerName: "serena",
      event: "SessionStart",
      env: { LATTICE_REQUIRE_SERENA_MCP: "1" },
    });
    try {
      const result = (await serenaProvider.validate(ctx)) as {
        ok: boolean;
        failures: string[];
      };
      expect(result.ok).toBe(false);
      expect(result.failures).toHaveLength(1);
    } finally {
      dispose();
    }
  });
});

describe("serenaProvider.handlers.SessionStart", () => {
  it("returns {} when bootstrapSerena reports success (exit 0)", async () => {
    bootstrapMock.mockReturnValue(0);

    const { ctx, dispose } = mockContext({
      client: "claude-code",
      providerName: "serena",
      event: "SessionStart",
    });
    try {
      const result = await serenaProvider.handlers.SessionStart(ctx);
      expect(result).toEqual({});
      expect(cleanupMock).toHaveBeenCalledOnce();
      expect(cleanupMock).toHaveBeenCalledWith({ dryRun: false });
      expect(bootstrapMock).toHaveBeenCalledOnce();
      expect(bootstrapMock).toHaveBeenCalledWith("claude-code");
    } finally {
      dispose();
    }
  });

  it("returns { exitCode } when bootstrapSerena reports a non-zero exit", async () => {
    bootstrapMock.mockReturnValue(2);

    const { ctx, dispose } = mockContext({
      client: "claude-code",
      providerName: "serena",
      event: "SessionStart",
    });
    try {
      const result = await serenaProvider.handlers.SessionStart(ctx);
      expect(result).toEqual({ exitCode: 2 });
      expect(cleanupMock).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it("forwards the canonical client identifier to bootstrapSerena unchanged", async () => {
    bootstrapMock.mockReturnValue(0);

    const { ctx, dispose } = mockContext({
      client: "codex",
      providerName: "serena",
      event: "SessionStart",
    });
    try {
      await serenaProvider.handlers.SessionStart(ctx);
      expect(bootstrapMock).toHaveBeenCalledWith("codex");
    } finally {
      dispose();
    }
  });

  it("skips stale-process cleanup when LATTICE_SERENA_CLEANUP is disabled", async () => {
    bootstrapMock.mockReturnValue(0);

    const { ctx, dispose } = mockContext({
      client: "codex",
      providerName: "serena",
      event: "SessionStart",
      env: { LATTICE_SERENA_CLEANUP: "0" },
    });
    try {
      await serenaProvider.handlers.SessionStart(ctx);
      expect(cleanupMock).not.toHaveBeenCalled();
      expect(bootstrapMock).toHaveBeenCalledWith("codex");
    } finally {
      dispose();
    }
  });

  it("passes dry-run mode to stale-process cleanup", async () => {
    bootstrapMock.mockReturnValue(0);

    const { ctx, dispose } = mockContext({
      client: "claude-code",
      providerName: "serena",
      event: "SessionStart",
      env: { LATTICE_SERENA_CLEANUP_DRY_RUN: "1" },
    });
    try {
      await serenaProvider.handlers.SessionStart(ctx);
      expect(cleanupMock).toHaveBeenCalledWith({ dryRun: true });
    } finally {
      dispose();
    }
  });

  it("continues bootstrapping when stale-process cleanup fails", async () => {
    cleanupMock.mockImplementation(() => {
      throw new Error("process list unavailable");
    });
    bootstrapMock.mockReturnValue(0);

    const { ctx, stderr, dispose } = mockContext({
      client: "claude-code",
      providerName: "serena",
      event: "SessionStart",
    });
    try {
      const result = await serenaProvider.handlers.SessionStart(ctx);
      expect(result).toEqual({});
      expect(bootstrapMock).toHaveBeenCalledWith("claude-code");
      expect(stderr.join("")).toContain("Serena stale-process cleanup skipped");
    } finally {
      dispose();
    }
  });
});
