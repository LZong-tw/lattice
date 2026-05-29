# lattice

[![CI](https://github.com/lzong-tw/lattice/actions/workflows/test.yml/badge.svg)](https://github.com/lzong-tw/lattice/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](#prerequisites)

`lattice` is a repo-scoped AI client runtime layer: shared hook entry points,
policy gates, lifecycle reminders, and provider integrations for
**Claude Code**, **GitHub Copilot CLI**, and **Codex CLI**.

This is the **public OSS core**. It contains the v1 dispatcher contract, the
built-in providers (`builtins/`, `serena/`, `semble/`, `rtk/`), and the
install planner (`init.mjs`). Organization-specific providers live out of
tree and are loaded at runtime via `LATTICE_EXTRA_PROVIDERS` — keep this
repo focused on the shared runtime and ship private logic as separate
packages or a private overlay repo.

This repo is designed to be mounted into a consuming repo at the stable path
`hooks/`. Each hook entry point is a thin shim around the v1 dispatcher that
fans the event out to every registered provider, then merges their results
into the Anthropic-spec response shape.

## Recommended setup

For day-to-day use, pair lattice with **clawback**. lattice gives you the
hook runtime and policy gates; clawback gives you the verification loop
(file protection, post-edit format/lint, stop-time typecheck) that turns
those gates into a working guardrail.

- [`@lattice/clawback`](https://github.com/lzong-tw/clawback) — the
  canonical verification provider for lattice. Install it as a v1 lattice
  provider and register it through `LATTICE_EXTRA_PROVIDERS`. See
  `examples/clawback-adapter/` for the integration shape.

Other providers (Serena MCP, Semble MCP, RTK command rewrite) ship in-tree
and are opt-in through the install planner's `--providers` flag.

When a repo keeps existing clawback/project hooks beside lattice, do not use
shell env-prefix commands such as `LATTICE_DISABLE=... node ...` on Windows.
Use `hook-runner.mjs --env KEY=VALUE` so the same config works in PowerShell,
cmd.exe, Bash, Claude Code, and Codex.

---

## Agent Start Here

This section is the install contract for LLM agents and humans. If you are
installing lattice into another repo, follow the phases in order and stop only
after [One-Screen Done Check](#one-screen-done-check) passes.

If you are editing lattice itself, skip to [Developer Setup](#developer-setup-editing-lattice-itself).

### Quick install (any OS, recommended)

Run from the consumer repo root. Works the same on macOS, Linux, and Windows
(cmd.exe or PowerShell):

```
pnpm add @lzong.tw/lattice
npx @lzong.tw/lattice init --write --mount copy --clients auto
```

That single `init --write` call mounts lattice at `hooks/`, writes the client
config files (`.claude/settings.json`, `.codex/config.toml`,
`.codex/hooks.json`, optional Copilot config), and emits a managed `AGENTS.md`
block. With `--clients auto`, it detects installed supported CLIs (Claude Code,
Codex CLI, and GitHub Copilot CLI) and wires every one it finds. It is
idempotent — rerun any time to refresh.

To preview without writing, drop `--write` (read-only plan output).

Continue to [Phase 5 — Add Optional Providers](#phase-5--add-optional-providers)
if you want Serena, Semble, or RTK; otherwise skip to
[Phase 6 — Smoke Test](#phase-6--smoke-test-before-commit).

### Phased manual contract

The phases below are the same install contract laid out step-by-step, for LLM
agents who follow it sequentially and for submodule users who need finer
control. All commands run from the consumer repo root.

### Phase 0 — Declare Inputs

For the submodule mount path, have the lattice repo URL on hand
(`https://github.com/lzong-tw/lattice` for the OSS core).

### Phase 1 — Check Prerequisites

```
node --version
# => v20.x.x or higher

git --version
# => git version 2.x.x or higher
```

Optional providers need extra CLIs:

```
uvx --version
# => required only for Serena/Semble MCP startup commands

rtk --version
rg --version
# => required only for RTK command rewrite / when LATTICE_REQUIRE_RTK=1
```

### Phase 2 — Mount lattice at `hooks/`

Choose exactly one mount strategy. Do not use both in the same consumer repo.

**Option A: git submodule (recommended for shared project repos)**

```
git submodule add https://github.com/lzong-tw/lattice hooks
git submodule update --init --recursive
```

**Option B: npm package copy (recommended for individual projects)**

```
pnpm add @lzong.tw/lattice
npx @lzong.tw/lattice init --write --mount copy --clients auto
```

The `init --write --mount copy` step copies `node_modules/@lzong.tw/lattice`
into `hooks/` using `node:fs` (no shell), so it works the same on every OS.

The consumer path must be exactly `hooks/`. Client configs below depend on
that stable path.

### Phase 3 — Verify the Mount

```
node --check hooks/common.mjs
node --check hooks/session-start.mjs
node --check hooks/hook-runner.mjs
node --check hooks/codex-hook-runner.mjs
node --check hooks/pre-tool-policy.mjs
# => each command exits 0
```

If any command fails, re-run Phase 2 before editing client config.

### Phase 4 — Wire the AI Client

Pick every client that must work in this consumer repo.

Shortcut for local machines:

```
node hooks/init.mjs --write --clients auto
```

That probes the installed supported CLIs and wires all detected clients. Use an
explicit list such as `--clients claude-code,codex` when preparing config for a
team repo that must support clients not installed on the current machine.

| Client | Required files to create or update | Exact config section |
|--------|------------------------------------|----------------------|
| Claude Code | `.claude/settings.json` | [Claude Code Config](#claude-code-config) |
| Codex CLI | `.codex/config.toml` and `.codex/hooks.json` | [Codex CLI Config](#codex-cli-config) |
| GitHub Copilot CLI | `.github/hooks/repo-guardrails.json` | [GitHub Copilot CLI Config](#github-copilot-cli-config) |

Do not invent hook paths. Use the commands exactly as shown in the matching
section. In particular, Codex must use `hooks/codex-hook-runner.mjs`; do not
use `$(git rev-parse --show-toplevel)` inside Codex hook commands.

### Phase 5 — Add Optional Providers

Only enable required providers. The hook layer works without them.

| Provider | When to enable | Required setup |
|----------|----------------|----------------|
| Serena | You want startup-time Serena MCP lifecycle and dashboard checks | Follow [docs/SERENA-CLIENT-SETUP.md](docs/SERENA-CLIENT-SETUP.md), then set `LATTICE_REQUIRE_SERENA_MCP=1` only after a stable loopback HTTP singleton exists. Legacy stdio configs still validate during migration. |
| Semble | You want code-search MCP available at startup | Add a stdio `semble` MCP entry to Claude/Codex config, then set `LATTICE_REQUIRE_SEMBLE_MCP=1` only after config exists. |
| RTK | You want Bash command output rewritten through `rtk rewrite` | Install `rtk` and `rg`; run `rtk init -g --show` to inspect native hook status; leave fail-open by default, or set `LATTICE_REQUIRE_RTK=1` only when missing RTK should block startup. |

Reference docs:

- [docs/SERENA-CLIENT-SETUP.md](docs/SERENA-CLIENT-SETUP.md) — Serena MCP for Claude Code and Codex.
- [docs/PROVIDER-ROLLOUT.md](docs/PROVIDER-ROLLOUT.md) — rollout order for provider changes.
- [docs/PROVIDER-AUTHORING.md](docs/PROVIDER-AUTHORING.md) — writing new lattice providers.

### Phase 6 — Smoke Test Before Commit

Run the shared smoke tests via the bundled helper. It works on macOS, Linux,
cmd.exe, and PowerShell because the assertions live in `node`, not the shell:

```
node hooks/verification/smoke-plan.mjs session-start claude-code
node hooks/verification/smoke-plan.mjs session-start codex
node hooks/verification/smoke-plan.mjs post-compact claude-code
node hooks/verification/smoke-plan.mjs pre-tool-deny claude-code
node hooks/verification/smoke-plan.mjs pre-tool-deny codex
```

Each command exits 0 on success and prints a non-zero exit with the failing
assertion if a hook misfires.

For Copilot-only repos, run the same checks with `copilot-cli`.

### One-Screen Done Check

Consumer setup is complete only when all applicable checks pass:

```
node --check hooks/common.mjs
node --check hooks/session-start.mjs
node --check hooks/codex-hook-runner.mjs
node --check hooks/pre-tool-policy.mjs
node hooks/verification/smoke-plan.mjs session-start claude-code
node hooks/verification/smoke-plan.mjs session-start codex
node hooks/verification/smoke-plan.mjs post-compact claude-code
node hooks/verification/smoke-plan.mjs pre-tool-deny claude-code
node hooks/verification/smoke-plan.mjs pre-tool-deny codex
```

Then confirm each client-specific file exists. Cross-platform existence check:

```
node -e "require('node:fs').accessSync('.claude/settings.json')"        # if using Claude Code
node -e "require('node:fs').accessSync('.codex/config.toml')"           # if using Codex
node -e "require('node:fs').accessSync('.codex/hooks.json')"            # if using Codex
node -e "require('node:fs').accessSync('.github/hooks/repo-guardrails.json')"  # if using Copilot CLI
```

Optional provider done checks:

```
node -e "require('node:http').get('http://127.0.0.1:9121/mcp',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"  # if Serena is required (substitute your port)
node -e "const c=require('node:fs').readFileSync('.mcp.json','utf8')+require('node:fs').readFileSync('.codex/config.toml','utf8');process.exit(/\bsemble\b/.test(c)?0:1)"  # if Semble is required
rtk --version  # if LATTICE_REQUIRE_RTK=1
```

### LLM Operating Rules

- Follow this README in order. Do not skip ahead to provider setup before the
  shared `hooks/` smoke tests pass.
- Treat `hooks/` as a hard compatibility contract. All consumer config snippets
  are written against that path.
- Prefer project-scoped config files over global config so everyone in the
  project gets the same behavior.
- For Codex, use `[features].hooks = true`. Do not use deprecated
  `[features].codex_hooks`.
- If a `PreToolUse` hook exits 1, reproduce it with the exact smoke command
  above and isolate the shared layer with `LATTICE_PROVIDER=none`.
- If a `PostCompact` hook is added by a provider, it must write valid JSON to
  stdout and must not inject context. Output `{}`; use `SessionStart` with the
  `compact` matcher for post-compaction context re-injection.
- Do not set `LATTICE_REQUIRE_SERENA_MCP`, `LATTICE_REQUIRE_SEMBLE_MCP`, or
  `LATTICE_REQUIRE_RTK` until the corresponding client/provider config has been
  installed and smoke-tested.

---

## Install

For consumer repos, use [Agent Start Here](#agent-start-here). The rest of this
README is reference material and exact client config.

---

## Prerequisites

Run each command and verify the expected output before proceeding.

```bash
node --version
# => v20.x.x or higher (minimum: Node 20)

git --version
# => git version 2.x.x (any recent version)

pnpm --version
# => 9.x.x or higher (used inside lattice for tests; not required in consumer repos)
```

**Optional — only if you want Serena provider integration or Semble MCP search:**

```bash
python3 --version
# => Python 3.10.x or higher

uvx --version
# => uv-pip x.x.x (from https://github.com/astral-sh/uv)
```

If any prerequisite is missing, install it before continuing:
- Node.js: <https://nodejs.org/> or `brew install node`
- pnpm: `corepack enable && corepack prepare pnpm@latest --activate`
- uv (provides `uvx`): `curl -LsSf https://astral.sh/uv/install.sh | sh`

---

## Decision Tree — Choose Your Setup Path

```
START
 │
 ├─ Are you CONSUMING lattice in another repo?
 │   │
 │   YES → Go to "Consumer Setup" below
 │   │       │
 │   │       ├─ Which AI client?
 │   │       │   ├─ Claude Code  → "Claude Code Config"
 │   │       │   ├─ Copilot CLI  → "GitHub Copilot CLI Config"
 │   │       │   └─ Codex CLI    → "Codex CLI Config"
 │   │       │
 │   │       └─ Want provider/search MCP integration?
 │   │           ├─ Serena → also follow docs/SERENA-CLIENT-SETUP.md
 │   │           ├─ Semble → configure startup stdio MCP in the consumer repo
 │   │           └─ NO     → shared hooks work standalone, you are done
 │   │
 │   NO → Are you EDITING lattice itself?
 │         │
 │         YES → Go to "Developer Setup" below
 │
 └─ END
```

---

## Layout

| Layer | Location | Purpose |
|-------|----------|---------|
| Public barrel | `index.mjs` | Root `@lzong.tw/lattice` export — re-exports the user-facing surface (`registerProvider`, `dispatch`, constants, types). |
| TypeScript contract | `lattice.d.ts` | Public type definitions for `LatticeProvider`, `LatticeContext`, `LatticeHandlerResult`, and helpers. |
| Dispatcher | `dispatcher.mjs` | v1 event dispatcher — fans events to every registered provider and merges results into Anthropic response shape. |
| Context | `context.mjs` | Builds the frozen `LatticeContext` (cwd, repoRoot, stateDir, env snapshot, signal) per dispatch. |
| Client enum | `client-enum.mjs` | `normalizeClient()` canonicalization (`claude` → `claude-code`, etc.). |
| Timeouts | `timeouts.mjs` | Per-event timeout defaults + `LATTICE_TIMEOUT_*` overrides driving `ctx.signal`. |
| Provider registry | `provider-registry.mjs` | `registerProvider`, selection rules, legacy `bootstrapProviders` (deprecated). |
| Built-in registration | `register-builtins.mjs` | Self-registers built-in providers; also loads `LATTICE_EXTRA_PROVIDERS=<spec>` packages. |
| Built-in providers | `builtins/` | `protection`, `commit-checkpoint`, `screenshot-reminder`, `edit-reminder`, `stop-checklist` v1 providers. |
| Shared runtime | `*.mjs` (root) | Client-agnostic hook entry points and policy logic (`session-start.mjs`, `pre-tool-policy.mjs`, `stop-checklist.mjs`, etc.). |
| Hook runner | `hook-runner.mjs` | Shell-neutral wrapper that forwards stdin to a hook target and applies `--env KEY=VALUE` assignments without POSIX env-prefix syntax. |
| Codex runner | `codex-hook-runner.mjs` | Forwards Codex hook payloads to the right entry script (driven by argv, with legacy `LATTICE_HOOK_TARGET` / `LATTICE_HOOK_CLIENT` env fallback). |
| Testing helpers | `testing.mjs` | `mockContext`, `runProvider`, `mockPayload` — published as `@lzong.tw/lattice/testing`. |
| MCP config helpers | `mcp-config-common.mjs` | Shared JSON/TOML parser utilities for startup MCP guards. |
| File protection | `protection.mjs` | Edit guard for env files, `.git/`, and detected lockfiles. |
| Verification profile | `verification/` | Stack-aware typecheck/lint detection and optional Stop gate. |
| Serena provider | `serena/` | Serena-specific lifecycle, launcher, dashboard helpers, and v1 provider definition. |
| Serena cleanup | `serena/cleanup-processes.mjs` | SessionStart stale-process cleanup for orphaned or idle Serena/WebView process trees. |
| Serena MCP guard | `serena/mcp-config-guard.mjs` | Optional SessionStart guard for repos that require startup-time Serena MCP through a stable loopback HTTP singleton. Legacy stdio configs still validate during migration. |
| Semble provider | `semble/provider.mjs` | Semble v1 provider definition. |
| Semble MCP guard | `semble/mcp-config-guard.mjs` | Optional SessionStart guard for repos that require startup-time Semble stdio MCP. |
| RTK provider | `rtk/provider.mjs` | Optional PreToolUse command rewrite through `rtk rewrite` for token-compacted shell output. |
| Examples | `examples/` | Reference adapters (e.g. `clawback-adapter/`) showing how external providers map onto the v1 contract. |
| Tests | `__tests__/` | Package-level runtime and provider contracts. |
| Docs | `docs/` | Provider details, rollout flow, and consumer guidance. |

## Consumer Path Contract

Inside this repo, scripts live at the package root:

- `session-start.mjs`
- `codex-hook-runner.mjs`
- `pre-tool-policy.mjs`
- `protection.mjs`
- `commit-checkpoint.mjs`
- `post-tool-reminder.mjs`
- `stop-checklist.mjs`
- `verification/detect-stack.mjs`
- `verification/verify.mjs`
- `mcp-config-common.mjs`
- `serena/bootstrap.mjs`
- `serena/cleanup-processes.mjs`
- `serena/mcp-config-guard.mjs`
- `semble/mcp-config-guard.mjs`
- `rtk/provider.mjs`

When mounted inside a consumer repo at `hooks/`, clients execute those same
files through consumer-facing paths like:

- `hooks/session-start.mjs`
- `hooks/codex-hook-runner.mjs`
- `hooks/pre-tool-policy.mjs`
- `hooks/serena/open-dashboard.mjs`

**The `hooks/` mount path is the hard compatibility contract.** All client
config snippets below depend on it. Do not change it.

---

## Consumer Setup

### Step 1 — Mount lattice at `hooks/`

**Option A: Git submodule (recommended)**

```bash
cd /path/to/your-consumer-repo
git submodule add <lattice-repo-url> hooks
git submodule update --init --recursive
```

Expected result:

```bash
ls hooks/common.mjs hooks/session-start.mjs hooks/hook-runner.mjs hooks/codex-hook-runner.mjs hooks/pre-tool-policy.mjs
# => hooks/common.mjs  hooks/session-start.mjs  hooks/hook-runner.mjs  hooks/codex-hook-runner.mjs  hooks/pre-tool-policy.mjs
```

**Option B: Directory copy**

```bash
cp -R /path/to/lattice/ /path/to/your-consumer-repo/hooks/
```

If you copy instead of using a submodule, keep the destination path as `hooks/`
so existing config commands remain valid.

### Step 2 — Validate the mount

```bash
cd /path/to/your-consumer-repo
node --check hooks/common.mjs && node --check hooks/session-start.mjs && node --check hooks/hook-runner.mjs && node --check hooks/codex-hook-runner.mjs && node --check hooks/pre-tool-policy.mjs && echo "OK"
# => OK
```

If any file fails `node --check`, the mount is broken. Re-run step 1.

### Step 3 — Wire your AI client

Pick your client below. Each section gives you the exact config file, contents,
and a smoke test.

---

### Claude Code Config

**Config file:** `.claude/settings.json` (create directory if missing)

```jsonc
// .claude/settings.json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node --input-type=module -e \"import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CLAUDE_PROJECT_DIR||process.env.CLAUDE_PROJECT_ROOT||process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;globalThis.__latticeHookArgs=['session-start.mjs','claude-code'];await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/hook-runner.mjs from '+start);process.exit(1)})\"",
            "timeout": 15
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|Edit|MultiEdit|Write|mcp__.*__take_screenshot$",
        "hooks": [
          {
            "type": "command",
            "command": "node --input-type=module -e \"import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CLAUDE_PROJECT_DIR||process.env.CLAUDE_PROJECT_ROOT||process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;globalThis.__latticeHookArgs=['pre-tool-policy.mjs','claude-code'];await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/hook-runner.mjs from '+start);process.exit(1)})\"",
            "timeout": 15
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node --input-type=module -e \"import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CLAUDE_PROJECT_DIR||process.env.CLAUDE_PROJECT_ROOT||process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;globalThis.__latticeHookArgs=['post-tool-reminder.mjs','claude-code'];await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/hook-runner.mjs from '+start);process.exit(1)})\"",
            "timeout": 15
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node --input-type=module -e \"import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CLAUDE_PROJECT_DIR||process.env.CLAUDE_PROJECT_ROOT||process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;globalThis.__latticeHookArgs=['stop-checklist.mjs','claude-code'];await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/hook-runner.mjs from '+start);process.exit(1)})\"",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

**Smoke test:**

```
node hooks/verification/smoke-plan.mjs session-start claude-code
node hooks/verification/smoke-plan.mjs post-compact claude-code
node hooks/verification/smoke-plan.mjs pre-tool-deny claude-code
```

---

### GitHub Copilot CLI Config

**Config file:** `.github/hooks/repo-guardrails.json` (create directories if missing)

```jsonc
// .github/hooks/repo-guardrails.json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "node ./hooks/session-start.mjs copilot",
        "powershell": "node .\\hooks\\session-start.mjs copilot",
        "cwd": ".",
        "timeoutSec": 15
      }
    ],
    "preToolUse": [
      {
        "type": "command",
        "bash": "node ./hooks/pre-tool-policy.mjs copilot",
        "powershell": "node .\\hooks\\pre-tool-policy.mjs copilot",
        "cwd": ".",
        "timeoutSec": 15
      }
    ]
  }
}
```

This repo only wires the **hook layer** for Copilot CLI. If you also want Serena
as an MCP server, configure that in the Copilot/IDE surface that your local
environment actually uses; there is no single repo-scoped Copilot MCP file that
`lattice` can assume.

**Smoke test:**

```
node hooks/verification/smoke-plan.mjs session-start copilot-cli
node hooks/verification/smoke-plan.mjs pre-tool-deny copilot-cli
```

---

### Codex CLI Config

Codex uses **two** repo-scoped files:

- `.codex/config.toml` — feature flags (required for hooks)
- `.codex/hooks.json` — hook definitions

```toml
# .codex/config.toml
[features]
hooks = true
```

Codex hook commands should dispatch through `hooks/codex-hook-runner.mjs`
instead of `$(git rev-parse --show-toplevel)`. Codex can invoke hooks from a
shell cwd outside the repo; the runner resolves the mounted `hooks/` directory
from the hook payload `cwd` and then forwards stdin to the real hook script.

```jsonc
// .codex/hooks.json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "node --input-type=module -e \"import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CLAUDE_PROJECT_DIR||process.env.CLAUDE_PROJECT_ROOT||process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','codex-hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;globalThis.__latticeHookArgs=['session-start.mjs','codex'];await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/codex-hook-runner.mjs from '+start);process.exit(1)})\"",
            "statusMessage": "Checking lattice startup",
            "timeout": 15
          }
        ]
      },
      {
        "matcher": "resume",
        "hooks": [
          {
            "type": "command",
            "command": "node --input-type=module -e \"import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CLAUDE_PROJECT_DIR||process.env.CLAUDE_PROJECT_ROOT||process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','codex-hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;globalThis.__latticeHookArgs=['session-start.mjs','codex','--session-kind','resume'];await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/codex-hook-runner.mjs from '+start);process.exit(1)})\"",
            "statusMessage": "Recovering session context",
            "timeout": 15
          }
        ]
      },
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "node --input-type=module -e \"import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CLAUDE_PROJECT_DIR||process.env.CLAUDE_PROJECT_ROOT||process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','codex-hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;globalThis.__latticeHookArgs=['session-start.mjs','codex','--session-kind','compact'];await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/codex-hook-runner.mjs from '+start);process.exit(1)})\"",
            "statusMessage": "Recovering compacted session context",
            "timeout": 15
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node --input-type=module -e \"import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CLAUDE_PROJECT_DIR||process.env.CLAUDE_PROJECT_ROOT||process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','codex-hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;globalThis.__latticeHookArgs=['pre-tool-policy.mjs','codex'];await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/codex-hook-runner.mjs from '+start);process.exit(1)})\"",
            "statusMessage": "Applying lattice guardrails",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

**Smoke test:**

```
node hooks/verification/smoke-plan.mjs session-start codex
node hooks/verification/smoke-plan.mjs post-compact codex
node hooks/verification/smoke-plan.mjs pre-tool-deny codex
```

#### Codex plugin cache repair

Some global Codex plugins ship hook manifests that are valid on POSIX shells but
break on Windows, especially commands containing a literal
`${CLAUDE_PLUGIN_ROOT}` or a bare `bash` that resolves to the WindowsApps WSL
shim. Lattice owns a local compatibility repair for those manifests:

```powershell
lattice repair codex-plugin-hooks
lattice repair codex-plugin-hooks --write
```

The command scans `~/.codex/plugins/cache/**/hooks/hooks.json`, previews changes
by default, and only writes when `--write` is passed. See
[docs/CODEX-PLUGIN-HOOK-REPAIR.md](docs/CODEX-PLUGIN-HOOK-REPAIR.md) for the
exact repair rules.

---

### Step 4 — Verification Profile (Optional)

Lattice includes a Clawback-inspired verification profile for projects that
want mechanical checks in addition to behavioral reminders:

- `pre-tool-policy.mjs` blocks AI edits to `.env*`, `.envrc`, files under
  `.git/`, and lockfiles detected from the nearest project stack.
- `verification/detect-stack.mjs` detects JavaScript/TypeScript, Go, Rust,
  Python, and PHP project roots and their typecheck/lint commands.
- `stop-checklist.mjs` can run typecheck + lint before Stop and block Claude
  when relevant errors are found in changed files.
- A small circuit breaker allows Stop after repeated verification failures so
  the agent cannot get trapped forever.

Enable the Stop verification gate by setting this on the Stop hook command:

```jsonc
{
  "type": "command",
  "command": "node --input-type=module -e \"import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CLAUDE_PROJECT_DIR||process.env.CLAUDE_PROJECT_ROOT||process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;globalThis.__latticeHookArgs=['stop-checklist.mjs','claude-code','--env','LATTICE_VERIFY_ON_STOP=1'];await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/hook-runner.mjs from '+start);process.exit(1)})\"",
  "timeout": 75
}
```

Keep it disabled for very large repos until the project has a reliable
typecheck/lint command surface. The file-protection gate works whenever the
client's `PreToolUse` matcher includes `Edit|MultiEdit|Write`.

Source inspiration: <https://github.com/LZong-tw/clawback>

---

### Step 5 — Serena (Optional)

By default, the v1 dispatcher activates **every registered provider** —
that includes the built-ins (`lattice/protection`, `lattice/commit-checkpoint`,
the reminders, `lattice/stop-checklist`) plus `serena` and `semble`. The
Serena provider adds MCP server lifecycle and a dashboard; if you want to
use it:

→ Follow [`docs/SERENA-CLIENT-SETUP.md`](docs/SERENA-CLIENT-SETUP.md)

If you do **not** want Serena, opt it out without disabling the rest:

- `LATTICE_DISABLE=serena`

Use that opt-out when Claude Code/Codex already point at a project-wide Serena
HTTP singleton, for example `http://127.0.0.1:9127/mcp`. In that mode the
client MCP config owns Serena and Lattice should not start its older per-client
sidecar on ports 9122/9123.

If you want the shared hooks without any provider at all, disable everything:

- `LATTICE_PROVIDERS=none` (or `off` / `false` / `0`)

You can also restrict the active set to an explicit allowlist with
`LATTICE_PROVIDERS=<name1>,<name2>`, which takes precedence over
`LATTICE_PROVIDER=<name>`. Treat that as an advanced isolation switch: it
replaces the full active set and can remove built-ins such as the commit gate.

> **Note**: the legacy `bootstrapProviders` path on `provider-registry.mjs`
> still defaults to `["serena"]` for backwards compatibility, but it is
> `@deprecated` and unused by the shipped hook entry points. New code
> should not rely on it.

---

### Step 6 — Semble (Optional)

Semble is code-search MCP, not a lifecycle provider. Configure it in the
consumer repo's startup MCP surface:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "semble": {
      "type": "stdio",
      "command": "uvx",
      "args": ["--from", "semble[mcp]", "semble"]
    }
  }
}
```

```toml
# .codex/config.toml
[mcp_servers.semble]
command = "uvx"
args = ["--from", "semble[mcp]", "semble"]
```

If the consumer repo wants SessionStart to fail when this config drifts, set
`LATTICE_REQUIRE_SEMBLE_MCP=1` in its Claude/Codex SessionStart command.

---

### Step 7 — RTK (Optional)

[RTK](https://github.com/rtk-ai/rtk) is not an MCP server. It is a CLI proxy
that rewrites common shell commands to token-compacted `rtk ...` equivalents.
The bundled `rtk` provider runs on Claude/Codex `PreToolUse` Bash commands and
delegates the rewrite decision to `rtk rewrite`.

RTK also expects `rg`/ripgrep for many rewrites. Install it once per machine
(`winget install --id BurntSushi.ripgrep.MSVC --exact` on Windows,
`brew install ripgrep` on macOS, or your Linux package manager), then restart
already-open terminals so AI-client hooks see the updated PATH.

Run `rtk init -g --show` to check RTK's native global hook status. Native RTK
wins: the Lattice `rtk` provider skips commands that already start with
`rtk ...`, and on Claude Code it also skips when the global `rtk hook claude`
PreToolUse hook is detected. Set `LATTICE_RTK_FORCE_PROVIDER=1` only when you
explicitly want the Lattice provider to run anyway.

For OpenCode, use RTK's native OpenCode plugin instead of the Lattice `rtk`
provider:

```bash
rtk init -g --opencode
rtk init -g --show
# => [ok] OpenCode: plugin installed (.../opencode/plugins/rtk.ts)
```

Restart OpenCode after installing the plugin. See
[`docs/OPTIONAL-PROVIDER-SETUP.md`](docs/OPTIONAL-PROVIDER-SETUP.md#opencode)
for the exact plugin path and verification steps.

Default behavior is fail-open:

- If `rtk` is missing, times out, or returns no rewrite, the original command runs.
- `git commit` commands are never rewritten so the Lattice commit gate remains the
  source of truth.
- `RTK_DISABLED=1 <command>` and `LATTICE_RTK_DISABLED=1` skip the provider.
- `LATTICE_RTK_FORCE_PROVIDER=1` forces the provider to run even when native RTK
  hook mode is detected.
- Set `LATTICE_REQUIRE_RTK=1` during `SessionStart` only when the repo wants
  startup to fail if `rtk` is unavailable.

Useful knobs:

```bash
LATTICE_RTK_BIN=/opt/homebrew/bin/rtk
LATTICE_RTK_TIMEOUT_MS=2000
LATTICE_REQUIRE_RTK=1
```

---

## Done Criteria (Consumer)

An LLM agent can consider consumer setup **complete** when ALL of these pass:

1. `node --check hooks/common.mjs && node --check hooks/session-start.mjs && node --check hooks/hook-runner.mjs && node --check hooks/codex-hook-runner.mjs && node --check hooks/pre-tool-policy.mjs` → exits 0
2. The client config file exists at the correct path (see per-client sections above)
3. `node hooks/verification/smoke-plan.mjs session-start <client>` → exits 0 for each wired client (`claude-code`, `codex`, `copilot-cli`)
4. `node hooks/verification/smoke-plan.mjs pre-tool-deny <client>` → exits 0 (the commit gate fires)
5. (If Serena) the configured `http://127.0.0.1:<port>/mcp` endpoint responds (see SERENA-CLIENT-SETUP.md)
6. (If Semble) Claude/Codex MCP config contains a stdio `semble` entry
7. (If RTK is required) `rtk --version` and `rg --version` exit 0 in the AI client's hook environment

---

## Developer Setup (Editing Lattice Itself)

```bash
cd /path/to/lattice
pnpm install --frozen-lockfile
# => Lockfile is up to date ...

pnpm run doctor
# => All checks should print ✓

pnpm test
# => Tests should pass (vitest)

pnpm run check
# => All node --check calls should exit 0
```

### Doctor Command

A single-command health check for the lattice package:

```bash
pnpm run doctor
# Expected output (all lines start with ✓):
# ✓ Node.js >= 20
# ✓ common.mjs parses
# ✓ session-start.mjs parses
# ✓ provider-registry.mjs parses
# ✓ mcp-config-common.mjs parses
# ✓ pre-tool-policy.mjs parses
# ✓ commit-checkpoint.mjs parses
# ✓ post-tool-reminder.mjs parses
# ✓ stop-checklist.mjs parses
# ✓ serena/bootstrap.mjs parses
# ✓ serena/dashboard-state.mjs parses
# ✓ serena/mcp-config-guard.mjs parses
# ✓ serena/start-http.mjs parses
# ✓ serena/open-dashboard.mjs parses
# ✓ semble/mcp-config-guard.mjs parses
# ✓ package.json exports are valid
# (optional) ✓ uvx available — Serena and Semble launchers ready
# (optional) ⚠ uvx not found — Serena/Semble launchers unavailable (non-blocking)
#
# doctor: all checks passed
```

If doctor reports failures, fix them before running tests.

---

## State and Consumer-Root Detection

`lattice` auto-detects the consuming repo root when it is mounted at `hooks/`.
That repo name becomes the default runtime-state namespace under
`$XDG_STATE_HOME/<repo-name>/...`.

You can override detection when needed:

| Variable | Purpose |
|----------|---------|
| `LATTICE_REPO_ROOT` | Override the detected consumer repo root path |
| `LATTICE_STATE_NAMESPACE` | Override the state directory namespace |

---

## Provider Integration

Each hook event is dispatched to every registered provider whose `handlers`
map declares that event. Built-in providers (file protection, commit gate,
checklist, reminders, Serena, Semble) self-register via
`register-builtins.mjs`. External providers ship as npm packages whose import
side-effect calls `registerProvider`.

### Selection env vars (summary)

| Variable | Behaviour |
|----------|-----------|
| _(none set)_ | Dispatcher activates every registered provider (built-ins + Serena + Semble + anything loaded via `LATTICE_EXTRA_PROVIDERS`). |
| `LATTICE_PROVIDERS=<n1>,<n2>` | Explicit ordered allowlist; unknown names fail fast. This replaces the active set, so `LATTICE_PROVIDERS=serena,rtk` disables built-ins such as `lattice/protection` and the commit gate. Use only for isolation/debugging or deliberately minimal hook profiles. |
| `LATTICE_PROVIDER=<name>` | Single-provider allowlist; superseded by `LATTICE_PROVIDERS`. Also disables all unlisted built-ins. |
| `LATTICE_DISABLE=<n1>,<n2>` | Subtract these names from the active list. |
| `LATTICE_PROVIDERS=none` (or `off` / `false` / `0`) | Disable all providers. |
| `LATTICE_EXTRA_PROVIDERS=<spec1>,<spec2>` | Dynamically `import()` external provider modules at register-builtins load time. |
| `LATTICE_LESSONS_CONFIG=<path>` | Absolute path to the `lattice/lessons` JSON config. Takes precedence over `.lattice/lessons.config.json` and `lattice.config.json#lessons`. |
| `LATTICE_LESSONS_PROMOTE_THRESHOLD=<n>` | Override the default score threshold (`4`) used by `lessons/promote-audit.mjs` to mark a prose lesson as a candidate for promotion to an audit/hook. |

For the **full** list of `LATTICE_*` env vars — including timeouts, Codex
runner controls, built-in provider settings (`LATTICE_VERIFY_*`,
`LATTICE_REQUIRE_SERENA_MCP`, `LATTICE_REQUIRE_SEMBLE_MCP`), and the naming
carve-out for legacy names — see
[`docs/PROVIDER-AUTHORING.md`](docs/PROVIDER-AUTHORING.md) § "Reserved env
vars".

For normal consumer repos, leave `LATTICE_PROVIDERS` and `LATTICE_PROVIDER`
unset. Built-ins and optional bundled providers are registered by default. Use
`LATTICE_DISABLE=<name>` when you need to subtract a provider without losing the
commit gate.

### Per-event timeouts

Every dispatch carries an `AbortSignal` driven by a per-event timeout.
Defaults (overridable via `LATTICE_TIMEOUT_<EVENT_IN_SCREAMING_SNAKE>=ms`):

| Event | Default | Env override |
|---|---|---|
| `PreToolUse` | 5_000 ms | `LATTICE_TIMEOUT_PRE_TOOL_USE` |
| `PostToolUse` | 5_000 ms | `LATTICE_TIMEOUT_POST_TOOL_USE` |
| `Stop` | 60_000 ms | `LATTICE_TIMEOUT_STOP` |
| `SessionStart` | 30_000 ms | `LATTICE_TIMEOUT_SESSION_START` |
| `PostCompact` | 10_000 ms | `LATTICE_TIMEOUT_POST_COMPACT` |
| `Notification` | 5_000 ms | `LATTICE_TIMEOUT_NOTIFICATION` |
| (any other) | 30_000 ms | `LATTICE_TIMEOUT_DEFAULT` |

### Built-in providers

| Provider | Events | Purpose |
|---|---|---|
| `lattice/protection` | PreToolUse | Deny edits to `.env*`, `.git/`, detected lockfiles. Deny `git commit` Bash commands. |
| `lattice/commit-checkpoint` | SessionStart, PreToolUse | Nag when the working tree is dirty (with cooldown). |
| `lattice/screenshot-reminder` | PreToolUse | (claude-code only) Remind to scroll all areas after a screenshot. |
| `lattice/edit-reminder` | PostToolUse | Remind to log lessons after edits. |
| `lattice/stop-checklist` | Stop | Print the end-of-turn checklist; optionally gate with verification (`LATTICE_VERIFY_ON_STOP=1`). |
| `serena` | SessionStart, validator | Clean up stale Serena/WebView process trees, bootstrap [Serena](https://github.com/oraios/serena) MCP server, and validate `.mcp.json` / `.codex/config.toml` stable loopback HTTP config when `LATTICE_REQUIRE_SERENA_MCP=1`. Legacy stdio configs still validate during migration. |
| `semble` | validator only | Validate Semble MCP config when `LATTICE_REQUIRE_SEMBLE_MCP=1`. Skipped for Copilot. |
| `rtk` | PreToolUse, validator | Optionally rewrite Claude/Codex Bash commands via `rtk rewrite`; validate the binary only when `LATTICE_REQUIRE_RTK=1`. Skipped for Copilot. |
| `lattice/lessons` | Stop, PostToolUse, PreToolUse | Manage the growing-prose-rules problem in long-lived repos. Stop hook warns when `CLAUDE.md` exceeds a soft cap; PostToolUse Edit/Write resurfaces the per-domain doc when a touched file matches a configured domain; opt-in PreToolUse write-gate blocks `git commit` for code changes that don't also edit a docs path. Full guide: [`docs/LESSONS.md`](docs/LESSONS.md). Zero-config behaviour fires only the size-check warning. |

### Writing your own provider

See [`docs/PROVIDER-AUTHORING.md`](docs/PROVIDER-AUTHORING.md) for the full v1
contract (definition shape, handler signature, result merge rules, validator
semantics, testing helpers).

For the release/rollout flow when shipping a new provider into a consumer
repo, see [`docs/PROVIDER-ROLLOUT.md`](docs/PROVIDER-ROLLOUT.md).

The current real MCP provider is [Serena](https://github.com/oraios/serena);
see [`docs/SERENA-CLIENT-SETUP.md`](docs/SERENA-CLIENT-SETUP.md) for per-client
endpoints, smoke tests, and troubleshooting.

---

## Validation

```bash
pnpm install --frozen-lockfile
pnpm run doctor   # lightweight health check
pnpm test         # vitest test suite
pnpm run check    # node --check on all entry points
```

All three commands must pass. `doctor` is a subset of `check` with richer
output suitable for LLM agents.

---

## Tests

Tests cover:

- Consumer path contract stability
- Commit checkpoint reminder behavior
- Hook policy entry-point behavior (commit gate deny for all clients)
- Provider registry selection and bootstrap contract
- Serena runtime state helpers and launcher contracts

---

## Troubleshooting

### `PreToolUse hook exited with code 1`

**Cause:** the client can execute the hook, but a provider or policy gate is
returning a blocking failure.

The shell snippets below use POSIX pipes (`echo … | env VAR=… node …`).
On Windows, prefer the portable runner:
`'...' | node hooks/hook-runner.mjs pre-tool-policy.mjs codex --env LATTICE_PROVIDER=none`.

```bash
# First isolate the shared hook layer:
echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' \
  | env LATTICE_PROVIDER=none node hooks/pre-tool-policy.mjs claude-code
# => Should exit 0

echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' \
  | env LATTICE_PROVIDER=none node hooks/pre-tool-policy.mjs codex
# => Should exit 0
```

If the isolated command passes, re-enable providers one at a time:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' \
  | env LATTICE_PROVIDER=serena node hooks/pre-tool-policy.mjs claude-code

echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' \
  | env LATTICE_PROVIDER=rtk node hooks/pre-tool-policy.mjs codex
```

Then fix the provider-specific config or unset that provider until it is ready.

### `PostCompact hook returned invalid PostCompact hook JSON output`

**Cause:** a PostCompact hook wrote empty stdout, non-JSON text, or a context
injection payload. PostCompact hooks must write valid JSON and should not inject
context.

Provider rule:

```json
{}
```

Output `{}`. Write diagnostics to stderr, not stdout. If the provider needs to
re-inject context after compaction, wire that behavior through `SessionStart`
with the `compact` matcher instead of `PostCompact`.

### Codex warns `[features].codex_hooks` is deprecated

Use this:

```toml
[features]
hooks = true
```

Do not use this:

```toml
[features]
codex_hooks = true
```

### `lattice: cannot find hooks/codex-hook-runner.mjs`

**Cause:** Codex ran the hook from a cwd outside the consumer repo, or lattice
is not mounted at the stable `hooks/` path.

```bash
ls hooks/codex-hook-runner.mjs
# => hooks/codex-hook-runner.mjs
```

If the file exists, make sure `.codex/hooks.json` uses the command from
[Codex CLI Config](#codex-cli-config). Do not replace it with a short
`git rev-parse` command; Codex hook cwd is not always the repo root.

### `LATTICE_DISABLE=...` is not recognized on Windows

**Cause:** The hook command uses POSIX env-prefix syntax. PowerShell and cmd.exe
do not understand `KEY=value node ...`.

Use the shell-neutral runner instead:

```jsonc
{
  "type": "command",
  "command": "node --input-type=module -e \"import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CLAUDE_PROJECT_DIR||process.env.CLAUDE_PROJECT_ROOT||process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;globalThis.__latticeHookArgs=['pre-tool-policy.mjs','claude-code','--env','LATTICE_DISABLE=serena,lattice/protection,lattice/stop-checklist','--env','LATTICE_RTK_DISABLED=1'];await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/hook-runner.mjs from '+start);process.exit(1)})\"",
}
```

This is the recommended shape when lattice runs beside clawback or other
project-local hooks and only selected built-ins should be disabled.

### Codex plugin hook exits 1 on Windows

**Cause:** A global Codex plugin can install `hooks/hooks.json` commands that
the Windows shell cannot run as written. Known cases include literal
`${CLAUDE_PLUGIN_ROOT}` placeholders, bare `bash` resolving to the WindowsApps
WSL shim, and noisy Codex companion Node warnings being surfaced in the UI.

Preview the local repair:

```powershell
lattice repair codex-plugin-hooks
```

Apply it after reviewing the report:

```powershell
lattice repair codex-plugin-hooks --write
```

The repair is intentionally cache-local. Re-run it after installing or updating
global Codex plugins.

### `node --check` fails on a hook file

**Cause:** Node.js version too old or file is corrupted/missing.

```bash
node --version
# Must be >= 20. If not, upgrade Node.js.

# Re-mount if files are missing:
git submodule update --init --recursive
```

### `session-start.mjs` exits non-zero

**Cause:** explicit provider selection is invalid, or a provider bootstrap
returned a non-zero exit code.

```
# Isolate the shared hook layer (smoke-plan disables all providers internally):
node hooks/verification/smoke-plan.mjs session-start claude-code
# => Should exit 0. If it does, the failure is provider-specific.

# Then validate the selected provider config/env.
# For Serena, follow docs/SERENA-CLIENT-SETUP.md troubleshooting.
```

### Commit gate does not fire (no deny on `git commit`)

**Cause:** Client argument is missing or wrong.

```bash
# Verify the client arg is passed:
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"}}' \
  | node hooks/pre-tool-policy.mjs claude-code
# => Must output JSON with "permissionDecision":"deny"
# If it doesn't, check that the config passes the client name as the first arg.
```

### `pnpm test` fails

```bash
pnpm install --frozen-lockfile
pnpm test
# Read the vitest output. Common causes:
# - Missing devDependencies (run pnpm install)
# - Node version mismatch
# - Working directory is not the lattice root
```

### Serena-specific issues

See [`docs/SERENA-CLIENT-SETUP.md` § Troubleshooting](docs/SERENA-CLIENT-SETUP.md#troubleshooting).

### RTK-specific issues

RTK is fail-open unless the repo explicitly sets `LATTICE_REQUIRE_RTK=1`.

```bash
rtk --version
# => exits 0 when RTK is installed

echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' \
  | env RTK_DISABLED=1 node hooks/pre-tool-policy.mjs codex
# => skips RTK command rewriting for this invocation
```
