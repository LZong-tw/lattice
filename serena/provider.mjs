#!/usr/bin/env node
/**
 * serena/provider.mjs — Serena declared as a v1-contract lattice provider.
 *
 * Wraps the existing `bootstrapSerena` and `validateRequiredSerenaMcpConfig`
 * surfaces (both kept unchanged for backwards compat) behind the v1 provider
 * shape consumed by the dispatcher.
 *
 * Pure dynamic imports inside the functions so this module stays import-cheap;
 * the MCP config guard does fs IO and the bootstrap launcher shells out.
 *
 * Client-identifier mapping:
 *   - `bootstrapSerena` accepts both canonical (`claude-code`) and bare
 *     (`claude`) forms via `normalizeSerenaClient` in dashboard-state.mjs, so
 *     we forward `ctx.client` directly.
 *   - `validateRequiredSerenaMcpConfig` keys off `EXPECTED_CONTEXT_BY_CLIENT`
 *     which only knows the bare forms (`claude`, `codex`). Canonical clients
 *     must be mapped down before the call, otherwise the guard silently
 *     returns `{ ok: true }` for unknown clients and the validation becomes
 *     a no-op. The mapping below mirrors session-start.mjs's historical
 *     behavior of passing process.argv[2] (bare form) straight through.
 */

const CANONICAL_TO_BARE_CLIENT = Object.freeze({
  "claude-code": "claude",
  codex: "codex",
  "copilot-cli": "copilot",
});

function toBareClient(client) {
  if (typeof client !== "string") return client;
  return CANONICAL_TO_BARE_CLIENT[client] ?? client;
}

export const serenaProvider = Object.freeze({
  name: "serena",
  contractVersion: 1,

  async validate(ctx) {
    if (ctx?.env?.LATTICE_REQUIRE_SERENA_MCP !== "1") {
      return { ok: true };
    }

    const { validateRequiredSerenaMcpConfig } = await import("./mcp-config-guard.mjs");
    return validateRequiredSerenaMcpConfig(toBareClient(ctx.client));
  },

  handlers: Object.freeze({
    async SessionStart(ctx) {
      const { bootstrapSerena } = await import("./bootstrap.mjs");
      const exitCode = bootstrapSerena(ctx.client);
      return exitCode === 0 ? {} : { exitCode };
    },
  }),
});
