# Changelog

All notable changes to `@lattice/core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-21

First public release.

### Added

- **v1 dispatcher contract** (`dispatcher.mjs`): event fan-out across every
  registered provider with deterministic result merging (deny precedence,
  bulleted reasons, additionalContext concat, hookSpecificOutput shallow
  merge with sticky `decision: "block"`, `exitCode` max, first-error-wins).
  Covers `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`, `PostCompact`,
  `Notification`.
- **Per-event timeouts** (`timeouts.mjs`) driving every handler's
  `ctx.signal`, with `LATTICE_TIMEOUT_*` overrides.
- **SessionStart validators**: SessionStart-only gate that aggregates
  failures across providers and exits 1 with a stderr report when any
  provider returns `{ ok: false }`.
- **Provider registry** (`provider-registry.mjs`): `registerProvider()`
  with `contractVersion: 1` fail-fast, `LATTICE_PROVIDERS` /
  `LATTICE_PROVIDER` / `LATTICE_DISABLE` selection rules, legacy
  `bootstrapProviders` path retained as `@deprecated` for backwards
  compatibility.
- **Built-in providers** (`builtins/`): `lattice/protection` (env/lockfile/
  `.git/` edit guard + commit-bash deny), `lattice/commit-checkpoint`
  (dirty-tree nag), `lattice/screenshot-reminder`,
  `lattice/edit-reminder`, `lattice/stop-checklist` (with optional
  `LATTICE_VERIFY_ON_STOP=1` verification gate).
- **Serena provider** (`serena/`): MCP server lifecycle, dashboard helpers,
  and SessionStart MCP-config validator (`LATTICE_REQUIRE_SERENA_MCP=1`).
- **Semble provider** (`semble/`): SessionStart MCP-config validator
  (`LATTICE_REQUIRE_SEMBLE_MCP=1`). Skipped on `copilot-cli`.
- **Codex hook runner** (`codex-hook-runner.mjs`): driven by
  `LATTICE_HOOK_TARGET` / `LATTICE_HOOK_CLIENT`, resolves the mounted
  `hooks/` directory from the Codex payload `cwd`.
- **Testing helpers** at `@lattice/core/testing` (`testing.mjs`):
  `runProvider()`, `mockContext()`, `mockPayload.<event>()` for isolated
  provider tests with auto-managed temp `stateDir`.
- **TypeScript declarations** (`lattice.d.ts`) covering `LatticeProvider`,
  `LatticeContext`, `LatticeHandlerResult`, event names, and helper APIs.
- **GitHub Actions CI** (`.github/workflows/test.yml`): matrix across
  `ubuntu-latest` / `macos-latest` / `windows-latest` × Node 18 / 20 / 22.
- **Documentation**: `docs/PROVIDER-AUTHORING.md` (v1 contract reference),
  `docs/PROVIDER-ROLLOUT.md` (release-lifecycle SOP),
  `docs/SERENA-CLIENT-SETUP.md` (per-client Serena wiring),
  `examples/clawback-adapter/` (reference external-provider shape).
- **OSS scaffolding**: `LICENSE` (MIT), `CODE_OF_CONDUCT.md` (Contributor
  Covenant 2.1), `SECURITY.md`, `CONTRIBUTING.md`.

### Fixed (Phase 5 review pass)

- Codex CLI config snippet in `README.md` now ships the real dispatcher
  one-liner instead of a literal `<repo-root dispatcher ...>` placeholder.
- Reserved env-var list in `docs/PROVIDER-AUTHORING.md` extended to cover
  every `LATTICE_*` variable read by core or built-in providers
  (`LATTICE_VERIFY_*`, `LATTICE_HOOK_*`, `LATTICE_REQUIRE_*_MCP`,
  `LATTICE_SESSION_KIND`).
- Documented the `LATTICE_VERIFY_*` naming carve-out (grandfathered
  pre-v1; new providers must follow `LATTICE_<PROVIDER>_<KEY>`).
- `docs/PROVIDER-ROLLOUT.md` slimmed to the release lifecycle; the v1
  provider API now lives exclusively in `docs/PROVIDER-AUTHORING.md`.
- README `Layout` table now lists every v1 surface (`dispatcher.mjs`,
  `context.mjs`, `client-enum.mjs`, `timeouts.mjs`, `testing.mjs`,
  `register-builtins.mjs`, `builtins/`, `lattice.d.ts`, `index.mjs`,
  `examples/`).
- README Provider Integration section corrected: dispatcher default
  activates every registered provider; legacy `bootstrapProviders`
  default of `["serena"]` is now flagged as deprecated.

See `reports/lattice-review-synthesis-2026-05-21.md` for the full review
synthesis that drove this pass.

[0.1.0]: https://github.com/lzong-tw/lattice/releases/tag/v0.1.0
