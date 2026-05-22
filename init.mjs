#!/usr/bin/env node
/**
 * init.mjs — OpenCode-style install planner for consumer repos.
 *
 * The command is intentionally read-only. It inspects a consumer repo and prints
 * a concrete plan that an LLM agent or human can follow, then verify.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CLIENTS = Object.freeze(["claude", "codex"]);
const DEFAULT_PROVIDERS = Object.freeze([]);
const MOUNT_FILES = Object.freeze([
  "hooks/common.mjs",
  "hooks/session-start.mjs",
  "hooks/codex-hook-runner.mjs",
  "hooks/pre-tool-policy.mjs",
]);
const packageRoot = dirname(fileURLToPath(import.meta.url));
const AGENTS_BEGIN = "<!-- lattice:init:v1:begin -->";
const AGENTS_END = "<!-- lattice:init:v1:end -->";

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

export function parseInitArgs(argv = process.argv.slice(2)) {
  const args = [...argv];
  if (args[0] === "init") args.shift();

  const options = {
    consumerRoot: process.cwd(),
    clients: [...DEFAULT_CLIENTS],
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
      options.clients = normalizeChoiceList(next(), DEFAULT_CLIENTS);
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
    phase.actions.push("Install @lattice/core and copy it into the stable consumer path hooks/.");
    phase.commands.push("pnpm add @lattice/core");
    phase.commands.push(
      "mkdir -p hooks && node -e \"import('node:fs').then(({cpSync,rmSync})=>{rmSync('hooks',{recursive:true,force:true});cpSync('node_modules/@lattice/core','hooks',{recursive:true})})\"",
    );
  } else {
    phase.actions.push("Add lattice as a git submodule at the stable consumer path hooks/.");
    phase.commands.push(`git submodule add ${options.latticeRepoUrl} hooks`);
    phase.commands.push("git submodule update --init --recursive");
  }

  phase.commands.push("ls hooks/common.mjs hooks/session-start.mjs hooks/codex-hook-runner.mjs hooks/pre-tool-policy.mjs");
  phase.commands.push("node --check hooks/common.mjs");
  phase.commands.push("node --check hooks/session-start.mjs");
  phase.commands.push("node --check hooks/codex-hook-runner.mjs");
  phase.commands.push("node --check hooks/pre-tool-policy.mjs");
  return phase;
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
    phase.commands.push("test -f .claude/settings.json");
  }

  if (options.clients.includes("codex")) {
    phase.actions.push(
      state.codex.configExists && state.codex.hooksExists
        ? "Review .codex/config.toml and .codex/hooks.json against README.md, using [features].hooks and hooks/codex-hook-runner.mjs."
        : "Create or update .codex/config.toml and .codex/hooks.json with the Codex CLI config from README.md.",
    );
    phase.commands.push("test -f .codex/config.toml");
    phase.commands.push("test -f .codex/hooks.json");
  }

  if (options.clients.includes("copilot")) {
    phase.actions.push(
      state.copilot.guardrailsExists
        ? "Review .github/hooks/repo-guardrails.json against README.md."
        : "Create or update .github/hooks/repo-guardrails.json with the GitHub Copilot CLI config from README.md.",
    );
    phase.commands.push("test -f .github/hooks/repo-guardrails.json");
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
    phase.actions.push("Install rtk, keep it fail-open first, and set LATTICE_REQUIRE_RTK=1 only after smoke testing.");
    phase.commands.push("rtk --version");
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
    actions: ["Run these checks from the consumer repo and fix any failure before committing."],
    commands: [],
  };

  for (const client of options.clients) {
    const hookClient = client === "copilot" ? "copilot" : client;
    phase.commands.push(`printf '{}\\n' | env LATTICE_PROVIDER=none node hooks/session-start.mjs ${hookClient}`);
  }

  if (options.clients.includes("claude")) {
    phase.commands.push(
      "echo '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m test\"}}' | node hooks/pre-tool-policy.mjs claude | grep '\"permissionDecision\":\"deny\"'",
    );
  }
  if (options.clients.includes("codex")) {
    phase.commands.push(
      "echo '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m test\"}}' | node hooks/pre-tool-policy.mjs codex | grep '\"permissionDecision\":\"deny\"'",
    );
  }
  if (options.clients.includes("copilot")) {
    phase.commands.push(
      "echo '{\"toolName\":\"bash\",\"toolArgs\":\"{\\\"command\\\":\\\"git commit -m test\\\"}\"}' | node hooks/pre-tool-policy.mjs copilot | grep '\"permissionDecision\":\"deny\"'",
    );
  }

  return phase;
}

export function buildInstallPlan(state, options) {
  const warnings = [];
  if (!state.isGitRepo) {
    warnings.push("Consumer root is not a git repo; run this from the repository root or pass --consumer.");
  }
  if (state.codex.usesDeprecatedHooksFlag) {
    warnings.push("Codex config uses deprecated [features].codex_hooks; replace it with [features].hooks.");
  }

  return {
    generatedBy: "lattice init",
    consumerRoot: state.root,
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
  if (options.clients.includes("claude")) {
    smokeCommands.push("printf '{}\\n' | env LATTICE_PROVIDER=none node hooks/session-start.mjs claude");
  }
  if (options.clients.includes("codex")) {
    smokeCommands.push("printf '{}\\n' | env LATTICE_PROVIDER=none node hooks/session-start.mjs codex");
  }
  if (options.clients.includes("copilot")) {
    smokeCommands.push("printf '{}\\n' | env LATTICE_PROVIDER=none node hooks/session-start.mjs copilot");
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
          matcher: "startup|resume",
          hooks: [
            {
              type: "command",
              command: 'node "$CLAUDE_PROJECT_DIR"/hooks/session-start.mjs claude',
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
              command: 'node "$CLAUDE_PROJECT_DIR"/hooks/pre-tool-policy.mjs claude',
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
              command: 'node "$CLAUDE_PROJECT_DIR"/hooks/post-tool-reminder.mjs claude',
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
              command: 'node "$CLAUDE_PROJECT_DIR"/hooks/stop-checklist.mjs',
              timeout: 15,
            },
          ],
        },
      ],
    },
  };
}

function codexDispatcherCommand(target, extraEnv = "") {
  const prefix = [
    extraEnv,
    `LATTICE_HOOK_TARGET=${target}`,
    "LATTICE_HOOK_CLIENT=codex",
  ].filter(Boolean).join(" ");
  return `${prefix} node --input-type=module -e "import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','codex-hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/codex-hook-runner.mjs from '+start);process.exit(1)})"`;
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
              command: codexDispatcherCommand("session-start.mjs", "LATTICE_SESSION_KIND=resume"),
              statusMessage: "Recovering session context",
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
    text = upsertTomlSection(text, "mcp_servers.serena", [
      'url = "http://127.0.0.1:9123/mcp"',
    ]);
  }
  if (options.providers.includes("semble")) {
    text = upsertTomlSection(text, "mcp_servers.semble", [
      'command = "uvx"',
      'args = ["--from", "semble[mcp]", "semble"]',
    ]);
  }

  return text;
}

function copyPackageMount(root) {
  const destination = resolve(root, "hooks");
  if (resolve(root) === packageRoot) {
    throw new Error("refusing to copy lattice into itself as hooks/");
  }
  rmSync(destination, { recursive: true, force: true });
  cpSync(packageRoot, destination, {
    recursive: true,
    filter(source) {
      const parts = source.slice(packageRoot.length).split(/[\\/]/).filter(Boolean);
      return !parts.some((part) => [".git", "node_modules", "coverage", ".turbo"].includes(part));
    },
  });
}

export function applyInstallPlan(options) {
  const merged = {
    consumerRoot: process.cwd(),
    clients: [...DEFAULT_CLIENTS],
    providers: [...DEFAULT_PROVIDERS],
    mount: "submodule",
    format: "markdown",
    latticeRepoUrl: "<lattice-repo-url>",
    write: false,
    ...options,
  };
  const root = resolve(merged.consumerRoot);
  const appliedFiles = [];

  if (merged.write && merged.mount === "copy" && !detectConsumerState(root).hooksMounted) {
    copyPackageMount(root);
    appliedFiles.push("hooks/");
  }

  if (merged.write && merged.clients.includes("claude")) {
    writeJson(root, ".claude/settings.json", claudeSettings());
    appliedFiles.push(".claude/settings.json");
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
  return { ...buildInstallPlan(state, merged), appliedFiles };
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
    "  lattice init [--consumer <repo>] [--clients claude,codex,copilot] [--providers serena,semble,rtk]",
    "  node hooks/init.mjs [same options]",
    "",
    "Options:",
    "  --consumer, --repo <path>       Consumer repo root. Defaults to cwd.",
    "  --clients <list>               Comma list. Defaults to claude,codex.",
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
