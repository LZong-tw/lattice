import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stopChecklistProvider } from "../builtins/stop-checklist-provider.mjs";
import { mockPayload, runProvider } from "../testing.mjs";

vi.mock("../verification/verify.mjs", () => ({
  runProjectVerification: vi.fn(),
}));

const verifyModule = await import("../verification/verify.mjs");
const runProjectVerification = verifyModule.runProjectVerification as unknown as ReturnType<
  typeof vi.fn
>;

afterEach(() => {
  vi.clearAllMocks();
});

describe("stopChecklistProvider shape", () => {
  it("declares the v1 contract fields", () => {
    expect(stopChecklistProvider.name).toBe("lattice/stop-checklist");
    expect(stopChecklistProvider.contractVersion).toBe(1);
    expect(typeof stopChecklistProvider.handlers.Stop).toBe("function");
  });
});

describe("stopChecklistProvider Stop — checklist printing", () => {
  it("always logs the end-of-turn checklist to stderr", async () => {
    const { stderr } = await runProvider(stopChecklistProvider, "Stop", mockPayload.stop());
    const combined = stderr.join("");
    expect(combined).toContain("END-OF-TURN CHECKLIST");
  });

  it("returns {} when LATTICE_VERIFY_ON_STOP is unset", async () => {
    const { result } = await runProvider(stopChecklistProvider, "Stop", mockPayload.stop());
    expect(result).toEqual({});
    expect(runProjectVerification).not.toHaveBeenCalled();
  });
});

describe("stopChecklistProvider Stop — verification gate", () => {
  it("returns block decision + additionalContext on verification failure", async () => {
    runProjectVerification.mockReturnValue({
      status: "failed",
      message: "typecheck failed",
      failures: ["foo.ts: TS2304"],
    });

    const { result } = await runProvider(
      stopChecklistProvider,
      "Stop",
      mockPayload.stop(),
      { contextOverrides: { env: { LATTICE_VERIFY_ON_STOP: "1" } } },
    );

    expect(result.hookSpecificOutput).toEqual({ decision: "block" });
    expect(result.additionalContext).toBe("typecheck failed");
  });

  it("returns additionalContext when circuit breaker allows stop", async () => {
    runProjectVerification.mockReturnValue({
      status: "allowed",
      message: "Circuit breaker: allowing stop after 3 failures",
    });

    const { result } = await runProvider(
      stopChecklistProvider,
      "Stop",
      mockPayload.stop(),
      { contextOverrides: { env: { LATTICE_VERIFY_ON_STOP: "1" } } },
    );

    expect(result.hookSpecificOutput).toBeUndefined();
    expect(result.additionalContext).toMatch(/Circuit breaker/);
  });

  it("returns {} when verification passes", async () => {
    runProjectVerification.mockReturnValue({
      status: "passed",
      message: "Verification passed.",
    });

    const { result } = await runProvider(
      stopChecklistProvider,
      "Stop",
      mockPayload.stop(),
      { contextOverrides: { env: { LATTICE_VERIFY_ON_STOP: "1" } } },
    );

    expect(result).toEqual({});
  });

  it("clamps payload.cwd to ctx.repoRoot when payload points outside (H3)", async () => {
    runProjectVerification.mockReturnValue({
      status: "passed",
      message: "Verification passed.",
    });

    const { stderr } = await runProvider(
      stopChecklistProvider,
      "Stop",
      mockPayload.stop({ cwd: "/tmp/attacker-staged" }),
      {
        contextOverrides: {
          env: {
            LATTICE_VERIFY_ON_STOP: "1",
            LATTICE_REPO_ROOT: "/var/repo/lattice",
          },
          repoRoot: "/var/repo/lattice",
        },
      },
    );

    // The verification call should have received a sanitized payload
    // with cwd === path.resolve(repoRoot). On Windows path.resolve
    // prepends the current drive letter, so compare against the
    // resolved form rather than the literal POSIX string.
    expect(runProjectVerification).toHaveBeenCalledTimes(1);
    const callArg = runProjectVerification.mock.calls[0][0];
    expect(callArg.payload.cwd).toBe(path.resolve("/var/repo/lattice"));
    expect(stderr.join("")).toMatch(/ignoring payload\.cwd "\/tmp\/attacker-staged"/);
  });

  it("preserves payload.cwd when it is a descendant of ctx.repoRoot (H3)", async () => {
    runProjectVerification.mockReturnValue({
      status: "passed",
      message: "Verification passed.",
    });

    await runProvider(
      stopChecklistProvider,
      "Stop",
      mockPayload.stop({ cwd: "/var/repo/lattice/sub/dir" }),
      {
        contextOverrides: {
          env: {
            LATTICE_VERIFY_ON_STOP: "1",
            LATTICE_REPO_ROOT: "/var/repo/lattice",
          },
          repoRoot: "/var/repo/lattice",
        },
      },
    );

    const callArg = runProjectVerification.mock.calls[0][0];
    expect(callArg.payload.cwd).toBe("/var/repo/lattice/sub/dir");
  });

  it("does not clamp when LATTICE_REPO_ROOT is unset (defers to verify default)", async () => {
    runProjectVerification.mockReturnValue({
      status: "passed",
      message: "Verification passed.",
    });

    await runProvider(
      stopChecklistProvider,
      "Stop",
      mockPayload.stop({ cwd: "/tmp/elsewhere" }),
      {
        contextOverrides: {
          env: { LATTICE_VERIFY_ON_STOP: "1" },
          repoRoot: "/var/repo/lattice",
        },
      },
    );

    const callArg = runProjectVerification.mock.calls[0][0];
    expect(callArg.payload.cwd).toBe("/tmp/elsewhere");
  });

  it("emits verbose log line when LATTICE_VERIFY_VERBOSE=1 and not failed", async () => {
    runProjectVerification.mockReturnValue({
      status: "passed",
      message: "All checks green",
    });

    const { stderr } = await runProvider(
      stopChecklistProvider,
      "Stop",
      mockPayload.stop(),
      {
        contextOverrides: {
          env: { LATTICE_VERIFY_ON_STOP: "1", LATTICE_VERIFY_VERBOSE: "1" },
        },
      },
    );

    const combined = stderr.join("");
    expect(combined).toContain("verification: All checks green");
  });
});
