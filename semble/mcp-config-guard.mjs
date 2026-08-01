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

function isLoopbackHost(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

/**
 * Preferred setup: machine-wide HTTP singleton (see semble/user-singleton/).
 */
function validateSembleHttpEntry(entry, label) {
  const failures = [];

  if (entry.type && entry.type !== "http") {
    failures.push(`${label} HTTP entry type must be "http" when type is set.`);
  }

  if (typeof entry.url !== "string" || entry.url.trim() === "") {
    failures.push(`${label} must define url for the Semble HTTP singleton.`);
    return failures;
  }

  let parsed;
  try {
    parsed = new URL(entry.url);
  } catch {
    failures.push(`${label} url must be a valid URL.`);
    return failures;
  }

  if (!["http:", "https:"].includes(parsed.protocol) || !isLoopbackHost(parsed.hostname)) {
    failures.push(`${label} must point at a loopback HTTP endpoint.`);
  }

  if (!parsed.pathname.endsWith("/mcp")) {
    failures.push(`${label} url must point at a /mcp endpoint.`);
  }

  return failures;
}

function validateSembleStdioEntry(entry, root, label) {
  const failures = [];

  if (!entry || typeof entry !== "object") {
    return [`${label} must define mcp_servers/mcpServers.semble.`];
  }

  // Preferred: user-level HTTP singleton (docs/USER-MCP-SINGLETONS.md).
  if (hasOwn(entry, "url")) {
    return validateSembleHttpEntry(entry, label);
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
    failures.push(
      `${label} must use a loopback HTTP url, uvx --from semble[mcp], or node scripts/semble-mcp.mjs.`,
    );
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
