# Changelog

All notable changes to `@lzong.tw/lattice` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3] — 2026-05-29

### Fixed

- RTK native hooks now take priority over the Lattice `rtk` provider. The
  provider skips commands already prefixed with `rtk ...`, and on Claude Code it
  also skips when the global `rtk hook claude` PreToolUse hook is detected.
- Added `LATTICE_RTK_FORCE_PROVIDER=1` for the rare case where a repo
  intentionally wants the Lattice provider to run even when native RTK hook mode
  is present.

## [0.2.2] — 2026-05-29

### Added

- `lattice init --clients auto` now detects installed supported AI CLIs
  (Claude Code, Codex CLI, and GitHub Copilot CLI) and wires every detected
  client during `--write`.
- `doctor.mjs` reports non-blocking local CLI readiness for Claude Code, Codex,
  GitHub Copilot CLI, RTK, ripgrep, and uvx.
- RTK setup docs now include cross-OS ripgrep installation plus the `rtk init
  -g --show` native-hook status check, with guidance to avoid double command
  rewrites when native RTK hooks and the Lattice RTK provider are both present.

## [0.2.1] — 2026-05-26

### Fixed

- Serena cleanup now detects stale trees whose apparent `codex.exe` or
  `claude.exe` parent is still running but detached from its launcher chain,
  preventing orphaned `uvx` / `uv` / `serena` / WebView process trees from
  accumulating after the originating shell exits.
- Serena cleanup remains fail-open during `SessionStart`: cleanup errors are
  logged and do not block Serena bootstrap or LLM context recovery.

## [0.2.0] — 2026-05-23

### Added

- **Lessons provider** (`lessons/`): new built-in provider for managing
  the accumulating-prose-rules problem in long-lived repos. Three opt-in
  layers with progressively stronger enforcement:
  - **Stop hook** — terse warning when `CLAUDE.md` (or configured
    `rootDoc`) grows past `cap.lines` / `cap.bullets`. Zero-config
    default; always non-blocking.
  - **PostToolUse Edit/Write** — when a touched file falls into a
    configured `domains[]` entry, prints a one-line nudge naming the
    per-domain doc to read. No-op when `domains` is empty.
  - **PreToolUse `git commit` write-gate** — opt-in via
    `writeGate.enabled: true`. Blocks commits that touch `watchPaths`
    without also editing `requireDocsUpdate`, unless the commit
    message contains `bypassToken` (default `[no-decision]`).
- **CLI scanners** for ongoing maintenance:
  - `lessons/reorganize-audit.mjs` — finds root-doc lessons that match
    a configured domain and should move to a per-domain file.
  - `lessons/promote-audit.mjs` — scores lessons by promotability
    heuristics (imperative keywords, regex-able references, real
    incident citations) and suggests an enforcement layer for each.
    `--open-issues` opens GitHub tracking issues via `gh issue create`
    using `--body-file` + `execFileSync` argv (shell-injection safe).
- **Config schema** (`lessons/config.mjs`): resolved from
  `LATTICE_LESSONS_CONFIG` env, `.lattice/lessons.config.json`, or
  `lattice.config.json#lessons`. All fields optional; defaults are
  conservative (size-check only, no domains, write-gate disabled).
- **Type declarations** (`lattice.d.ts`): `LessonsConfig`,
  `LessonsDomain`, `lessonsProvider`, plus pure-fn signatures
  (`loadLessonsConfig`, `buildSizeCheckMessage`,
  `buildResurfaceMessage`, `evaluateWriteGate`) so consumers can
  compose the building blocks into their own husky / CI scripts.
- **Documentation**: new `docs/lessons.md` with rationale, config
  reference, recipes (husky pre-commit wiring, GitHub Actions
  push-trigger workflow, optional Stop-hook chain), and the
  shell-injection lesson behind the `--body-file` pattern.

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
- **Testing helpers** at `@lzong.tw/lattice/testing` (`testing.mjs`):
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

[0.2.3]: https://github.com/lzong-tw/lattice/releases/tag/v0.2.3
[0.2.2]: https://github.com/lzong-tw/lattice/releases/tag/v0.2.2
[0.2.1]: https://github.com/lzong-tw/lattice/releases/tag/v0.2.1
[0.2.0]: https://github.com/lzong-tw/lattice/releases/tag/v0.2.0
[0.1.0]: https://github.com/lzong-tw/lattice/releases/tag/v0.1.0
