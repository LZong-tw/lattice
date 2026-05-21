import fs from "node:fs";
import path from "node:path";

import { repoRoot } from "../common.mjs";
import {
  getArgValue,
  hasArg,
  hasOwn,
  isNodeCommand,
  isProjectScriptArg,
  isUvxCommand,
  parseMcpTomlEntry,
  readJsonFile,
} from "../mcp-config-common.mjs";

const EXPECTED_CONTEXT_BY_CLIENT = Object.freeze({
  claude: "claude-code",
  codex: "codex",
});

const EXPECTED_WRAPPER_CLIENT_BY_CONTEXT = Object.freeze({
  "claude-code": "claude",
  codex: "codex",
});

function isProjectWrapperArg(arg, root) {
  return isProjectScriptArg(arg, root, path.join("scripts", "serena-mcp.mjs"));
}

const SERENA_UPSTREAM_PREFIX = "git+https://github.com/oraios/serena";

/**
 * Accept the bare upstream URL, an `@<tag-or-branch>` pin, or a
 * `#<sha-or-ref>` pin. The pin portion is opaque — users own what
 * ref they want to pull.
 */
function isSerenaUpstreamArg(arg) {
  if (typeof arg !== "string") return false;
  if (arg === SERENA_UPSTREAM_PREFIX) return true;
  if (arg.startsWith(`${SERENA_UPSTREAM_PREFIX}@`) && arg.length > SERENA_UPSTREAM_PREFIX.length + 1) {
    return true;
  }
  if (arg.startsWith(`${SERENA_UPSTREAM_PREFIX}#`) && arg.length > SERENA_UPSTREAM_PREFIX.length + 1) {
    return true;
  }
  return false;
}

function validateDirectUvxEntry(args, expectedContext, root, label) {
  const failures = [];

  if (!args.some(isSerenaUpstreamArg)) {
    failures.push(
      `${label} args must pin Serena via ${SERENA_UPSTREAM_PREFIX} (optionally with @<tag> or #<sha>).`,
    );
  }

  if (!hasArg(args, "serena") || !hasArg(args, "start-mcp-server")) {
    failures.push(`${label} args must run "serena start-mcp-server".`);
  }

  const context = getArgValue(args, "--context");
  if (context !== expectedContext) {
    failures.push(`${label} must set --context ${expectedContext}.`);
  }

  const project = getArgValue(args, "--project");
  if (project !== root && !hasArg(args, "--project-from-cwd")) {
    failures.push(`${label} must set --project ${root} or --project-from-cwd.`);
  }

  return failures;
}

function validateProjectWrapperEntry(args, expectedContext, root, label) {
  const failures = [];
  const wrapperPath = path.join(root, "scripts", "serena-mcp.mjs");
  const expectedClient = EXPECTED_WRAPPER_CLIENT_BY_CONTEXT[expectedContext];

  if (!args.some((arg) => isProjectWrapperArg(arg, root))) {
    failures.push(`${label} must run scripts/serena-mcp.mjs.`);
  }

  if (!hasArg(args, expectedClient)) {
    failures.push(`${label} must pass ${expectedClient} to scripts/serena-mcp.mjs.`);
  }

  if (!fs.existsSync(wrapperPath)) {
    failures.push(`${label} points at missing wrapper ${wrapperPath}.`);
  }

  return failures;
}

function validateSerenaStdioEntry(entry, expectedContext, root, label) {
  const failures = [];

  if (!entry || typeof entry !== "object") {
    return [`${label} must define mcp_servers/mcpServers.serena.`];
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
    failures.push(...validateDirectUvxEntry(args, expectedContext, root, label));
  } else if (isNodeCommand(entry.command)) {
    failures.push(...validateProjectWrapperEntry(args, expectedContext, root, label));
  } else {
    failures.push(`${label} must launch Serena with uvx directly or node scripts/serena-mcp.mjs.`);
  }


  return failures;
}

function validateClaude(root) {
  const filePath = path.join(root, ".mcp.json");
  const parsed = readJsonFile(filePath);
  if (parsed.error) {
    return [`Failed to read ${filePath}: ${parsed.error}`];
  }

  return validateSerenaStdioEntry(
    parsed.mcpServers?.serena,
    EXPECTED_CONTEXT_BY_CLIENT.claude,
    root,
    ".mcp.json mcpServers.serena",
  );
}

function validateCodex(root) {
  const filePath = path.join(root, ".codex", "config.toml");
  const parsed = parseMcpTomlEntry(filePath, "mcp_servers.serena");
  if (parsed.error) {
    return [`Failed to read ${filePath}: ${parsed.error}`];
  }

  return validateSerenaStdioEntry(
    parsed.entry,
    EXPECTED_CONTEXT_BY_CLIENT.codex,
    root,
    ".codex/config.toml [mcp_servers.serena]",
  );
}

export function validateRequiredSerenaMcpConfig(client, { root = repoRoot } = {}) {
  const expectedContext = EXPECTED_CONTEXT_BY_CLIENT[client];
  if (!expectedContext) {
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
