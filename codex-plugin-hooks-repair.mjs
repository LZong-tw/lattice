import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_GIT_BASH_CANDIDATES = Object.freeze([
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe",
]);

function toHookPath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function quote(filePath) {
  return `"${toHookPath(filePath)}"`;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function commandTokenPattern(command) {
  return command.match(/^(\s*)(\S+)\s+((?:"[^"]+"|'[^']+'|\S+))(.*)$/);
}

function isBareBashCommand(command) {
  return /^\s*bash(?:\.exe)?\s+/i.test(command);
}

function looksLikeCodexCompanionHook(scriptPath) {
  return /\/scripts\/(?:session-lifecycle-hook|stop-review-gate-hook)\.mjs$/i.test(
    toHookPath(scriptPath),
  );
}

function looksLikeShellHook(scriptPath) {
  return /\.sh$/i.test(toHookPath(scriptPath));
}

export function defaultCodexHome(env = process.env) {
  const home = env.CODEX_HOME || env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, ".codex");
}

export function findGitBash(candidates = DEFAULT_GIT_BASH_CANDIDATES) {
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

export function discoverCodexPluginHookFiles(options = {}) {
  const codexHome = options.codexHome || defaultCodexHome(options.env);
  const cacheRoot = options.cacheRoot || path.join(codexHome, "plugins", "cache");
  if (!cacheRoot || !existsSync(cacheRoot)) return [];

  const found = [];
  const stack = [cacheRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name === "hooks.json" && path.basename(current) === "hooks") {
        found.push(entryPath);
      }
    }
  }

  return found.sort();
}

export function normalizeCodexPluginHookCommand(command, pluginRoot, options = {}) {
  let next = command;
  const fixes = [];
  const warnings = [];
  const platform = options.platform || process.platform;
  const root = toHookPath(pluginRoot);

  if (next.includes("${CLAUDE_PLUGIN_ROOT}")) {
    next = next.split("${CLAUDE_PLUGIN_ROOT}").join(root);
    fixes.push("expanded CLAUDE_PLUGIN_ROOT");
  }

  if (platform === "win32") {
    const gitBashPath =
      typeof options.gitBashPath === "string" ? options.gitBashPath : findGitBash(options.gitBashCandidates);

    if (isBareBashCommand(next)) {
      if (gitBashPath) {
        const match = commandTokenPattern(next);
        if (match && looksLikeShellHook(unquote(match[3]))) {
          const [, leading, , scriptToken, rest] = match;
          next = `${leading}${quote(gitBashPath)} ${quote(unquote(scriptToken))}${rest || ""}`;
          fixes.push("replaced bare bash with Git Bash");
        }
      } else {
        warnings.push("bare bash hook found but Git Bash was not found");
      }
    }

    if (!/^\s*node\s+--no-warnings\b/i.test(next)) {
      const match = commandTokenPattern(next);
      if (match && /^node(?:\.exe)?$/i.test(match[2])) {
        const [, leading, , scriptToken, rest] = match;
        const scriptPath = unquote(scriptToken);
        if (looksLikeCodexCompanionHook(scriptPath)) {
          next = `${leading}node --no-warnings ${quote(scriptPath)}${rest || ""}`;
          fixes.push("added node --no-warnings for Codex companion hook");
        }
      }
    }
  }

  return { command: next, changed: next !== command, fixes, warnings };
}

function pluginRootFromHooksFile(hooksFile) {
  return path.dirname(path.dirname(hooksFile));
}

function walkCommands(value, pluginRoot, options, pointer = "$") {
  const fixes = [];
  const warnings = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const result = walkCommands(item, pluginRoot, options, `${pointer}[${index}]`);
      fixes.push(...result.fixes);
      warnings.push(...result.warnings);
    });
    return { fixes, warnings };
  }

  if (!value || typeof value !== "object") {
    return { fixes, warnings };
  }

  for (const [key, current] of Object.entries(value)) {
    const childPointer = `${pointer}.${key}`;
    if (key === "command" && typeof current === "string") {
      const result = normalizeCodexPluginHookCommand(current, pluginRoot, options);
      warnings.push(...result.warnings.map((warning) => ({ path: childPointer, warning })));
      if (result.changed) {
        value[key] = result.command;
        fixes.push({
          path: childPointer,
          before: current,
          after: result.command,
          reason: result.fixes.join("; "),
        });
      }
      continue;
    }

    const result = walkCommands(current, pluginRoot, options, childPointer);
    fixes.push(...result.fixes);
    warnings.push(...result.warnings);
  }

  return { fixes, warnings };
}

export function repairCodexPluginHookFile(hooksFile, options = {}) {
  const pluginRoot = options.pluginRoot || pluginRootFromHooksFile(hooksFile);
  const before = readFileSync(hooksFile, "utf8");
  const parsed = JSON.parse(before);
  const result = walkCommands(parsed, pluginRoot, options);
  const changed = result.fixes.length > 0;

  if (changed && options.write) {
    writeFileSync(hooksFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  }

  return {
    filePath: hooksFile,
    pluginRoot,
    changed,
    written: Boolean(changed && options.write),
    fixes: result.fixes,
    warnings: result.warnings,
  };
}

export function repairCodexPluginHooks(options = {}) {
  const files = options.files || discoverCodexPluginHookFiles(options);
  const results = files.map((filePath) => repairCodexPluginHookFile(filePath, options));
  return {
    codexHome: options.codexHome || defaultCodexHome(options.env),
    checked: results.length,
    changed: results.filter((result) => result.changed).length,
    written: results.filter((result) => result.written).length,
    files: results,
    warnings: results.flatMap((result) => result.warnings),
  };
}

export function formatCodexPluginHookRepairReport(result, options = {}) {
  const write = Boolean(options.write);
  const action = write ? "Repaired" : "Would repair";
  const lines = [
    `Codex plugin hook manifests checked: ${result.checked}`,
    `${action}: ${result.changed}`,
  ];

  for (const file of result.files.filter((item) => item.changed || item.warnings.length > 0)) {
    lines.push(`- ${file.filePath}`);
    for (const fix of file.fixes) {
      lines.push(`  - ${fix.path}: ${fix.reason}`);
    }
    for (const warning of file.warnings) {
      lines.push(`  - ${warning.path}: ${warning.warning}`);
    }
  }

  if (result.changed === 0 && result.warnings.length === 0) {
    lines.push("No repairs needed.");
  }
  if (!write && result.changed > 0) {
    lines.push("Run with --write to apply these repairs.");
  }

  return `${lines.join("\n")}\n`;
}

export function assertHooksFileExists(hooksFile) {
  if (!existsSync(hooksFile) || !statSync(hooksFile).isFile()) {
    throw new Error(`Codex plugin hooks manifest not found: ${hooksFile}`);
  }
}
