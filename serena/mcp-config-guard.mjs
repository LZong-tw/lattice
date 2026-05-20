import fs from "node:fs";
import path from "node:path";

import { repoRoot } from "../common.mjs";

const EXPECTED_CONTEXT_BY_CLIENT = Object.freeze({
  claude: "claude-code",
  codex: "codex",
});

const EXPECTED_WRAPPER_CLIENT_BY_CONTEXT = Object.freeze({
  "claude-code": "claude",
  codex: "codex",
});

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function readJsonFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return { error: "JSON root must be an object" };
    }

    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

function getArgValue(args, flag) {
  const equalsPrefix = `${flag}=`;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === flag) {
      return args[index + 1] ?? null;
    }

    if (value.startsWith(equalsPrefix)) {
      return value.slice(equalsPrefix.length);
    }
  }

  return null;
}

function hasArg(args, value) {
  return args.includes(value);
}

function basename(value) {
  return path.basename(value);
}

function isUvxCommand(command) {
  return typeof command === "string" && basename(command) === "uvx";
}

function isNodeCommand(command) {
  return typeof command === "string" && basename(command).replace(/\.exe$/i, "") === "node";
}

function isProjectWrapperArg(arg, root) {
  if (typeof arg !== "string") {
    return false;
  }

  const normalized = path.normalize(arg);
  const relativeWrapper = path.join("scripts", "serena-mcp.mjs");
  if (normalized === relativeWrapper) {
    return true;
  }

  return path.resolve(root, arg) === path.join(root, relativeWrapper);
}

function validateDirectUvxEntry(args, expectedContext, root, label) {
  const failures = [];

  if (!hasArg(args, "git+https://github.com/oraios/serena")) {
    failures.push(`${label} args must pin Serena via git+https://github.com/oraios/serena.`);
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

function stripTomlComment(line) {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (char === "#" && !inString) {
      return line.slice(0, index).trimEnd();
    }
  }

  return line;
}

function getTomlTable(text, tableName) {
  const lines = text.split(/\r?\n/);
  const header = `[${tableName}]`;
  const tableLines = [];
  let inTable = false;

  for (const rawLine of lines) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) {
      continue;
    }

    if (/^\[[^\]]+\]$/.test(line)) {
      if (line === header) {
        inTable = true;
        continue;
      }

      if (inTable) {
        break;
      }
    }

    if (inTable) {
      tableLines.push(line);
    }
  }

  return tableLines.length > 0 ? tableLines : null;
}

function parseTomlString(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseTomlStringArray(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function parseSerenaTomlEntry(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }

  const table = getTomlTable(raw, "mcp_servers.serena");
  if (!table) {
    return { entry: null };
  }

  const entry = {};
  for (const line of table) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === "command" || key === "url") {
      entry[key] = parseTomlString(value);
    } else if (key === "args") {
      entry.args = parseTomlStringArray(value);
    }
  }

  return { entry };
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
  const parsed = parseSerenaTomlEntry(filePath);
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
