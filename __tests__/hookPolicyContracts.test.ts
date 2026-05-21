import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { validateRequiredSerenaMcpConfig } from "../serena/mcp-config-guard.mjs";
import { validateRequiredSembleMcpConfig } from "../semble/mcp-config-guard.mjs";

const packageRoot = process.cwd();
const repoRoot = resolve(packageRoot, "..");
const node = process.execPath;

function codexDispatcherCommand(target: "session-start.mjs" | "pre-tool-policy.mjs") {
  return `LATTICE_HOOK_TARGET=${target} LATTICE_HOOK_CLIENT=codex node --input-type=module -e "import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','codex-hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/codex-hook-runner.mjs from '+start);process.exit(1)})"`;
}

function runHook(
  scriptName: string,
  client: string,
  payload: Record<string, unknown>,
  env: Record<string, string> = {},
) {
  const result = spawnSync(node, [resolve(packageRoot, scriptName), client], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: packageRoot,
    env: { ...process.env, ...env },
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

const consumerConfigFixtures = {
  claude: {
    sessionStart: 'node "$CLAUDE_PROJECT_DIR"/hooks/session-start.mjs claude',
    preToolUse: 'node "$CLAUDE_PROJECT_DIR"/hooks/pre-tool-policy.mjs claude',
    postToolUse: 'node "$CLAUDE_PROJECT_DIR"/hooks/post-tool-reminder.mjs claude',
    stop: 'node "$CLAUDE_PROJECT_DIR"/hooks/stop-checklist.mjs',
  },
  copilot: {
    sessionStart: "node ./hooks/session-start.mjs copilot",
    preToolUse: "node ./hooks/pre-tool-policy.mjs copilot",
  },
  codex: {
    sessionStart: "hooks/codex-hook-runner.mjs session-start.mjs codex",
    preToolUse: "hooks/codex-hook-runner.mjs pre-tool-policy.mjs codex",
  },
} as const;

describe("consumer path contract", () => {
  it("documents stable hooks mount paths for all supported clients", () => {
    expect(consumerConfigFixtures.claude.sessionStart).toContain("hooks/session-start.mjs");
    expect(consumerConfigFixtures.claude.preToolUse).toContain("hooks/pre-tool-policy.mjs");
    expect(consumerConfigFixtures.claude.postToolUse).toContain("hooks/post-tool-reminder.mjs");
    expect(consumerConfigFixtures.claude.stop).toContain("hooks/stop-checklist.mjs");

    expect(consumerConfigFixtures.copilot.sessionStart).toContain("hooks/session-start.mjs");
    expect(consumerConfigFixtures.copilot.preToolUse).toContain("hooks/pre-tool-policy.mjs");

    expect(consumerConfigFixtures.codex.sessionStart).toContain("hooks/codex-hook-runner.mjs");
    expect(consumerConfigFixtures.codex.sessionStart).toContain("session-start.mjs");
    expect(consumerConfigFixtures.codex.preToolUse).toContain("hooks/codex-hook-runner.mjs");
    expect(consumerConfigFixtures.codex.preToolUse).toContain("pre-tool-policy.mjs");
  });
});

describe("hook entry-point behavior", () => {
  // Codex Windows path uses a different dispatcher; not yet covered. See cross-platform review 2026-05-21.
  it.skipIf(process.platform === "win32")("dispatches Codex project hooks from payload cwd instead of shell cwd", () => {
    const consumerRoot = mkdtempSync(join(tmpdir(), "lattice-codex-consumer-"));
    symlinkSync(packageRoot, join(consumerRoot, "hooks"), "dir");
    const consumerConfigPath = resolve(repoRoot, ".codex/hooks.json");
    const command = existsSync(consumerConfigPath)
      ? JSON.parse(readFileSync(consumerConfigPath, "utf8")).hooks.PreToolUse[0].hooks[0].command
      : codexDispatcherCommand("pre-tool-policy.mjs");

    expect(command).toContain("codex-hook-runner.mjs");
    expect(command).not.toContain("rev-parse --show-toplevel");

    const result = spawnSync("sh", ["-lc", command], {
      input: JSON.stringify({
        cwd: consumerRoot,
        tool_name: "Bash",
        tool_input: { command: "git commit -m test" },
      }),
      encoding: "utf8",
      cwd: dirname(consumerRoot),
    });

    if (result.error) {
      throw result.error;
    }

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        hookSpecificOutput: expect.objectContaining({
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        }),
      }),
    );
  });

  it("denies shell git commit for Copilot JSON hooks", () => {
    const result = runHook("pre-tool-policy.mjs", "copilot", {
      toolName: "bash",
      toolArgs: JSON.stringify({ command: "git commit -m test" }),
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        permissionDecision: "deny",
      }),
    );
  });

  it("denies shell git commit for Claude and Codex hooks", () => {
    for (const client of ["claude", "codex"]) {
      const result = runHook("pre-tool-policy.mjs", client, {
        tool_name: "Bash",
        tool_input: { command: "git commit -m test" },
      });

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(
        expect.objectContaining({
          hookSpecificOutput: expect.objectContaining({
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
          }),
        }),
      );
    }
  });

  it("emits Claude-only reminder hooks without blocking", () => {
    const screenshot = runHook("pre-tool-policy.mjs", "claude", {
      tool_name: "mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot",
      tool_input: {},
    });
    const postEdit = runHook("post-tool-reminder.mjs", "claude", {
      tool_name: "Edit",
      tool_input: {},
    });

    expect(screenshot.status).toBe(0);
    expect(screenshot.stderr).toMatch(/After this screenshot/);
    expect(postEdit.status).toBe(0);
    expect(postEdit.stderr).toMatch(/reusable lesson/i);
  });

  it("denies AI edits to environment files", () => {
    const root = mkdtempSync(join(tmpdir(), "lattice-protect-env-"));
    const result = runHook("pre-tool-policy.mjs", "claude", {
      tool_name: "Edit",
      tool_input: { file_path: join(root, ".env") },
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        hookSpecificOutput: expect.objectContaining({
          permissionDecision: "deny",
          permissionDecisionReason: expect.stringContaining("Environment files"),
        }),
      }),
    );
  });

  it("denies AI edits to detected lockfiles", () => {
    const root = mkdtempSync(join(tmpdir(), "lattice-protect-lockfile-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: {} }), "utf8");
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

    const result = runHook("pre-tool-policy.mjs", "claude", {
      tool_name: "Write",
      tool_input: { file_path: join(root, "pnpm-lock.yaml") },
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        hookSpecificOutput: expect.objectContaining({
          permissionDecision: "deny",
          permissionDecisionReason: expect.stringContaining("lockfile pnpm-lock.yaml"),
        }),
      }),
    );
  });

  it("keeps Stop verification optional and no-ops when no stack is detected", () => {
    const root = mkdtempSync(join(tmpdir(), "lattice-stop-no-stack-"));
    const result = runHook(
      "stop-checklist.mjs",
      "claude",
      { cwd: root, session_id: "test-session" },
      { LATTICE_VERIFY_ON_STOP: "1" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("END-OF-TURN CHECKLIST");
    expect(result.stdout).toBe("");
  });

  it("wires the commit checkpoint reminder through the builtins registry", () => {
    const sessionStartSource = readFileSync(resolve(packageRoot, "session-start.mjs"), "utf8");
    const preToolSource = readFileSync(resolve(packageRoot, "pre-tool-policy.mjs"), "utf8");
    const registerSource = readFileSync(resolve(packageRoot, "register-builtins.mjs"), "utf8");

    // Entry points pull the providers in via the side-effect register module.
    expect(sessionStartSource).toContain("register-builtins.mjs");
    expect(preToolSource).toContain("register-builtins.mjs");
    // register-builtins must register the commit checkpoint provider so
    // both SessionStart and PreToolUse handlers fire.
    expect(registerSource).toContain("commitCheckpointProvider");
    expect(registerSource).toContain("registerProvider(commitCheckpointProvider)");
  });

  it("prints a resume recovery checklist for resume sessions", () => {
    const result = runHook(
      "session-start.mjs",
      "codex",
      {},
      { LATTICE_PROVIDER: "none", LATTICE_SESSION_KIND: "resume" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("RESUME RECOVERY CHECKLIST");
    expect(result.stderr).toContain("Read the newest user message first");
  });
});

const expectedLaunchers = [
  { client: "copilot", script: "start-http-ide.sh", port: 9121, context: "ide" },
  { client: "claude", script: "start-http-claude-code.sh", port: 9122, context: "claude-code" },
  { client: "codex", script: "start-http-codex.sh", port: 9123, context: "codex" },
] as const;

describe("Serena provider contracts", () => {
  it.each(expectedLaunchers)(
    "launcher script exists for $client ($script)",
    ({ script }) => {
      const launcherPath = resolve(packageRoot, "serena", script);
      expect(existsSync(launcherPath)).toBe(true);
    },
  );

  it("session-start delegates to the v1 dispatcher with built-in providers", () => {
    const sessionStartSource = readFileSync(
      resolve(packageRoot, "session-start.mjs"),
      "utf8",
    );
    const registerSource = readFileSync(
      resolve(packageRoot, "register-builtins.mjs"),
      "utf8",
    );
    const serenaProviderSource = readFileSync(
      resolve(packageRoot, "serena/provider.mjs"),
      "utf8",
    );
    const sembleProviderSource = readFileSync(
      resolve(packageRoot, "semble/provider.mjs"),
      "utf8",
    );
    const rtkProviderSource = readFileSync(
      resolve(packageRoot, "rtk/provider.mjs"),
      "utf8",
    );

    // Entry point uses dispatch + register-builtins; legacy
    // bootstrapProviders / LATTICE_REQUIRE_*_MCP env handling have moved
    // into the provider definitions.
    expect(sessionStartSource).toContain("dispatch(EVENT_NAMES.SessionStart");
    expect(sessionStartSource).toContain("register-builtins.mjs");
    expect(registerSource).toContain("registerProvider(serenaProvider)");
    expect(registerSource).toContain("registerProvider(sembleProvider)");
    expect(registerSource).toContain("registerProvider(rtkProvider)");
    expect(serenaProviderSource).toContain("LATTICE_REQUIRE_SERENA_MCP");
    expect(sembleProviderSource).toContain("LATTICE_REQUIRE_SEMBLE_MCP");
    expect(rtkProviderSource).toContain("LATTICE_REQUIRE_RTK");
  });

  it("provider-registry.mjs wires Serena as the default provider", () => {
    const source = readFileSync(resolve(packageRoot, "provider-registry.mjs"), "utf8");
    expect(source).toContain("LATTICE_PROVIDER");
    expect(source).toContain("LATTICE_PROVIDERS");
    expect(source).toContain("./serena/bootstrap.mjs");
    expect(source).toContain("bootstrapSerena");
  });

  it("serena/bootstrap.mjs maps every client to dashboard-state launchers", () => {
    const bootstrapSource = readFileSync(resolve(packageRoot, "serena/bootstrap.mjs"), "utf8");
    const stateSource = readFileSync(resolve(packageRoot, "serena/dashboard-state.mjs"), "utf8");
    expect(bootstrapSource).toContain("getClientPaths");
    expect(bootstrapSource).toContain("dashboard-state.mjs");
    for (const { client } of expectedLaunchers) {
      expect(stateSource).toContain(client);
    }
  });

  it.each(expectedLaunchers)(
    "launcher script $script delegates to the shared Serena helper",
    ({ script, client }) => {
      const source = readFileSync(resolve(packageRoot, "serena", script), "utf8");
      expect(source).toContain("exec node");
      expect(source).toContain("start-http.mjs");
      expect(source).toContain(client);
    },
  );

  it("shared Serena helper launches the official HTTP server command in detached mode", () => {
    const source = readFileSync(resolve(packageRoot, "serena/start-http.mjs"), "utf8");

    expect(source).toContain("uvx");
    expect(source).toContain("git+https://github.com/oraios/serena");
    expect(source).toContain("start-mcp-server");
    expect(source).toContain("--transport");
    expect(source).toContain("streamable-http");
    expect(source).toContain("--host");
    expect(source).toContain("127.0.0.1");
    expect(source).toContain("--open-web-dashboard");
    expect(source).toContain("detached: true");
    expect(source).toContain("getClientPaths");
  });

  it.each(expectedLaunchers)(
    "dashboard state maps $client to the expected port and context",
    ({ port, context }) => {
      const source = readFileSync(resolve(packageRoot, "serena/dashboard-state.mjs"), "utf8");

      expect(source).toContain(`port: ${port}`);
      expect(source).toContain(`context: \"${context}\"`);
      expect(source).toContain("getStateNamespace");
      expect(source).not.toContain("example-consumer");
    },
  );

  it("dashboard helper imports the shared dashboard-state module", () => {
    const source = readFileSync(resolve(packageRoot, "serena/open-dashboard.mjs"), "utf8");
    expect(source).toContain("dashboard-state.mjs");
    expect(source).toContain("getDashboardOpenPlan");
    expect(source).toContain("pickMostRecentActiveClient");
    expect(source).toContain("openExternalUrl");
    expect(source).toContain("--browser");
  });
});

describe("Semble MCP startup guard", () => {
  function createTempRoot() {
    const root = mkdtempSync(join(tmpdir(), "lattice-semble-mcp-"));
    mkdirSync(join(root, ".codex"), { recursive: true });
    return root;
  }

  function sembleArgs() {
    return ["--from", "semble[mcp]", "semble"];
  }

  it("accepts Claude stdio Semble config", () => {
    const root = createTempRoot();
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          semble: {
            command: "uvx",
            args: sembleArgs(),
          },
        },
      }),
      "utf8",
    );

    expect(validateRequiredSembleMcpConfig("claude", { root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it("accepts project-local Semble wrapper config", () => {
    const root = createTempRoot();
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts", "semble-mcp.mjs"), "", "utf8");
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          semble: {
            command: "node",
            args: ["scripts/semble-mcp.mjs"],
          },
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(root, ".codex", "config.toml"),
      [
        "[mcp_servers.semble]",
        'command = "node"',
        'args = ["scripts/semble-mcp.mjs"]',
        "",
      ].join("\n"),
      "utf8",
    );

    expect(validateRequiredSembleMcpConfig("claude", { root })).toEqual({
      ok: true,
      failures: [],
    });
    expect(validateRequiredSembleMcpConfig("codex", { root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it("rejects Claude HTTP Semble config because tools may attach too late", () => {
    const root = createTempRoot();
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          semble: {
            type: "http",
            url: "http://127.0.0.1:9124/mcp",
          },
        },
      }),
      "utf8",
    );

    const result = validateRequiredSembleMcpConfig("claude", { root });
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("must use stdio command/args");
  });

  it("accepts Codex stdio Semble config", () => {
    const root = createTempRoot();
    writeFileSync(
      join(root, ".codex", "config.toml"),
      [
        "[mcp_servers.semble]",
        'command = "uvx"',
        `args = ${JSON.stringify(sembleArgs())}`,
        "",
      ].join("\n"),
      "utf8",
    );

    expect(validateRequiredSembleMcpConfig("codex", { root })).toEqual({
      ok: true,
      failures: [],
    });
  });
});

describe("Serena MCP startup guard", () => {
  function createTempRoot() {
    const root = mkdtempSync(join(tmpdir(), "lattice-serena-mcp-"));
    mkdirSync(join(root, ".codex"), { recursive: true });
    return root;
  }

  function serenaArgs(context: string, root: string) {
    return [
      "--from",
      "git+https://github.com/oraios/serena",
      "serena",
      "start-mcp-server",
      "--context",
      context,
      "--project",
      root,
    ];
  }

  it("accepts Claude stdio Serena config with the project preselected", () => {
    const root = createTempRoot();
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          serena: {
            command: "uvx",
            args: serenaArgs("claude-code", root),
          },
        },
      }),
      "utf8",
    );

    expect(validateRequiredSerenaMcpConfig("claude", { root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it("accepts project-local Serena wrapper config", () => {
    const root = createTempRoot();
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts", "serena-mcp.mjs"), "", "utf8");
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          serena: {
            command: "node",
            args: ["scripts/serena-mcp.mjs", "claude"],
          },
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(root, ".codex", "config.toml"),
      [
        "[mcp_servers.serena]",
        'command = "node"',
        'args = ["scripts/serena-mcp.mjs", "codex"]',
        "",
      ].join("\n"),
      "utf8",
    );

    expect(validateRequiredSerenaMcpConfig("claude", { root })).toEqual({
      ok: true,
      failures: [],
    });
    expect(validateRequiredSerenaMcpConfig("codex", { root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it("rejects Claude HTTP Serena config because tools may attach too late", () => {
    const root = createTempRoot();
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          serena: {
            type: "http",
            url: "http://127.0.0.1:9122/mcp",
          },
        },
      }),
      "utf8",
    );

    const result = validateRequiredSerenaMcpConfig("claude", { root });
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("must use stdio command/args");
  });

  it("accepts Codex stdio Serena config with the project preselected", () => {
    const root = createTempRoot();
    writeFileSync(
      join(root, ".codex", "config.toml"),
      [
        "[mcp_servers.serena]",
        'command = "uvx"',
        `args = ${JSON.stringify(serenaArgs("codex", root))}`,
        "",
      ].join("\n"),
      "utf8",
    );

    expect(validateRequiredSerenaMcpConfig("codex", { root })).toEqual({
      ok: true,
      failures: [],
    });
  });
});
