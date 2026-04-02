#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, "..");
export const hooksRoot = __dirname;

export const messages = {
  commitGate: [
    "🚫 PRE-COMMIT GATE",
    "───────────────────────",
    " 1. Lessons written to CLAUDE.md + MEMORY.md?",
    " 2. Full visual check (screenshot + scroll ALL areas)?",
    " 3. You-See-It-You-Own-It defects addressed?",
    "───────────────────────",
    " → Approve ONLY if all 3 are done.",
  ].join("\n"),
  screenshotReminder:
    "👁️  After this screenshot — scroll UP and DOWN to check ALL areas before declaring success.",
  editReminder:
    "💡 Did this fix reveal a reusable lesson worth recording?",
  stopChecklist: [
    "📋 END-OF-TURN CHECKLIST",
    "───────────────────────",
    " 1. New lesson learned? → Write to CLAUDE.md + MEMORY.md",
    " 2. Saw a defect you skipped? → You See It, You Own It",
    " 3. Made UI changes? → Screenshot + scroll ALL areas",
    "───────────────────────",
  ].join("\n"),
};

export async function readJsonStdin() {
  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const raw = chunks.join("").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export function parseJsonMaybe(value) {
  if (!value || typeof value !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function normalizeToolUse(client, payload) {
  if (client === "copilot") {
    const toolArgs =
      typeof payload.toolArgs === "string" ? parseJsonMaybe(payload.toolArgs) ?? {} : payload.toolArgs ?? {};

    return {
      toolName: payload.toolName ?? "",
      command: toolArgs.command ?? "",
    };
  }

  const toolInput = payload.tool_input ?? payload.toolInput ?? {};
  const commandFromEnv = process.env.CLAUDE_TOOL_INPUT ?? "";

  return {
    toolName: payload.tool_name ?? payload.toolName ?? process.env.CLAUDE_TOOL_NAME ?? "",
    command:
      (typeof toolInput === "object" && toolInput !== null ? toolInput.command : "") || commandFromEnv || "",
  };
}

export function isGitCommitCommand(command) {
  return /(^|\s)git\s+commit(\s|$)/.test(command);
}

export function isBashTool(toolName) {
  return /^bash$/i.test(toolName);
}

export function isEditTool(toolName) {
  return /^(edit|multiedit|write)$/i.test(toolName);
}

export function isScreenshotTool(toolName) {
  return /take_screenshot$/i.test(toolName) || /take[_-]screenshot/i.test(toolName);
}

export function printMessage(message) {
  process.stderr.write(`${message}\n`);
}

export function printClaudeOrCodexDeny(reason) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
}

export function printCopilotDeny(reason) {
  process.stdout.write(
    `${JSON.stringify({
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    })}\n`,
  );
}
