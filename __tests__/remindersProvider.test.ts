import { afterEach, describe, expect, it, vi } from "vitest";

import {
  commitCheckpointProvider,
  editReminderProvider,
  screenshotReminderProvider,
} from "../builtins/reminders-provider.mjs";
import { mockPayload, runProvider } from "../testing.mjs";

vi.mock("../commit-checkpoint.mjs", async () => {
  const actual = await vi.importActual<typeof import("../commit-checkpoint.mjs")>(
    "../commit-checkpoint.mjs",
  );
  return {
    ...actual,
    buildCommitCheckpointReminder: vi.fn(() => null),
  };
});

const checkpointModule = await import("../commit-checkpoint.mjs");
const buildCommitCheckpointReminder =
  checkpointModule.buildCommitCheckpointReminder as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
});

describe("commitCheckpointProvider", () => {
  it("has SessionStart + PreToolUse handlers and no supportedClients restriction", () => {
    expect(commitCheckpointProvider.name).toBe("lattice/commit-checkpoint");
    expect(typeof commitCheckpointProvider.handlers.SessionStart).toBe("function");
    expect(typeof commitCheckpointProvider.handlers.PreToolUse).toBe("function");
    expect(
      (commitCheckpointProvider as { supportedClients?: readonly string[] }).supportedClients,
    ).toBeUndefined();
  });

  it("logs the reminder text on SessionStart when the tree is dirty", async () => {
    buildCommitCheckpointReminder.mockReturnValue("💡 COMMIT CHECKPOINT\nfoo");
    const { stderr, result } = await runProvider(
      commitCheckpointProvider,
      "SessionStart",
      mockPayload.sessionStart(),
    );
    expect(result).toEqual({});
    expect(stderr.join("")).toContain("💡 COMMIT CHECKPOINT");
  });

  it("stays silent when no reminder is available", async () => {
    buildCommitCheckpointReminder.mockReturnValue(null);
    const { stderr } = await runProvider(
      commitCheckpointProvider,
      "SessionStart",
      mockPayload.sessionStart(),
    );
    expect(stderr.join("")).toBe("");
  });

  it("suppresses reminder on `git commit` Bash invocations (PreToolUse)", async () => {
    buildCommitCheckpointReminder.mockReturnValue("would have nagged");
    const { stderr } = await runProvider(
      commitCheckpointProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Bash",
        tool_input: { command: "git commit -m 'x'" },
      }),
    );
    expect(stderr.join("")).toBe("");
    expect(buildCommitCheckpointReminder).not.toHaveBeenCalled();
  });

  it("nags on non-commit PreToolUse invocations", async () => {
    buildCommitCheckpointReminder.mockReturnValue("💡 COMMIT CHECKPOINT\nbar");
    const { stderr } = await runProvider(
      commitCheckpointProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "Edit",
        tool_input: { file_path: "src/index.ts" },
      }),
    );
    expect(stderr.join("")).toContain("💡 COMMIT CHECKPOINT");
  });
});

describe("screenshotReminderProvider", () => {
  it("declares supportedClients: claude-code only", () => {
    expect(screenshotReminderProvider.supportedClients).toEqual(["claude-code"]);
  });

  it("logs the reminder on screenshot tool use", async () => {
    const { stderr } = await runProvider(
      screenshotReminderProvider,
      "PreToolUse",
      mockPayload.preToolUse({
        tool_name: "mcp__chrome_devtools__take_screenshot",
      }),
    );
    expect(stderr.join("")).toMatch(/scroll/i);
  });

  it("stays silent on non-screenshot tools", async () => {
    const { stderr } = await runProvider(
      screenshotReminderProvider,
      "PreToolUse",
      mockPayload.preToolUse({ tool_name: "Bash" }),
    );
    expect(stderr.join("")).toBe("");
  });
});

describe("editReminderProvider", () => {
  it("has no supportedClients restriction", () => {
    expect(
      (editReminderProvider as { supportedClients?: readonly string[] }).supportedClients,
    ).toBeUndefined();
  });

  it("logs the reminder after edit tools", async () => {
    const { stderr } = await runProvider(
      editReminderProvider,
      "PostToolUse",
      mockPayload.postToolUse({ tool_name: "Edit" }),
    );
    expect(stderr.join("")).toMatch(/lesson/i);
  });

  it("stays silent on non-edit tools", async () => {
    const { stderr } = await runProvider(
      editReminderProvider,
      "PostToolUse",
      mockPayload.postToolUse({ tool_name: "Bash" }),
    );
    expect(stderr.join("")).toBe("");
  });
});
