import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
    expect(readFileSync(join(root, ".codex/config.toml"), "utf8")).toContain("hooks = true");
    expect(readFileSync(join(root, ".codex/hooks.json"), "utf8")).toContain("codex-hook-runner.mjs");
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("lattice:init:v1");
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
});
