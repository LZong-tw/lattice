import fs from "node:fs";
import path from "node:path";

export function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function readJsonFile(filePath) {
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

export function getArgValue(args, flag) {
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

export function hasArg(args, value) {
  return args.includes(value);
}

function basename(value) {
  return path.basename(value);
}

export function isCommandNamed(command, expectedName) {
  return (
    typeof command === "string" &&
    basename(command).replace(/\.exe$/i, "") === expectedName
  );
}

export function isUvxCommand(command) {
  return isCommandNamed(command, "uvx");
}

export function isNodeCommand(command) {
  return isCommandNamed(command, "node");
}

export function isProjectScriptArg(arg, root, relativeScript) {
  if (typeof arg !== "string") {
    return false;
  }

  const normalized = path.normalize(arg);
  const normalizedRelativeScript = path.normalize(relativeScript);
  if (normalized === normalizedRelativeScript) {
    return true;
  }

  return path.resolve(root, arg) === path.join(root, normalizedRelativeScript);
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

export function parseMcpTomlEntry(filePath, tableName) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }

  const table = getTomlTable(raw, tableName);
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
