#!/usr/bin/env node
import { isEditTool, messages, normalizeToolUse, printMessage, readJsonStdin } from "./common.mjs";

const client = process.argv[2];
const payload = await readJsonStdin();
const { toolName } = normalizeToolUse(client, payload);

if (isEditTool(toolName)) {
  printMessage(messages.editReminder);
}
