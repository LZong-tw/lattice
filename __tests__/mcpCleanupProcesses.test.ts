import { describe, expect, it } from "vitest";

import {
  cleanupOptionsFromEnv,
  collectMcpCleanupTargets,
} from "../mcp/cleanup-processes.mjs";

const mb = (value: number) => value * 1024 * 1024;
const hoursAgo = (value: number) => new Date(Date.now() - value * 36e5).toISOString();

describe("cleanupOptionsFromEnv", () => {
  it("reads MCP cleanup knobs from the provided env snapshot", () => {
    const options = cleanupOptionsFromEnv({
      LATTICE_MCP_CLEANUP_CPU_SAMPLE_MS: "0",
      LATTICE_MCP_CLEANUP_HIGH_PRIVATE_MB: "768",
      LATTICE_MCP_CLEANUP_PLAYWRIGHT_GRACE_HOURS: "8",
      LATTICE_MCP_CLEANUP_RUNAWAY_CLAUDE_SEARCH_GRACE_MINUTES: "20",
      LATTICE_MCP_CLEANUP_SEMBLE_GRACE_HOURS: "2",
    });

    expect(options).toMatchObject({
      cpuSampleMs: 0,
      highPrivateMb: 768,
      playwrightGraceHours: 8,
      runawayClaudeSearchGraceMinutes: 20,
      sembleGraceHours: 2,
    });
  });
});

describe("collectMcpCleanupTargets", () => {
  it("targets old idle Semble MCP process trees with high private commit", () => {
    const targets = collectMcpCleanupTargets(
      [
        { id: 10, parentId: 1, name: "claude", startTime: hoursAgo(6) },
        {
          id: 11,
          parentId: 10,
          name: "uvx",
          commandLine: "uvx --from semble[mcp] semble",
          startTime: hoursAgo(5),
          cpuDeltaSeconds: 0,
          privateBytes: mb(1),
          workingSet: mb(1),
        },
        {
          id: 12,
          parentId: 11,
          name: "uv",
          commandLine: "uv tool uvx --from semble[mcp] semble",
          startTime: hoursAgo(5),
          cpuDeltaSeconds: 0,
          privateBytes: mb(130),
          workingSet: mb(2),
        },
        {
          id: 13,
          parentId: 12,
          name: "python",
          commandLine: "C:\\Users\\LZong\\AppData\\Local\\uv\\cache\\archive-v0\\x\\Scripts\\semble.exe",
          startTime: hoursAgo(5),
          cpuDeltaSeconds: 0,
          privateBytes: mb(620),
          workingSet: mb(4),
        },
      ],
      cleanupOptionsFromEnv({ LATTICE_MCP_CLEANUP_CPU_SAMPLE_MS: "0" }),
      42,
    );

    expect(targets).toEqual([
      expect.objectContaining({
        kind: "semble-mcp-tree",
        pid: 11,
      }),
    ]);
    expect(targets[0].reason).toContain("idle-leak-semble-mcp-tree");
  });

  it("keeps young Playwright MCP trees even when idle", () => {
    const targets = collectMcpCleanupTargets(
      [
        { id: 10, parentId: 1, name: "codex", startTime: hoursAgo(1) },
        {
          id: 11,
          parentId: 10,
          name: "cmd",
          commandLine: 'cmd.exe /d /s /c "npx ^"@playwright/mcp@latest^""',
          startTime: hoursAgo(0.2),
          cpuDeltaSeconds: 0,
          privateBytes: mb(6),
          workingSet: mb(3),
        },
        {
          id: 12,
          parentId: 11,
          name: "node",
          commandLine: '"C:\\nvm4w\\nodejs\\node.exe" "C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npx-cli.js" @playwright/mcp@latest',
          startTime: hoursAgo(0.2),
          cpuDeltaSeconds: 0,
          privateBytes: mb(180),
          workingSet: mb(2),
        },
      ],
      cleanupOptionsFromEnv({ LATTICE_MCP_CLEANUP_CPU_SAMPLE_MS: "0" }),
      42,
    );

    expect(targets).toEqual([]);
  });

  it("targets old idle Playwright MCP process trees", () => {
    const targets = collectMcpCleanupTargets(
      [
        { id: 10, parentId: 1, name: "codex", startTime: hoursAgo(10) },
        {
          id: 11,
          parentId: 10,
          name: "cmd",
          commandLine: 'cmd.exe /d /s /c "npx ^"@playwright/mcp@latest^""',
          startTime: hoursAgo(8),
          cpuDeltaSeconds: 0,
          privateBytes: mb(6),
          workingSet: mb(3),
        },
        {
          id: 12,
          parentId: 11,
          name: "node",
          commandLine: '"node" "C:\\Users\\LZong\\AppData\\Local\\npm-cache\\_npx\\x\\node_modules\\.bin\\..\\@playwright\\mcp\\cli.js"',
          startTime: hoursAgo(8),
          cpuDeltaSeconds: 0,
          privateBytes: mb(180),
          workingSet: mb(2),
        },
      ],
      cleanupOptionsFromEnv({ LATTICE_MCP_CLEANUP_CPU_SAMPLE_MS: "0" }),
      42,
    );

    expect(targets).toEqual([
      expect.objectContaining({
        kind: "playwright-mcp-tree",
        pid: 11,
      }),
    ]);
  });

  it("keeps active Playwright MCP process trees", () => {
    const targets = collectMcpCleanupTargets(
      [
        { id: 10, parentId: 1, name: "codex", startTime: hoursAgo(10) },
        {
          id: 11,
          parentId: 10,
          name: "cmd",
          commandLine: 'cmd.exe /d /s /c "npx ^"@playwright/mcp@latest^""',
          startTime: hoursAgo(8),
          cpuDeltaSeconds: 8,
          privateBytes: mb(6),
          workingSet: mb(3),
        },
        {
          id: 12,
          parentId: 11,
          name: "node",
          commandLine: '"node" "@playwright/mcp"',
          startTime: hoursAgo(8),
          cpuDeltaSeconds: 8,
          privateBytes: mb(180),
          workingSet: mb(2),
        },
      ],
      cleanupOptionsFromEnv({ LATTICE_MCP_CLEANUP_CPU_SAMPLE_MS: "0" }),
      42,
    );

    expect(targets).toEqual([]);
  });

  it("targets active recursive Claude searches superseded by a newer child task", () => {
    const targets = collectMcpCleanupTargets(
      [
        { id: 10, parentId: 1, name: "claude.exe.old.1", startTime: hoursAgo(6) },
        {
          id: 11,
          parentId: 10,
          name: "pwsh",
          commandLine:
            "Get-ChildItem -Recurse -File -Path scripts,.claude -Include *.mjs,*.js | Select-String -Pattern gate",
          startTime: hoursAgo(2),
          cpuDeltaSeconds: 0.8,
          privateBytes: mb(90),
          workingSet: mb(70),
        },
        {
          id: 12,
          parentId: 10,
          name: "pwsh",
          commandLine: "codex exec --dangerously-bypass-approvals-and-sandbox",
          startTime: hoursAgo(0.1),
          cpuDeltaSeconds: 0,
          privateBytes: mb(90),
          workingSet: mb(70),
        },
      ],
      cleanupOptionsFromEnv({ LATTICE_MCP_CLEANUP_CPU_SAMPLE_MS: "0" }),
      42,
    );

    expect(targets).toEqual([
      expect.objectContaining({
        kind: "runaway-claude-search-tree",
        pid: 11,
        reason: "superseded-active-claude-recursive-search",
      }),
    ]);
  });

  it("keeps an active recursive Claude search without a newer sibling task", () => {
    const targets = collectMcpCleanupTargets(
      [
        { id: 10, parentId: 1, name: "claude", startTime: hoursAgo(6) },
        {
          id: 11,
          parentId: 10,
          name: "pwsh",
          commandLine:
            "Get-ChildItem -Recurse -File -Path scripts,.claude -Include *.mjs,*.js | Select-String -Pattern gate",
          startTime: hoursAgo(2),
          cpuDeltaSeconds: 0.8,
          privateBytes: mb(90),
          workingSet: mb(70),
        },
      ],
      cleanupOptionsFromEnv({ LATTICE_MCP_CLEANUP_CPU_SAMPLE_MS: "0" }),
      42,
    );

    expect(targets).toEqual([]);
  });
});
