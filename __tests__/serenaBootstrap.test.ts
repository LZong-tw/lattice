import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: actual,
    existsSync: vi.fn(() => true),
  };
});

const { spawnSync } = await import("node:child_process");
const fs = await import("node:fs");
const { bootstrapSerena } = await import("../serena/bootstrap.mjs");

const spawnSyncMock = spawnSync as unknown as ReturnType<typeof vi.fn>;
const existsSyncMock = fs.existsSync as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  spawnSyncMock.mockReset();
  existsSyncMock.mockReset();
  existsSyncMock.mockReturnValue(true);
});

afterEach(() => {
  spawnSyncMock.mockReset();
  existsSyncMock.mockReset();
});

describe("bootstrapSerena platform-agnostic launch", () => {
  it("spawns node (process.execPath) with start-http.mjs and the client name — never bash", () => {
    spawnSyncMock.mockReturnValue({ status: 0, error: undefined });

    const exit = bootstrapSerena("claude");

    expect(exit).toBe(0);
    expect(spawnSyncMock).toHaveBeenCalledOnce();

    const [command, args] = spawnSyncMock.mock.calls[0];
    // Must be the running Node binary, not "bash" — Windows has no bash on PATH.
    expect(command).toBe(process.execPath);
    expect(command).not.toBe("bash");
    // First arg is the start-http.mjs path; second is the normalized client.
    expect(args[0]).toMatch(/start-http\.mjs$/);
    expect(args[1]).toBe("claude");
  });

  it("returns 0 when client is unknown (no-op, never spawns)", () => {
    const exit = bootstrapSerena("not-a-real-client");
    expect(exit).toBe(0);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("normalizes claude-code to claude before passing to start-http.mjs", () => {
    spawnSyncMock.mockReturnValue({ status: 0, error: undefined });

    bootstrapSerena("claude-code");

    expect(spawnSyncMock).toHaveBeenCalledOnce();
    const [, args] = spawnSyncMock.mock.calls[0];
    expect(args[1]).toBe("claude");
  });

  it("surfaces ENOENT-style spawn errors instead of swallowing them as success", () => {
    // The old bash-based impl returned `result.status ?? 0` and treated
    // ENOENT (status === null) as success. Regression-guard that we now
    // return non-zero so callers can detect the failure.
    spawnSyncMock.mockReturnValue({
      status: null,
      error: Object.assign(new Error("spawn node ENOENT"), { code: "ENOENT" }),
    });

    const exit = bootstrapSerena("codex");

    expect(exit).not.toBe(0);
  });

  it("propagates non-zero exit codes from the launcher", () => {
    spawnSyncMock.mockReturnValue({ status: 2, error: undefined });

    const exit = bootstrapSerena("codex");

    expect(exit).toBe(2);
  });
});
