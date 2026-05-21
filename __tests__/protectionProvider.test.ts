import { describe, expect, it } from "vitest";

import { protectionProvider } from "../builtins/protection-provider.mjs";
import { mockContext, mockPayload, runProvider } from "../testing.mjs";

describe("protectionProvider shape", () => {
  it("declares the v1 contract fields", () => {
    expect(protectionProvider.name).toBe("lattice/protection");
    expect(protectionProvider.contractVersion).toBe(1);
    expect(typeof protectionProvider.handlers.PreToolUse).toBe("function");
  });

  it("freezes handlers", () => {
    expect(Object.isFrozen(protectionProvider.handlers)).toBe(true);
  });
});

describe("protectionProvider PreToolUse — file protection", () => {
  it("denies edits to .env", async () => {
    const { result } = await runProvider(
      protectionProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Edit",
        tool_input: { file_path: ".env" },
      }),
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toMatch(/Environment files/);
  });

  it("denies edits to lockfiles for the detected stack", async () => {
    const { result } = await runProvider(
      protectionProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Write",
        tool_input: { file_path: "pnpm-lock.yaml" },
      }),
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toMatch(/lockfile/i);
  });

  it("denies edits inside .git/", async () => {
    const { result } = await runProvider(
      protectionProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Edit",
        tool_input: { file_path: ".git/config" },
      }),
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toMatch(/\.git/);
  });

  it("denies edits inside .git/ with forward-slash paths on Windows-style payloads", async () => {
    // Simulates Claude/Codex emitting a "/"-separated payload on win32; the
    // old `split(path.sep)` only matched backslashes and let this through.
    const { result } = await runProvider(
      protectionProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Edit",
        tool_input: { file_path: "C:/repo/.git/config" },
      }),
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toMatch(/\.git/);
  });

  it("denies edits inside .git/ with backslash separators", async () => {
    const { result } = await runProvider(
      protectionProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Edit",
        tool_input: { file_path: "repo\\.git\\config" },
      }),
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toMatch(/\.git/);
  });

  it("denies edits inside .GIT/ case variations (Windows/macOS case-insensitive FS)", async () => {
    const { result } = await runProvider(
      protectionProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Edit",
        tool_input: { file_path: ".GIT/HEAD" },
      }),
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toMatch(/\.git/);
  });

  it("allows edits to ordinary source files", async () => {
    const { result } = await runProvider(
      protectionProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Edit",
        tool_input: { file_path: "src/index.ts" },
      }),
    );
    expect(result).toEqual({});
  });
});

describe("protectionProvider PreToolUse — commit gate", () => {
  it("denies `git commit` Bash invocations with the commit checklist", async () => {
    const { result } = await runProvider(
      protectionProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Bash",
        tool_input: { command: "git commit -m 'foo'" },
      }),
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toMatch(/PRE-COMMIT GATE/);
  });

  it("allows non-commit Bash invocations", async () => {
    const { result } = await runProvider(
      protectionProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Bash",
        tool_input: { command: "git status" },
      }),
    );
    expect(result).toEqual({});
  });
});

describe("protectionProvider PreToolUse — Copilot client", () => {
  it("normalizes copilot-cli payload shape (toolArgs JSON string)", async () => {
    const { ctx, dispose } = mockContext({
      client: "copilot-cli",
      event: "PreToolUse",
      providerName: "lattice/protection",
    });
    try {
      const payload = {
        hook_event_name: "PreToolUse",
        toolName: "Bash",
        toolArgs: JSON.stringify({ command: "git commit -m 'x'" }),
      };
      const result = await protectionProvider.handlers.PreToolUse(ctx, payload);
      expect(result.decision).toBe("deny");
      expect(result.reason).toMatch(/PRE-COMMIT GATE/);
    } finally {
      dispose();
    }
  });
});
