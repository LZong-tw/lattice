#!/usr/bin/env node
/**
 * mcp/provider.mjs — fail-open cleanup for stale MCP helper processes.
 *
 * MCP servers launched by AI clients are often child processes of long-lived
 * Claude/Codex sessions. When those sessions or review helpers fail to unwind,
 * small stdio wrappers can hold large private commit via Python/Node children.
 */

export const mcpCleanupProvider = Object.freeze({
  name: "lattice/mcp-cleanup",
  contractVersion: 1,
  supportedClients: Object.freeze(["claude-code", "codex"]),

  handlers: Object.freeze({
    async SessionStart(ctx) {
      if (ctx?.env?.LATTICE_MCP_CLEANUP === "0") return {};

      try {
        const { cleanupMcpProcesses, cleanupOptionsFromEnv } = await import("./cleanup-processes.mjs");
        cleanupMcpProcesses({
          dryRun: ctx?.env?.LATTICE_MCP_CLEANUP_DRY_RUN === "1",
          options: cleanupOptionsFromEnv(ctx?.env),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx?.log?.(`MCP stale-process cleanup skipped: ${message}`);
      }

      return {};
    },
  }),
});
