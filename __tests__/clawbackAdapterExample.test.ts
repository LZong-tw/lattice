import { describe, expect, it } from "vitest";

import { mockPayload, runProvider } from "../testing.mjs";
import { clawbackProvider } from "../examples/clawback-adapter/clawback-provider.mjs";

describe("clawback adapter example — provider shape", () => {
  it("declares name, contractVersion, and all five handlers without a validate fn", () => {
    expect(clawbackProvider.name).toBe("clawback");
    expect(clawbackProvider.contractVersion).toBe(1);
    expect(clawbackProvider.validate).toBeUndefined();

    const handlerNames = Object.keys(clawbackProvider.handlers ?? {}).sort();
    expect(handlerNames).toEqual(
      ["Notification", "PostCompact", "PostToolUse", "PreToolUse", "Stop"].sort(),
    );
  });
});

describe("clawback adapter example — PreToolUse (protect-files)", () => {
  it("denies writes to .env", async () => {
    const { result } = await runProvider(
      clawbackProvider,
      "PreToolUse",
      mockPayload.preToolUse({ tool_name: "Write", tool_input: { file_path: ".env" } }),
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("clawback: protected file:");
    expect(result.reason).toContain(".env");
  });

  it("denies writes to lockfiles", async () => {
    const { result } = await runProvider(
      clawbackProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Edit",
        tool_input: { file_path: "pnpm-lock.yaml" },
      }),
    );
    expect(result.decision).toBe("deny");
  });

  it("denies writes anywhere inside .git/", async () => {
    const { result } = await runProvider(
      clawbackProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Write",
        tool_input: { file_path: ".git/HEAD" },
      }),
    );
    expect(result.decision).toBe("deny");
  });

  it("denies writes inside .git with backslash separators", async () => {
    const { result } = await runProvider(
      clawbackProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Write",
        tool_input: { file_path: "repo\\.git\\HEAD" },
      }),
    );
    expect(result.decision).toBe("deny");
  });

  it("denies writes inside .GIT case variants (case-insensitive FS)", async () => {
    const { result } = await runProvider(
      clawbackProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Write",
        tool_input: { file_path: ".GIT/config" },
      }),
    );
    expect(result.decision).toBe("deny");
  });

  it("allows writes to normal source files", async () => {
    const { result } = await runProvider(
      clawbackProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Write",
        tool_input: { file_path: "src/index.ts" },
      }),
    );
    expect(result).toEqual({});
  });
});

describe("clawback adapter example — PostToolUse (post-edit)", () => {
  it("returns {} and logs what it would have done", async () => {
    const { result, stderr } = await runProvider(
      clawbackProvider,
      "PostToolUse",
      mockPayload.postToolUse({ tool_name: "Edit" }),
    );
    expect(result).toEqual({});
    expect(stderr.join("")).toContain("would format+lint after Edit");
    expect(stderr.join("")).toContain("lattice[clawback]:");
  });
});

describe("clawback adapter example — Stop (stop-verify)", () => {
  it("returns additionalContext mentioning verification", async () => {
    const { result, stderr } = await runProvider(
      clawbackProvider,
      "Stop",
      mockPayload.stop(),
    );
    expect(typeof result.additionalContext).toBe("string");
    expect(result.additionalContext).toMatch(/verification/);
    expect(result.hookSpecificOutput).toBeUndefined();
    expect(stderr.join("")).toContain("would run typecheck+lint");
  });

  it("adds hookSpecificOutput.decision = 'block' when CLAWBACK_FORCE_BLOCK=1", async () => {
    const { result } = await runProvider(clawbackProvider, "Stop", mockPayload.stop(), {
      contextOverrides: { env: { CLAWBACK_FORCE_BLOCK: "1" } },
    });
    expect(result.additionalContext).toMatch(/verification/);
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput?.decision).toBe("block");
    expect(result.hookSpecificOutput?.reason).toContain("clawback");
  });
});

describe("clawback adapter example — PostCompact (post-compact-reinject)", () => {
  it("returns empty JSON because PostCompact cannot inject context", async () => {
    const { result } = await runProvider(
      clawbackProvider,
      "PostCompact",
      mockPayload.postCompact(),
    );
    expect(result).toEqual({});
  });
});

describe("clawback adapter example — Notification", () => {
  it("logs the notification message and returns {}", async () => {
    const { result, stderr } = await runProvider(
      clawbackProvider,
      "Notification",
      mockPayload.notification({ message: "Claude needs your input" }),
    );
    expect(result).toEqual({});
    expect(stderr.join("")).toContain("would send desktop notification: Claude needs your input");
  });
});
