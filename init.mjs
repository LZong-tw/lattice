#!/usr/bin/env node
/**
 * init.mjs — OpenCode-style install planner for consumer repos.
 *
 * The command is intentionally read-only. It inspects a consumer repo and prints
 * a concrete plan that an LLM agent or human can follow, then verify.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CLIENTS = Object.freeze(["claude", "codex"]);
const DEFAULT_PROVIDERS = Object.freeze([]);
const SERENA_UPSTREAM_SPEC = "git+https://github.com/oraios/serena";
const MOUNT_FILES = Object.freeze([
  "hooks/common.mjs",
  "hooks/session-start.mjs",
  "hooks/hook-runner.mjs",
  "hooks/codex-hook-runner.mjs",
  "hooks/pre-tool-policy.mjs",
]);
const packageRoot = dirname(fileURLToPath(import.meta.url));
const AGENTS_BEGIN = "<!-- lattice:init:v1:begin -->";
const AGENTS_END = "<!-- lattice:init:v1:end -->";
const SUPPORTED_CLIENTS = Object.freeze(["claude", "codex", "copilot"]);
const CLIENT_ALIASES = Object.freeze({
  claude: "claude",
  "claude-code": "claude",
  codex: "codex",
  copilot: "copilot",
  "copilot-cli": "copilot",
});
const SUPPORTED_CLIENT_HINT = "claude-code, codex, copilot-cli";

function fileExists(root, relativePath) {
  return existsSync(resolve(root, relativePath));
}

function readTextIfExists(root, relativePath) {
  const filePath = resolve(root, relativePath);
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8");
}

function splitCsv(value) {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeChoiceList(value, fallback) {
  const parsed = splitCsv(value);
  return parsed.length > 0 ? parsed : [...fallback];
}

function normalizeClientChoice(value) {
  return CLIENT_ALIASES[value] ?? value;
}

function normalizeClientList(value, fallback) {
  const parsed = splitCsv(value).map(normalizeClientChoice);
  return parsed.length > 0 ? [...new Set(parsed)] : [...fallback];
}

function commandExists(command, { platform = process.platform, runner = spawnSync } = {}) {
  const probe =
    platform === "win32"
      ? { command: "where.exe", args: [command] }
      : { command: "which", args: [command] };
  const result = runner(probe.command, probe.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
  });
  return !result.error && result.status === 0;
}

function commandSucceeds(command, args, { runner = spawnSync } = {}) {
  const result = runner(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
  });
  return !result.error && result.status === 0;
}

export function detectInstalledClients(options = {}) {
  const detected = [];
  const probes = [];

  const claude = commandExists("claude", options);
  probes.push({ client: "claude", command: "claude", installed: claude });
  if (claude) detected.push("claude");

  const codex = commandExists("codex", options);
  probes.push({ client: "codex", command: "codex", installed: codex });
  if (codex) detected.push("codex");

  const gh = commandExists("gh", options);
  const ghCopilot = gh && commandSucceeds("gh", ["copilot", "--help"], options);
  probes.push({
    client: "copilot",
    command: "gh copilot --help",
    installed: ghCopilot,
    note: gh ? undefined : "gh not found",
  });
  if (ghCopilot) detected.push("copilot");

  return { clients: detected, probes };
}

export function parseInitArgs(argv = process.argv.slice(2)) {
  const args = [...argv];
  if (args[0] === "init") args.shift();

  const options = {
    consumerRoot: process.cwd(),
    clients: [...DEFAULT_CLIENTS],
    clientsAuto: false,
    providers: [...DEFAULT_PROVIDERS],
    mount: "submodule",
    format: "markdown",
    latticeRepoUrl: "<lattice-repo-url>",
    write: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = () => {
      i += 1;
      if (i >= args.length) throw new Error(`missing value for ${arg}`);
      return args[i];
    };

    if (arg === "--consumer" || arg === "--repo") {
      options.consumerRoot = resolve(next());
    } else if (arg === "--clients") {
      const value = next();
      if (value.trim().toLowerCase() === "auto") {
        options.clients = [];
        options.clientsAuto = true;
      } else {
        options.clients = normalizeClientList(value, DEFAULT_CLIENTS);
        options.clientsAuto = false;
      }
    } else if (arg === "--providers") {
      options.providers = normalizeChoiceList(next(), DEFAULT_PROVIDERS);
    } else if (arg === "--mount") {
      options.mount = next();
    } else if (arg === "--lattice-repo-url") {
      options.latticeRepoUrl = next();
    } else if (arg === "--json") {
      options.format = "json";
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--format") {
      options.format = next();
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  if (!["submodule", "copy"].includes(options.mount)) {
    throw new Error("--mount must be one of: submodule, copy");
  }
  if (!["markdown", "json"].includes(options.format)) {
    throw new Error("--format must be one of: markdown, json");
  }
  for (const client of options.clients) {
    if (!SUPPORTED_CLIENTS.includes(client)) {
      throw new Error(`unknown client "${client}"; use one of: ${SUPPORTED_CLIENT_HINT} or auto`);
    }
  }

  return options;
}

export function detectConsumerState(consumerRoot) {
  const root = resolve(consumerRoot);
  const codexConfig = readTextIfExists(root, ".codex/config.toml");

  return {
    root,
    isGitRepo: fileExists(root, ".git"),
    hooksMounted: MOUNT_FILES.every((file) => fileExists(root, file)),
    mountFiles: Object.fromEntries(MOUNT_FILES.map((file) => [file, fileExists(root, file)])),
    claude: {
      settingsExists: fileExists(root, ".claude/settings.json"),
      mcpExists: fileExists(root, ".mcp.json"),
    },
    codex: {
      configExists: fileExists(root, ".codex/config.toml"),
      hooksExists: fileExists(root, ".codex/hooks.json"),
      usesHooksFlag: /\[features\][\s\S]*?\bhooks\s*=\s*true\b/.test(codexConfig),
      usesDeprecatedHooksFlag: /\[features\][\s\S]*?\bcodex_hooks\s*=/.test(codexConfig),
      hasSerenaMcp: /\[mcp_servers\.serena\]/.test(codexConfig),
      hasSembleMcp: /\[mcp_servers\.semble\]/.test(codexConfig),
    },
    copilot: {
      guardrailsExists: fileExists(root, ".github/hooks/repo-guardrails.json"),
    },
  };
}

function mountPhase(state, options) {
  const phase = {
    title: "Mount lattice at hooks/",
    status: state.hooksMounted ? "ok" : "missing",
    actions: [],
    commands: [],
  };

  if (state.hooksMounted) {
    phase.actions.push("Keep the existing hooks/ mount and continue to client wiring checks.");
  } else if (options.mount === "copy") {
    phase.actions.push("Install @lzong.tw/lattice and copy it into the stable consumer path hooks/.");
    phase.commands.push("pnpm add @lzong.tw/lattice");
    phase.commands.push(
      "node -e \"const fs=require('node:fs');fs.rmSync('hooks',{recursive:true,force:true});fs.cpSync('node_modules/@lzong.tw/lattice','hooks',{recursive:true})\"",
    );
  } else {
    phase.actions.push("Add lattice as a git submodule at the stable consumer path hooks/.");
    phase.commands.push(`git submodule add ${options.latticeRepoUrl} hooks`);
    phase.commands.push("git submodule update --init --recursive");
  }

  phase.commands.push("node --check hooks/common.mjs");
  phase.commands.push("node --check hooks/session-start.mjs");
  phase.commands.push("node --check hooks/codex-hook-runner.mjs");
  phase.commands.push("node --check hooks/pre-tool-policy.mjs");
  return phase;
}

function fileExistsCommand(relativePath) {
  // `test -f` is POSIX-only. `node -e "require('node:fs').accessSync('X')"`
  // works in cmd.exe and PowerShell because the outer double quotes survive
  // and the inner string uses single quotes (PowerShell treats them literally).
  return `node -e "require('node:fs').accessSync('${relativePath}')"`;
}

function clientPhase(state, options) {
  const phase = {
    title: "Wire selected AI clients",
    status: "needs-review",
    actions: [],
    commands: [],
  };

  if (options.clients.includes("claude")) {
    phase.actions.push(
      state.claude.settingsExists
        ? "Review .claude/settings.json against README.md and keep the hooks/session-start.mjs, pre-tool-policy.mjs, post-tool-reminder.mjs, and stop-checklist.mjs commands aligned."
        : "Create or update .claude/settings.json with the Claude Code hook config from README.md.",
    );
    phase.commands.push(fileExistsCommand(".claude/settings.json"));
  }

  if (options.clients.includes("codex")) {
    phase.actions.push(
      state.codex.configExists && state.codex.hooksExists
        ? "Review .codex/config.toml and .codex/hooks.json against README.md, using [features].hooks and hooks/codex-hook-runner.mjs."
        : "Create or update .codex/config.toml and .codex/hooks.json with the Codex CLI config from README.md.",
    );
    phase.commands.push(fileExistsCommand(".codex/config.toml"));
    phase.commands.push(fileExistsCommand(".codex/hooks.json"));
  }

  if (options.clients.includes("copilot")) {
    phase.actions.push(
      state.copilot.guardrailsExists
        ? "Review .github/hooks/repo-guardrails.json against README.md."
        : "Create or update .github/hooks/repo-guardrails.json with the GitHub Copilot CLI config from README.md.",
    );
    phase.commands.push(fileExistsCommand(".github/hooks/repo-guardrails.json"));
  }

  if (phase.actions.length === 0) {
    phase.actions.push("No clients selected; rerun with --clients claude,codex,copilot.");
  }

  return phase;
}

function providerPhase(options) {
  const phase = {
    title: "Add optional providers only after base hooks pass",
    status: options.providers.length > 0 ? "needs-review" : "skipped",
    actions: [],
    commands: [],
  };

  if (options.providers.includes("serena")) {
    phase.actions.push("Add Serena MCP config for each selected client before setting LATTICE_REQUIRE_SERENA_MCP=1.");
    phase.commands.push("uvx --version");
    phase.commands.push("curl -sf http://127.0.0.1:<serena-port>/mcp");
  }
  if (options.providers.includes("semble")) {
    phase.actions.push("Add stdio Semble MCP config before setting LATTICE_REQUIRE_SEMBLE_MCP=1.");
    phase.commands.push("uvx --version");
    phase.commands.push("rg '\"semble\"|\\bsemble\\b' .mcp.json .codex/config.toml");
  }
  if (options.providers.includes("rtk")) {
    phase.actions.push(
      "Install rtk plus ripgrep, confirm native RTK hook status for installed AI clients, and set LATTICE_REQUIRE_RTK=1 only after smoke testing.",
    );
    phase.commands.push("rtk --version");
    phase.commands.push("rg --version");
    phase.commands.push("rtk gain");
    phase.commands.push("rtk init -g --show");
  }
  if (phase.actions.length === 0) {
    phase.actions.push("No optional providers selected.");
  }

  return phase;
}

function smokePhase(options) {
  const phase = {
    title: "Smoke test before commit",
    status: "required",
    actions: [
      "Run these checks from the consumer repo and fix any failure before committing.",
      "The smoke-plan helper runs in pure Node so it works the same on macOS, Linux, cmd.exe, and PowerShell.",
    ],
    commands: [],
  };

  const hasClaude = options.clients.includes("claude");
  const postCompactClient = hasClaude ? "claude-code" : "codex";

  for (const client of options.clients) {
    phase.commands.push(`node hooks/verification/smoke-plan.mjs session-start ${client}`);
  }
  phase.commands.push(`node hooks/verification/smoke-plan.mjs post-compact ${postCompactClient}`);
  for (const client of options.clients) {
    phase.commands.push(`node hooks/verification/smoke-plan.mjs pre-tool-deny ${client}`);
  }

  return phase;
}

export function buildInstallPlan(state, options) {
  const warnings = [];
  if (!state.isGitRepo) {
    warnings.push("Consumer root is not a git repo; run this from the repository root or pass --consumer.");
  }
  if (options.clientsAuto && options.clients.length === 0) {
    warnings.push(
      "No supported AI client CLI was detected; install Claude Code, Codex CLI, or GitHub Copilot CLI, or rerun with --clients <list>.",
    );
  }
  if (state.codex.usesDeprecatedHooksFlag) {
    warnings.push("Codex config uses deprecated [features].codex_hooks; replace it with [features].hooks.");
  }

  return {
    generatedBy: "lattice init",
    consumerRoot: state.root,
    clientsAuto: options.clientsAuto === true,
    clientDetection: options.clientDetection,
    selectedClients: options.clients,
    selectedProviders: options.providers,
    mount: options.mount,
    warnings,
    phases: [
      mountPhase(state, options),
      clientPhase(state, options),
      providerPhase(options),
      smokePhase(options),
    ],
  };
}

function ensureDirFor(root, relativePath) {
  mkdirSync(dirname(resolve(root, relativePath)), { recursive: true });
}

function writeJson(root, relativePath, value) {
  ensureDirFor(root, relativePath);
  writeFileSync(resolve(root, relativePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readExisting(root, relativePath) {
  return readTextIfExists(root, relativePath);
}

function upsertManagedBlock(original, block) {
  const start = original.indexOf(AGENTS_BEGIN);
  const end = original.indexOf(AGENTS_END);
  if (start !== -1 && end !== -1 && end > start) {
    const afterEnd = end + AGENTS_END.length;
    const prefix = original.slice(0, start).trimEnd();
    const suffix = original.slice(afterEnd).trimStart();
    return [
      prefix,
      block,
      suffix,
    ].filter(Boolean).join("\n\n").trimEnd() + "\n";
  }
  return `${original.trimEnd()}${original.trim() ? "\n\n" : ""}${block}\n`;
}

function renderAgentsBlock(options) {
  const clients = options.clients.join(", ") || "(none)";
  const providers = options.providers.join(", ") || "(none)";
  const smokeCommands = [];
  const providerDocs = [];
  for (const client of options.clients) {
    smokeCommands.push(`node hooks/verification/smoke-plan.mjs session-start ${client}`);
  }
  const agentsPostCompactClient = options.clients.includes("claude") ? "claude-code" : "codex";
  smokeCommands.push(`node hooks/verification/smoke-plan.mjs post-compact ${agentsPostCompactClient}`);
  if (options.providers.includes("serena")) {
    providerDocs.push("- Serena: `hooks/docs/SERENA-CLIENT-SETUP.md`");
  }
  if (options.providers.includes("semble") || options.providers.includes("rtk")) {
    providerDocs.push("- Semble/RTK: `hooks/docs/OPTIONAL-PROVIDER-SETUP.md`");
  }

  return [
    AGENTS_BEGIN,
    "## Lattice Hook Runtime",
    "",
    "This repo uses lattice through the project-local `hooks/` mount.",
    "",
    "- Keep AI-client hook config project-scoped so every contributor gets the same behavior.",
    "- Do not replace `hooks/` with ad hoc hook scripts; update lattice or add a provider instead.",
    "- For Codex, use `[features].hooks = true`; `[features].codex_hooks` is deprecated.",
    "- If Serena/Semble/RTK are required, enable their `LATTICE_REQUIRE_*` flags only after the matching smoke tests pass.",
    `- Selected clients at init time: ${clients}.`,
    `- Selected optional providers at init time: ${providers}.`,
    ...(providerDocs.length > 0 ? ["", "Provider setup docs:", ...providerDocs] : []),
    "",
    "Useful checks:",
    "",
    "```bash",
    "node hooks/init.mjs --json",
    ...smokeCommands,
    "```",
    AGENTS_END,
  ].join("\n");
}

function claudeSettings() {
  return {
    hooks: {
      SessionStart: [
        {
          matcher: "startup|resume|compact",
          hooks: [
            {
              type: "command",
              command: hookDispatcherCommand("session-start.mjs", "claude-code"),
              timeout: 15,
            },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: "Bash|Edit|MultiEdit|Write|mcp__.*__take_screenshot$",
          hooks: [
            {
              type: "command",
              command: hookDispatcherCommand("pre-tool-policy.mjs", "claude-code"),
              timeout: 15,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "Edit|MultiEdit|Write",
          hooks: [
            {
              type: "command",
              command: hookDispatcherCommand("post-tool-reminder.mjs", "claude-code"),
              timeout: 15,
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: hookDispatcherCommand("stop-checklist.mjs", "claude-code"),
              timeout: 15,
            },
          ],
        },
      ],
    },
  };
}

function hookArgsLiteral(args) {
  return `[${args
    .map((arg) => `'${String(arg).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`)
    .join(",")}]`;
}

function hookDispatcherCommand(target, client, options = {}) {
  const args = [target, client];
  if (options.sessionKind) {
    args.push("--session-kind", options.sessionKind);
  }
  for (const assignment of options.env ?? []) {
    args.push("--env", assignment);
  }

  const runnerFile = options.runnerFile || (client === "codex" ? "codex-hook-runner.mjs" : "hook-runner.mjs");
  const argsLiteral = hookArgsLiteral(args);
  const runnerLiteral = String(runnerFile).replaceAll("\\", "\\\\").replaceAll("'", "\\'");

  return `node --input-type=module -e "import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CLAUDE_PROJECT_DIR||process.env.CLAUDE_PROJECT_ROOT||process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','${runnerLiteral}');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;globalThis.__latticeHookArgs=${argsLiteral};await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/${runnerLiteral} from '+start);process.exit(1)})"`;
}

function codexDispatcherCommand(target, options = {}) {
  return hookDispatcherCommand(target, "codex", options);
}

function codexHooksJson() {
  return {
    hooks: {
      SessionStart: [
        {
          matcher: "startup",
          hooks: [
            {
              type: "command",
              command: codexDispatcherCommand("session-start.mjs"),
              statusMessage: "Checking lattice startup",
              timeout: 15,
            },
          ],
        },
        {
          matcher: "resume",
          hooks: [
            {
              type: "command",
              command: codexDispatcherCommand("session-start.mjs", { sessionKind: "resume" }),
              statusMessage: "Recovering session context",
              timeout: 15,
            },
          ],
        },
        {
          matcher: "compact",
          hooks: [
            {
              type: "command",
              command: codexDispatcherCommand("session-start.mjs", { sessionKind: "compact" }),
              statusMessage: "Recovering compacted session context",
              timeout: 15,
            },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: codexDispatcherCommand("pre-tool-policy.mjs"),
              statusMessage: "Applying lattice guardrails",
              timeout: 15,
            },
          ],
        },
      ],
    },
  };
}

function copilotGuardrailsJson() {
  return {
    version: 1,
    hooks: {
      sessionStart: [
        {
          type: "command",
          bash: "node ./hooks/session-start.mjs copilot",
          powershell: "node .\\hooks\\session-start.mjs copilot",
          cwd: ".",
          timeoutSec: 15,
        },
      ],
      preToolUse: [
        {
          type: "command",
          bash: "node ./hooks/pre-tool-policy.mjs copilot",
          powershell: "node .\\hooks\\pre-tool-policy.mjs copilot",
          cwd: ".",
          timeoutSec: 15,
        },
      ],
    },
  };
}

function ensureTomlKeyInSection(text, section, key, value) {
  const normalized = text.replace(/\r\n/g, "\n").trimEnd();
  const lines = normalized ? normalized.split("\n") : [];
  let sectionIndex = lines.findIndex((line) => line.trim() === `[${section}]`);
  if (sectionIndex === -1) {
    if (lines.length > 0) lines.push("");
    lines.push(`[${section}]`, `${key} = ${value}`);
    return `${lines.join("\n")}\n`;
  }

  let end = lines.length;
  for (let i = sectionIndex + 1; i < lines.length; i += 1) {
    if (/^\s*\[.+\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const keyPattern = new RegExp(`^\\s*${key}\\s*=`);
  for (let i = sectionIndex + 1; i < end; i += 1) {
    if (keyPattern.test(lines[i])) {
      lines[i] = `${key} = ${value}`;
      return `${lines.join("\n")}\n`;
    }
  }

  lines.splice(sectionIndex + 1, 0, `${key} = ${value}`);
  return `${lines.join("\n")}\n`;
}

function withoutDeprecatedCodexHooks(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*codex_hooks\s*=/.test(line))
    .join("\n");
}

function serenaContextForClient(client) {
  return client === "claude" ? "claude-code" : client;
}

function serenaMcpEntry(client) {
  return {
    type: "stdio",
    command: "uvx",
    args: [
      "--from",
      SERENA_UPSTREAM_SPEC,
      "serena",
      "start-mcp-server",
      "--context",
      serenaContextForClient(client),
      "--project-from-cwd",
    ],
  };
}

function sembleMcpEntry() {
  return {
    type: "stdio",
    command: "uvx",
    args: ["--from", "semble[mcp]", "semble"],
  };
}

function parseJsonObject(text, relativePath) {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${relativePath} must contain a JSON object`);
  }
  return parsed;
}

function claudeMcpJson(existing, options) {
  const config = parseJsonObject(existing, ".mcp.json");
  const mcpServers =
    config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
      ? { ...config.mcpServers }
      : {};

  if (options.providers.includes("serena")) {
    mcpServers.serena = serenaMcpEntry("claude");
  }
  if (options.providers.includes("semble")) {
    mcpServers.semble = sembleMcpEntry();
  }

  return {
    ...config,
    mcpServers,
  };
}

function upsertTomlSection(text, header, bodyLines) {
  const normalized = text.replace(/\r\n/g, "\n").trimEnd();
  const lines = normalized ? normalized.split("\n") : [];
  const start = lines.findIndex((line) => line.trim() === `[${header}]`);
  const sectionLines = [`[${header}]`, ...bodyLines];

  if (start === -1) {
    if (lines.length > 0) lines.push("");
    lines.push(...sectionLines);
    return `${lines.join("\n")}\n`;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[.+\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  lines.splice(start, end - start, ...sectionLines);
  return `${lines.join("\n")}\n`;
}

function codexConfigToml(existing, options) {
  let text = withoutDeprecatedCodexHooks(existing);
  text = ensureTomlKeyInSection(text, "features", "hooks", "true");

  if (options.providers.includes("serena")) {
    const entry = serenaMcpEntry("codex");
    text = upsertTomlSection(text, "mcp_servers.serena", [
      `command = ${JSON.stringify(entry.command)}`,
      `args = ${JSON.stringify(entry.args)}`,
    ]);
  }
  if (options.providers.includes("semble")) {
    const entry = sembleMcpEntry();
    text = upsertTomlSection(text, "mcp_servers.semble", [
      `command = ${JSON.stringify(entry.command)}`,
      `args = ${JSON.stringify(entry.args)}`,
    ]);
  }

  return text;
}

const COPY_MOUNT_MISSING_WARNING =
  "Run `pnpm add @lzong.tw/lattice` (or npm/yarn equivalent) before re-running `lattice init --write --mount copy`.";

function copyPackageMountFromNodeModules(root) {
  const destination = resolve(root, "hooks");
  const source = resolve(root, "node_modules/@lzong.tw/lattice");
  if (!existsSync(source)) {
    return { copied: false };
  }
  if (resolve(root) === packageRoot) {
    throw new Error("refusing to copy lattice into itself as hooks/");
  }
  cpSync(source, destination, {
    recursive: true,
    force: true,
    filter(entry) {
      const parts = entry.slice(source.length).split(/[\\/]/).filter(Boolean);
      return !parts.some((part) =>
        [".git", ".serena", ".test-state", "node_modules", "coverage", ".turbo"].includes(part),
      );
    },
  });
  return { copied: true };
}

export function applyInstallPlan(options) {
  const merged = {
    consumerRoot: process.cwd(),
    clients: [...DEFAULT_CLIENTS],
    clientsAuto: false,
    providers: [...DEFAULT_PROVIDERS],
    mount: "submodule",
    format: "markdown",
    latticeRepoUrl: "<lattice-repo-url>",
    write: false,
    ...options,
  };
  if (merged.clientsAuto) {
    merged.clientDetection = merged.clientDetection ?? detectInstalledClients(merged.clientDetectionOptions ?? {});
    merged.clients = merged.clientDetection.clients;
  }
  const root = resolve(merged.consumerRoot);
  const appliedFiles = [];
  const extraWarnings = [];

  if (merged.write && merged.mount === "copy") {
    const { copied } = copyPackageMountFromNodeModules(root);
    if (copied) {
      for (const file of MOUNT_FILES) appliedFiles.push(file);
    } else {
      extraWarnings.push(COPY_MOUNT_MISSING_WARNING);
    }
  }

  if (merged.write && merged.clients.includes("claude")) {
    writeJson(root, ".claude/settings.json", claudeSettings());
    appliedFiles.push(".claude/settings.json");
    if (merged.providers.includes("serena") || merged.providers.includes("semble")) {
      writeJson(root, ".mcp.json", claudeMcpJson(readExisting(root, ".mcp.json"), merged));
      appliedFiles.push(".mcp.json");
    }
  }

  if (merged.write && merged.clients.includes("codex")) {
    const existing = readExisting(root, ".codex/config.toml");
    ensureDirFor(root, ".codex/config.toml");
    writeFileSync(resolve(root, ".codex/config.toml"), codexConfigToml(existing, merged), "utf8");
    writeJson(root, ".codex/hooks.json", codexHooksJson());
    appliedFiles.push(".codex/config.toml", ".codex/hooks.json");
  }

  if (merged.write && merged.clients.includes("copilot")) {
    writeJson(root, ".github/hooks/repo-guardrails.json", copilotGuardrailsJson());
    appliedFiles.push(".github/hooks/repo-guardrails.json");
  }

  if (merged.write) {
    const agents = upsertManagedBlock(readExisting(root, "AGENTS.md"), renderAgentsBlock(merged));
    writeFileSync(resolve(root, "AGENTS.md"), agents, "utf8");
    appliedFiles.push("AGENTS.md");
  }

  const state = detectConsumerState(root);
  const plan = buildInstallPlan(state, merged);
  return { ...plan, warnings: [...plan.warnings, ...extraWarnings], appliedFiles };
}

export function renderMarkdownPlan(plan) {
  const lines = [
    "# Lattice Consumer Install Plan",
    "",
    `Consumer repo: \`${plan.consumerRoot}\``,
    `Clients: ${plan.selectedClients.length > 0 ? plan.selectedClients.join(", ") : "(none)"}`,
    `Providers: ${plan.selectedProviders.length > 0 ? plan.selectedProviders.join(", ") : "(none)"}`,
    "",
  ];

  if (plan.clientsAuto && plan.clientDetection?.probes?.length > 0) {
    lines.push("## Client Auto-Detection", "");
    for (const probe of plan.clientDetection.probes) {
      const status = probe.installed ? "detected" : "missing";
      const note = probe.note ? ` (${probe.note})` : "";
      lines.push(`- ${probe.client}: ${status} via \`${probe.command}\`${note}`);
    }
    lines.push("");
  }

  if (plan.appliedFiles?.length > 0) {
    lines.push("## Applied Files", "");
    for (const file of plan.appliedFiles) lines.push(`- ${file}`);
    lines.push("");
  }

  if (plan.warnings.length > 0) {
    lines.push("## Warnings", "");
    for (const warning of plan.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }

  for (const [index, phase] of plan.phases.entries()) {
    lines.push(`## Phase ${index + 1}: ${phase.title}`, "");
    lines.push(`Status: ${phase.status}`, "");
    for (const action of phase.actions) lines.push(`- ${action}`);
    if (phase.commands.length > 0) {
      lines.push("", "```bash");
      for (const command of phase.commands) lines.push(command);
      lines.push("```");
    }
    lines.push("");
  }

  lines.push("## Done", "");
  lines.push("- Do not set LATTICE_REQUIRE_* flags until the related provider smoke tests pass.");
  lines.push("- Commit the project-scoped hook and MCP config files so every project participant gets the same behavior.");
  return `${lines.join("\n")}\n`;
}

function usage() {
  return [
    "Usage:",
    "  lattice init [--consumer <repo>] [--clients auto|claude-code,codex,copilot-cli] [--providers serena,semble,rtk]",
    "  node hooks/init.mjs [same options]",
    "",
    "Options:",
    "  --consumer, --repo <path>       Consumer repo root. Defaults to cwd.",
    "  --clients <list|auto>          Comma list, or auto-detect installed supported CLIs. Defaults to claude,codex.",
    "  --providers <list>             Comma list. Defaults to none.",
    "  --mount submodule|copy         Mount strategy for hooks/. Defaults to submodule.",
    "  --lattice-repo-url <url>       URL used in the submodule command.",
    "  --format markdown|json         Output format. Defaults to markdown.",
    "  --json                         Shortcut for --format json.",
    "  --write                        Write managed client config and AGENTS.md.",
  ].join("\n");
}

async function main() {
  const options = parseInitArgs();
  if (options.help) {
    console.log(usage());
    return;
  }

  const plan = applyInstallPlan(options);
  if (options.format === "json") {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    process.stdout.write(renderMarkdownPlan(plan));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`lattice init: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
