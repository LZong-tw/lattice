#!/usr/bin/env node
import {
  isBashTool,
  isEditTool,
  isGitCommitCommand,
  isScreenshotTool,
  messages,
  normalizeToolUse,
  printClaudeOrCodexDeny,
  printCopilotDeny,
  printMessage,
  readJsonStdin,
} from "./common.mjs";
import { maybePrintCommitCheckpointReminder } from "./commit-checkpoint.mjs";
import { getProtectedFileEditFailure } from "./protection.mjs";

const client = process.argv[2];
const payload = await readJsonStdin();
const { toolName, command, filePaths } = normalizeToolUse(client, payload);

if (isEditTool(toolName)) {
  const reason = getProtectedFileEditFailure(filePaths);
  if (reason) {
    if (client === "copilot") {
      printCopilotDeny(reason);
    } else {
      printClaudeOrCodexDeny(reason);
    }
    process.exit(0);
  }
}

if (client === "claude" && isScreenshotTool(toolName)) {
  printMessage(messages.screenshotReminder);
}

if (!isBashTool(toolName) || !isGitCommitCommand(command)) {
  maybePrintCommitCheckpointReminder();
  process.exit(0);
}

if (client === "copilot") {
  printCopilotDeny(messages.commitGate);
  process.exit(0);
}

printClaudeOrCodexDeny(messages.commitGate);
