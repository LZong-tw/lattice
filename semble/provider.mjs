#!/usr/bin/env node
/**
 * semble/provider.mjs — v1-contract Semble provider.
 *
 * Validator-only: Semble has no per-event work to do beyond enforcing that
 * the client's MCP config points at the Semble stdio server. The guard
 * itself lives in ./mcp-config-guard.mjs and is invoked lazily so the
 * provider module stays cheap to import.
 *
 * `supportedClients` encodes Semble's deliberate exclusion of Copilot —
 * the underlying guard accepts bare `claude` / `codex` only. The
 * dispatcher silently skips this provider for unsupported clients rather
 * than erroring, matching the v1 contract.
 *
 * Client identifier mapping: `ctx.client` is the canonical form
 * (`claude-code` / `codex` / `copilot-cli`) per the v1 contract, but the
 * pre-existing guard in `mcp-config-guard.mjs` was written against the
 * bare forms (`claude` / `codex`). We map at the call site so the guard
 * keeps its existing exports unchanged.
 */

const CANONICAL_TO_BARE_CLIENT = Object.freeze({
  "claude-code": "claude",
  codex: "codex",
});

export const sembleProvider = Object.freeze({
  name: "semble",
  contractVersion: 1,
  supportedClients: Object.freeze(["claude-code", "codex"]),
  async validate(ctx) {
    if (ctx.env.LATTICE_REQUIRE_SEMBLE_MCP !== "1") {
      return { ok: true };
    }

    const { validateRequiredSembleMcpConfig } = await import("./mcp-config-guard.mjs");
    const bareClient = CANONICAL_TO_BARE_CLIENT[ctx.client] ?? ctx.client;
    return validateRequiredSembleMcpConfig(bareClient);
  },
});
