import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { validateRequiredSerenaMcpConfig } from "../serena/mcp-config-guard.mjs";
import { validateRequiredSembleMcpConfig } from "../semble/mcp-config-guard.mjs";

const packageRoot = process.cwd();
const node = process.execPath;

function runHook(scriptName: string, client: string, payload: Record<string, unknown>) {
  const result = spawnSync(node, [resolve(packageRoot, scriptName), client], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: packageRoot,
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
    sessionStart: 'node "$(git rev-parse --show-toplevel)/hooks/session-start.mjs" codex',
    preToolUse: 'node "$(git rev-parse --show-toplevel)/hooks/pre-tool-policy.mjs" codex',
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

    expect(consumerConfigFixtures.codex.sessionStart).toContain("hooks/session-start.mjs");
    expect(consumerConfigFixtures.codex.preToolUse).toContain("hooks/pre-tool-policy.mjs");
  });
});

describe("hook entry-point behavior", () => {
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

  it("wires the commit checkpoint reminder through the shared entry points", () => {
    const sessionStartSource = readFileSync(resolve(packageRoot, "session-start.mjs"), "utf8");
    const preToolSource = readFileSync(resolve(packageRoot, "pre-tool-policy.mjs"), "utf8");

    expect(sessionStartSource).toContain("commit-checkpoint.mjs");
    expect(sessionStartSource).toContain("maybePrintCommitCheckpointReminder");
    expect(preToolSource).toContain("commit-checkpoint.mjs");
    expect(preToolSource).toContain("maybePrintCommitCheckpointReminder");
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

  it("session-start delegates provider bootstrap to provider-registry.mjs", () => {
    const source = readFileSync(resolve(packageRoot, "session-start.mjs"), "utf8");
    expect(source).toContain("./provider-registry.mjs");
    expect(source).toContain("bootstrapProviders");
    expect(source).toContain("LATTICE_REQUIRE_SERENA_MCP");
    expect(source).toContain("LATTICE_REQUIRE_SEMBLE_MCP");
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
