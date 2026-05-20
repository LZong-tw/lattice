import fs from "node:fs";
import path from "node:path";

import { repoRoot } from "../common.mjs";
import {
  hasArg,
  hasOwn,
  isNodeCommand,
  isProjectScriptArg,
  isUvxCommand,
  parseMcpTomlEntry,
  readJsonFile,
} from "../mcp-config-common.mjs";

const SUPPORTED_CLIENTS = new Set(["claude", "codex"]);

function validateDirectUvxEntry(args, label) {
  const failures = [];

  if (!hasArg(args, "--from") || !hasArg(args, "semble[mcp]")) {
    failures.push(`${label} args must include uvx --from "semble[mcp]".`);
  }

  if (!hasArg(args, "semble")) {
    failures.push(`${label} args must run "semble".`);
  }

  return failures;
}

function validateProjectWrapperEntry(args, root, label) {
  const failures = [];
  const relativeWrapper = path.join("scripts", "semble-mcp.mjs");
  const wrapperPath = path.join(root, relativeWrapper);

  if (!args.some((arg) => isProjectScriptArg(arg, root, relativeWrapper))) {
    failures.push(`${label} must run scripts/semble-mcp.mjs.`);
  }

  if (!fs.existsSync(wrapperPath)) {
    failures.push(`${label} points at missing wrapper ${wrapperPath}.`);
  }

  return failures;
}

function validateSembleStdioEntry(entry, root, label) {
  const failures = [];

  if (!entry || typeof entry !== "object") {
    return [`${label} must define mcp_servers/mcpServers.semble.`];
  }

  if (hasOwn(entry, "url")) {
    failures.push(`${label} must use stdio command/args, not url.`);
  }

  const args = Array.isArray(entry.args) ? entry.args : [];
  if (args.length === 0 || !args.every((arg) => typeof arg === "string")) {
    failures.push(`${label} must define args as a string array.`);
    return failures;
  }

  if (isUvxCommand(entry.command)) {
    failures.push(...validateDirectUvxEntry(args, label));
  } else if (isNodeCommand(entry.command)) {
    failures.push(...validateProjectWrapperEntry(args, root, label));
  } else {
    failures.push(`${label} must launch Semble with uvx directly or node scripts/semble-mcp.mjs.`);
  }

  return failures;
}

function validateClaude(root) {
  const filePath = path.join(root, ".mcp.json");
  const parsed = readJsonFile(filePath);
  if (parsed.error) {
    return [`Failed to read ${filePath}: ${parsed.error}`];
  }

  return validateSembleStdioEntry(
    parsed.mcpServers?.semble,
    root,
    ".mcp.json mcpServers.semble",
  );
}

function validateCodex(root) {
  const filePath = path.join(root, ".codex", "config.toml");
  const parsed = parseMcpTomlEntry(filePath, "mcp_servers.semble");
  if (parsed.error) {
    return [`Failed to read ${filePath}: ${parsed.error}`];
  }

  return validateSembleStdioEntry(
    parsed.entry,
    root,
    ".codex/config.toml [mcp_servers.semble]",
  );
}

export function validateRequiredSembleMcpConfig(client, { root = repoRoot } = {}) {
  if (!SUPPORTED_CLIENTS.has(client)) {
    return {
      ok: true,
      failures: [],
    };
  }

  const failures = client === "claude" ? validateClaude(root) : validateCodex(root);
  return {
    ok: failures.length === 0,
    failures,
  };
}
