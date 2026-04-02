#!/usr/bin/env node
import {
  isBashTool,
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

const client = process.argv[2];
const payload = await readJsonStdin();
const { toolName, command } = normalizeToolUse(client, payload);

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
