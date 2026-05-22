import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyInstallPlan,
  buildInstallPlan,
  detectConsumerState,
  parseInitArgs,
  renderMarkdownPlan,
} from "../init.mjs";
import { validateRequiredSerenaMcpConfig } from "../serena/mcp-config-guard.mjs";
import { validateRequiredSembleMcpConfig } from "../semble/mcp-config-guard.mjs";

function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), "lattice-init-consumer-"));
  mkdirSync(join(root, ".git"));
  return root;
}

describe("lattice init install plan", () => {
  it("is configured to publish publicly to npm with provenance", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
    expect(pkg.publishConfig).toEqual({ access: "public", provenance: true });
    expect(pkg.scripts.prepublishOnly).not.toContain("LATTICE_ALLOW_PUBLISH");
  });

  it("detects missing mount and client config without writing to the consumer repo", () => {
    const root = tempRepo();

    const state = detectConsumerState(root);
    const plan = buildInstallPlan(state, {
      clients: ["claude", "codex"],
      providers: [],
      mount: "submodule",
      latticeRepoUrl: "https://github.com/example/lattice.git",
    });

    expect(state.hooksMounted).toBe(false);
    expect(plan.phases[0].title).toBe("Mount lattice at hooks/");
    expect(plan.phases.flatMap((phase) => phase.actions)).toContain(
      "Create or update .claude/settings.json with the Claude Code hook config from README.md.",
    );
    expect(plan.phases.flatMap((phase) => phase.actions)).toContain(
      "Create or update .codex/config.toml and .codex/hooks.json with the Codex CLI config from README.md.",
    );
    expect(renderMarkdownPlan(plan)).toContain("git submodule add https://github.com/example/lattice.git hooks");
  });

  it("recognizes an existing mount and flags deprecated Codex hook feature config", () => {
    const root = tempRepo();
    mkdirSync(join(root, "hooks"));
    writeFileSync(join(root, "hooks/common.mjs"), "", "utf8");
    writeFileSync(join(root, "hooks/session-start.mjs"), "", "utf8");
    writeFileSync(join(root, "hooks/codex-hook-runner.mjs"), "", "utf8");
    writeFileSync(join(root, "hooks/pre-tool-policy.mjs"), "", "utf8");
    mkdirSync(join(root, ".codex"));
    writeFileSync(join(root, ".codex/config.toml"), "[features]\ncodex_hooks = true\n", "utf8");
    writeFileSync(join(root, ".codex/hooks.json"), "{}\n", "utf8");

    const state = detectConsumerState(root);
    const plan = buildInstallPlan(state, {
      clients: ["codex"],
      providers: ["serena", "semble"],
      mount: "submodule",
      latticeRepoUrl: "<lattice-repo-url>",
    });

    expect(state.hooksMounted).toBe(true);
    expect(state.codex.usesDeprecatedHooksFlag).toBe(true);
    expect(plan.warnings).toContain("Codex config uses deprecated [features].codex_hooks; replace it with [features].hooks.");
    expect(plan.phases.flatMap((phase) => phase.actions)).toContain(
      "Add Serena MCP config for each selected client before setting LATTICE_REQUIRE_SERENA_MCP=1.",
    );
    expect(plan.phases.flatMap((phase) => phase.actions)).toContain(
      "Add stdio Semble MCP config before setting LATTICE_REQUIRE_SEMBLE_MCP=1.",
    );
  });

  it("parses CLI flags for clients, providers, mount strategy, and JSON output", () => {
    expect(
      parseInitArgs([
        "--clients",
        "claude,codex",
        "--providers",
        "serena,rtk",
        "--mount",
        "copy",
      "--json",
      "--write",
      "--lattice-repo-url",
      "git@example.com:lattice.git",
      ]),
    ).toEqual({
      consumerRoot: process.cwd(),
      clients: ["claude", "codex"],
      providers: ["serena", "rtk"],
      mount: "copy",
      format: "json",
      write: true,
      latticeRepoUrl: "git@example.com:lattice.git",
    });
  });

  it("writes Claude, Codex, and AGENTS config when write mode is explicit", () => {
    const root = tempRepo();
    mkdirSync(join(root, "hooks"));
    for (const file of ["common.mjs", "session-start.mjs", "codex-hook-runner.mjs", "pre-tool-policy.mjs"]) {
      writeFileSync(join(root, "hooks", file), "", "utf8");
    }

    const result = applyInstallPlan({
      consumerRoot: root,
      clients: ["claude", "codex"],
      providers: [],
      mount: "submodule",
      latticeRepoUrl: "<lattice-repo-url>",
      format: "markdown",
      write: true,
    });

    expect(result.appliedFiles).toEqual(
      expect.arrayContaining([
        ".claude/settings.json",
        ".codex/config.toml",
        ".codex/hooks.json",
        "AGENTS.md",
      ]),
    );
    expect(JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8")).hooks.SessionStart[0].hooks[0].command).toContain(
      "hooks/session-start.mjs claude",
    );
    expect(JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8")).hooks.SessionStart[0].matcher).toBe("startup|resume|compact");
    expect(readFileSync(join(root, ".codex/config.toml"), "utf8")).toContain("hooks = true");
    const codexHooks = JSON.parse(readFileSync(join(root, ".codex/hooks.json"), "utf8"));
    expect(readFileSync(join(root, ".codex/hooks.json"), "utf8")).toContain("codex-hook-runner.mjs");
    expect(codexHooks.hooks.SessionStart.map((entry: { matcher: string }) => entry.matcher)).toContain("compact");
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("lattice:init:v1");
  });

  it("runs required hook smokes from an applied consumer repo", () => {
    const root = tempRepo();
    // mount:"copy" sources from <root>/node_modules/@lzong.tw/lattice. Simulate
    // an npm install by copying the package source into that path first.
    const packageRoot = resolve(process.cwd());
    const nodeModulesPkg = join(root, "node_modules", "@lzong.tw", "lattice");
    mkdirSync(nodeModulesPkg, { recursive: true });
    cpSync(packageRoot, nodeModulesPkg, {
      recursive: true,
      filter(entry) {
        const parts = entry.slice(packageRoot.length).split(/[\\/]/).filter(Boolean);
        return !parts.some((p) =>
          [".git", ".serena", ".test-state", "node_modules", "coverage", ".turbo"].includes(p),
        );
      },
    });

    applyInstallPlan({
      consumerRoot: root,
      clients: ["claude", "codex"],
      providers: [],
      mount: "copy",
      latticeRepoUrl: "<lattice-repo-url>",
      format: "markdown",
      write: true,
    });

    const runHook = (script: string, client: string, input: string, env: Record<string, string> = {}) =>
      spawnSync(process.execPath, [join(root, "hooks", script), client], {
        cwd: root,
        input,
        encoding: "utf8",
        env: { ...process.env, ...env },
      });

    for (const client of ["claude-code", "codex"]) {
      const result = runHook("session-start.mjs", client, "{}\n", { LATTICE_PROVIDER: "none" });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
    }

    const postCompact = runHook("session-start.mjs", "claude-code", '{"hook_event_name":"PostCompact"}\n', {
      LATTICE_PROVIDER: "none",
    });
    expect(postCompact.error).toBeUndefined();
    expect(postCompact.status).toBe(0);
    expect(postCompact.stdout.trim()).toBe("{}");

    const preTool = runHook(
      "pre-tool-policy.mjs",
      "claude-code",
      '{"tool_name":"Bash","tool_input":{"command":"git commit -m test"}}',
      { LATTICE_PROVIDERS: "lattice/protection" },
    );
    expect(preTool.error).toBeUndefined();
    expect(preTool.status).toBe(0);
    expect(JSON.parse(preTool.stdout)).toEqual(
      expect.objectContaining({
        hookSpecificOutput: expect.objectContaining({
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        }),
      }),
    );
  });

  it("writes provider MCP config that satisfies Serena and Semble startup guards", () => {
    const root = tempRepo();
    mkdirSync(join(root, "hooks"));
    for (const file of ["common.mjs", "session-start.mjs", "codex-hook-runner.mjs", "pre-tool-policy.mjs"]) {
      writeFileSync(join(root, "hooks", file), "", "utf8");
    }

    applyInstallPlan({
      consumerRoot: root,
      clients: ["claude", "codex"],
      providers: ["serena", "semble", "rtk"],
      mount: "submodule",
      latticeRepoUrl: "<lattice-repo-url>",
      format: "markdown",
      write: true,
    });

    const claudeMcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
    expect(claudeMcp.mcpServers.serena.command).toBe("uvx");
    expect(claudeMcp.mcpServers.serena.args).toContain("start-mcp-server");
    expect(claudeMcp.mcpServers.serena.args).toContain("--project-from-cwd");
    expect(claudeMcp.mcpServers.semble).toEqual({
      type: "stdio",
      command: "uvx",
      args: ["--from", "semble[mcp]", "semble"],
    });

    const codexConfig = readFileSync(join(root, ".codex/config.toml"), "utf8");
    expect(codexConfig).toContain("[mcp_servers.serena]");
    expect(codexConfig).toContain("start-mcp-server");
    expect(codexConfig).toContain("--project-from-cwd");
    expect(codexConfig).toContain("[mcp_servers.semble]");

    expect(validateRequiredSerenaMcpConfig("claude", { root })).toEqual({
      ok: true,
      failures: [],
    });
    expect(validateRequiredSerenaMcpConfig("codex", { root })).toEqual({
      ok: true,
      failures: [],
    });
    expect(validateRequiredSembleMcpConfig("claude", { root })).toEqual({
      ok: true,
      failures: [],
    });
    expect(validateRequiredSembleMcpConfig("codex", { root })).toEqual({
      ok: true,
      failures: [],
    });

    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("hooks/docs/SERENA-CLIENT-SETUP.md");
    expect(agents).toContain("hooks/docs/OPTIONAL-PROVIDER-SETUP.md");
  });

  it("is idempotent when write mode runs more than once", () => {
    const root = tempRepo();
    mkdirSync(join(root, "hooks"));
    for (const file of ["common.mjs", "session-start.mjs", "codex-hook-runner.mjs", "pre-tool-policy.mjs"]) {
      writeFileSync(join(root, "hooks", file), "", "utf8");
    }

    const options = {
      consumerRoot: root,
      clients: ["claude", "codex"],
      providers: [],
      mount: "submodule",
      latticeRepoUrl: "<lattice-repo-url>",
      format: "markdown",
      write: true,
    };
    applyInstallPlan(options);
    const first = {
      agents: readFileSync(join(root, "AGENTS.md"), "utf8"),
      codexConfig: readFileSync(join(root, ".codex/config.toml"), "utf8"),
      codexHooks: readFileSync(join(root, ".codex/hooks.json"), "utf8"),
      claude: readFileSync(join(root, ".claude/settings.json"), "utf8"),
    };

    applyInstallPlan(options);

    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(first.agents);
    expect(readFileSync(join(root, ".codex/config.toml"), "utf8")).toBe(first.codexConfig);
    expect(readFileSync(join(root, ".codex/hooks.json"), "utf8")).toBe(first.codexHooks);
    expect(readFileSync(join(root, ".claude/settings.json"), "utf8")).toBe(first.claude);
  });

  it("replaces deprecated Codex hook feature config during write mode", () => {
    const root = tempRepo();
    mkdirSync(join(root, "hooks"));
    for (const file of ["common.mjs", "session-start.mjs", "codex-hook-runner.mjs", "pre-tool-policy.mjs"]) {
      writeFileSync(join(root, "hooks", file), "", "utf8");
    }
    mkdirSync(join(root, ".codex"));
    writeFileSync(join(root, ".codex/config.toml"), "[features]\ncodex_hooks = true\n", "utf8");

    applyInstallPlan({
      consumerRoot: root,
      clients: ["codex"],
      providers: [],
      mount: "submodule",
      latticeRepoUrl: "<lattice-repo-url>",
      format: "markdown",
      write: true,
    });

    const config = readFileSync(join(root, ".codex/config.toml"), "utf8");
    expect(config).toContain("[features]");
    expect(config).toContain("hooks = true");
    expect(config).not.toContain("codex_hooks");
  });

  it("copies the published @lzong.tw/lattice package from node_modules into hooks/ when --mount copy --write", () => {
    const root = tempRepo();
    const pkgDir = join(root, "node_modules/@lzong.tw/lattice");
    mkdirSync(pkgDir, { recursive: true });
    for (const file of ["common.mjs", "session-start.mjs", "codex-hook-runner.mjs", "pre-tool-policy.mjs"]) {
      writeFileSync(join(pkgDir, file), `// stub ${file}\n`, "utf8");
    }

    const result = applyInstallPlan({
      consumerRoot: root,
      clients: ["claude"],
      providers: [],
      mount: "copy",
      latticeRepoUrl: "<lattice-repo-url>",
      format: "markdown",
      write: true,
    });

    for (const file of [
      "hooks/common.mjs",
      "hooks/session-start.mjs",
      "hooks/codex-hook-runner.mjs",
      "hooks/pre-tool-policy.mjs",
    ]) {
      expect(readFileSync(join(root, file), "utf8")).toContain("stub");
      expect(result.appliedFiles).toContain(file);
    }
    expect(result.appliedFiles).toContain(".claude/settings.json");
    expect(result.warnings).not.toContain(
      "Run `pnpm add @lzong.tw/lattice` (or npm/yarn equivalent) before re-running `lattice init --write --mount copy`.",
    );
  });

  it("is idempotent across repeated --mount copy --write runs", () => {
    const root = tempRepo();
    const pkgDir = join(root, "node_modules/@lzong.tw/lattice");
    mkdirSync(pkgDir, { recursive: true });
    for (const file of ["common.mjs", "session-start.mjs", "codex-hook-runner.mjs", "pre-tool-policy.mjs"]) {
      writeFileSync(join(pkgDir, file), `// stub ${file}\n`, "utf8");
    }

    const options = {
      consumerRoot: root,
      clients: ["claude"],
      providers: [],
      mount: "copy" as const,
      latticeRepoUrl: "<lattice-repo-url>",
      format: "markdown" as const,
      write: true,
    };
    applyInstallPlan(options);
    const first = {
      common: readFileSync(join(root, "hooks/common.mjs"), "utf8"),
      sessionStart: readFileSync(join(root, "hooks/session-start.mjs"), "utf8"),
      codexRunner: readFileSync(join(root, "hooks/codex-hook-runner.mjs"), "utf8"),
      preTool: readFileSync(join(root, "hooks/pre-tool-policy.mjs"), "utf8"),
    };

    expect(() => applyInstallPlan(options)).not.toThrow();

    expect(readFileSync(join(root, "hooks/common.mjs"), "utf8")).toBe(first.common);
    expect(readFileSync(join(root, "hooks/session-start.mjs"), "utf8")).toBe(first.sessionStart);
    expect(readFileSync(join(root, "hooks/codex-hook-runner.mjs"), "utf8")).toBe(first.codexRunner);
    expect(readFileSync(join(root, "hooks/pre-tool-policy.mjs"), "utf8")).toBe(first.preTool);
  });

  it("warns and leaves hooks/ untouched when --mount copy --write runs without node_modules/@lzong.tw/lattice", () => {
    const root = tempRepo();

    const result = applyInstallPlan({
      consumerRoot: root,
      clients: ["claude"],
      providers: [],
      mount: "copy",
      latticeRepoUrl: "<lattice-repo-url>",
      format: "markdown",
      write: true,
    });

    expect(result.warnings).toContain(
      "Run `pnpm add @lzong.tw/lattice` (or npm/yarn equivalent) before re-running `lattice init --write --mount copy`.",
    );
    expect(result.appliedFiles).not.toContain("hooks/common.mjs");
    expect(() => readFileSync(join(root, "hooks/common.mjs"), "utf8")).toThrow();
  });

  it("emits a cross-platform dry-run command for --mount copy without --write", () => {
    const root = tempRepo();
    const state = detectConsumerState(root);
    const plan = buildInstallPlan(state, {
      clients: ["claude"],
      providers: [],
      mount: "copy",
      latticeRepoUrl: "<lattice-repo-url>",
    });

    const mountPhase = plan.phases[0];
    const commands: string[] = mountPhase.commands as string[];
    const copyCommand = commands.find((cmd) => cmd.startsWith("node -e"));
    expect(copyCommand).toBeDefined();
    expect(copyCommand).not.toContain("mkdir -p");
    expect(copyCommand).not.toContain("import('node:fs')");
    expect(copyCommand).toContain("require('node:fs')");
    expect((copyCommand as string).startsWith("node -e \"")).toBe(true);
  });

  it("emits only cross-platform commands in the markdown plan", () => {
    const root = tempRepo();
    const state = detectConsumerState(root);
    const plan = buildInstallPlan(state, {
      clients: ["claude", "codex", "copilot"],
      providers: [],
      mount: "submodule",
      latticeRepoUrl: "https://github.com/example/lattice.git",
    });

    const markdown = renderMarkdownPlan(plan);

    // POSIX-only patterns that break on Windows cmd.exe / PowerShell.
    expect(markdown).not.toMatch(/(^|\s)printf\s/);
    expect(markdown).not.toMatch(/(^|\s)test -f\s/);
    expect(markdown).not.toMatch(/(^|\s)env [A-Z_]+=/);
    expect(markdown).not.toMatch(/\| grep /);
    expect(markdown).not.toMatch(/^\s*ls\s/m);
    // The session-start and pre-tool-deny smoke checks should run via the
    // pure-Node helper so they behave identically on every platform.
    expect(markdown).toContain("node hooks/verification/smoke-plan.mjs session-start claude");
    expect(markdown).toContain("node hooks/verification/smoke-plan.mjs pre-tool-deny codex");
    expect(markdown).toContain("node hooks/verification/smoke-plan.mjs pre-tool-deny copilot");
  });

  it("documents RTK upstream install commands for agents", () => {
    const doc = readFileSync(resolve(process.cwd(), "docs/OPTIONAL-PROVIDER-SETUP.md"), "utf8");

    expect(doc).toContain("https://github.com/rtk-ai/rtk");
    expect(doc).toContain("RTK is a user/global dependency, not project-local state.");
    expect(doc).toContain("Do not reinstall RTK");
    expect(doc).toContain("per repo.");
    expect(doc).toContain("brew install rtk");
    expect(doc).toContain("curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh");
    expect(doc).toContain("cargo install --git https://github.com/rtk-ai/rtk rtk");
    expect(doc).toContain("rtk gain");
    expect(doc).toContain("It does not install RTK");
    expect(doc).toContain("project-local RTK");
  });
});
