import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rtkProvider } from "../rtk/provider.mjs";
import { mockContext, mockPayload, runProvider } from "../testing.mjs";

let tempDir: string;
let fakeRtk: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-rtk-test-"));
  fakeRtk = path.join(tempDir, "rtk");
  fs.writeFileSync(
    fakeRtk,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [[ "${1:-}" == "--version" ]]; then',
      '  echo "rtk 0.28.2"',
      "  exit 0",
      "fi",
      'if [[ "${1:-}" == "rewrite" ]]; then',
      '  command="${2:-}"',
      '  if [[ "$command" == "git status" ]]; then',
      '    echo "rtk git status"',
      "    exit 0",
      "  fi",
      '  echo "$command"',
      "  exit 3",
      "fi",
      "exit 2",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("rtkProvider — shape", () => {
  it("declares the v1 provider surface", () => {
    expect(rtkProvider.name).toBe("rtk");
    expect(rtkProvider.contractVersion).toBe(1);
    expect(typeof rtkProvider.validate).toBe("function");
    expect(typeof rtkProvider.handlers?.PreToolUse).toBe("function");
  });

  it("supports Claude Code and Codex, but not Copilot CLI", () => {
    expect(Array.from(rtkProvider.supportedClients ?? [])).toEqual([
      "claude-code",
      "codex",
    ]);
  });
});

describe("rtkProvider.validate", () => {
  it("does not require rtk unless LATTICE_REQUIRE_RTK is set", async () => {
    const { ctx, dispose } = mockContext({
      env: { LATTICE_RTK_BIN: "/missing/rtk" },
    });
    try {
      await expect(rtkProvider.validate!(ctx)).resolves.toEqual({ ok: true });
    } finally {
      dispose();
    }
  });

  it("passes when required rtk is available", async () => {
    const { ctx, dispose } = mockContext({
      env: { LATTICE_REQUIRE_RTK: "1", LATTICE_RTK_BIN: fakeRtk },
    });
    try {
      await expect(rtkProvider.validate!(ctx)).resolves.toEqual({ ok: true });
    } finally {
      dispose();
    }
  });

  it("fails when required rtk is missing", async () => {
    const { ctx, dispose } = mockContext({
      env: { LATTICE_REQUIRE_RTK: "1", LATTICE_RTK_BIN: "/missing/rtk" },
    });
    try {
      const result = await rtkProvider.validate!(ctx);
      expect(result.ok).toBe(false);
      expect("failures" in result ? result.failures[0] : "").toMatch(
        /rtk binary is required/,
      );
    } finally {
      dispose();
    }
  });
});

describe("rtkProvider.PreToolUse", () => {
  it("rewrites Bash commands when rtk returns a different command", async () => {
    const { result } = await runProvider(
      rtkProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Bash",
        tool_input: { command: "git status" },
      }),
      { contextOverrides: { env: { LATTICE_RTK_BIN: fakeRtk } } },
    );

    expect(result).toEqual({
      decision: "allow",
      hookSpecificOutput: {
        updatedInput: { command: "rtk git status" },
      },
    });
  });

  it("does nothing when rtk returns the original command", async () => {
    const { result } = await runProvider(
      rtkProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Bash",
        tool_input: { command: "pwd" },
      }),
      { contextOverrides: { env: { LATTICE_RTK_BIN: fakeRtk } } },
    );

    expect(result).toEqual({});
  });

  it("does nothing when rtk is missing", async () => {
    const { result } = await runProvider(
      rtkProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Bash",
        tool_input: { command: "git status" },
      }),
      { contextOverrides: { env: { LATTICE_RTK_BIN: "/missing/rtk" } } },
    );

    expect(result).toEqual({});
  });

  it("does not rewrite non-Bash tools", async () => {
    const { result } = await runProvider(
      rtkProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Read",
        tool_input: { file_path: "README.md" },
      }),
      { contextOverrides: { env: { LATTICE_RTK_BIN: fakeRtk } } },
    );

    expect(result).toEqual({});
  });

  it("does not rewrite git commit commands", async () => {
    const { result } = await runProvider(
      rtkProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Bash",
        tool_input: { command: "git commit -m test" },
      }),
      { contextOverrides: { env: { LATTICE_RTK_BIN: fakeRtk } } },
    );

    expect(result).toEqual({});
  });

  it("honors RTK_DISABLED command prefixes", async () => {
    const { result } = await runProvider(
      rtkProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Bash",
        tool_input: { command: "RTK_DISABLED=1 git status" },
      }),
      { contextOverrides: { env: { LATTICE_RTK_BIN: fakeRtk } } },
    );

    expect(result).toEqual({});
  });
});
