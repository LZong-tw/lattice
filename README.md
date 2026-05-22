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

---

## Agent Start Here

This section is the install contract for LLM agents and humans. If you are
installing lattice into another repo, follow the phases in order and stop only
after [One-Screen Done Check](#one-screen-done-check) passes.

If you are editing lattice itself, skip to [Developer Setup](#developer-setup-editing-lattice-itself).

For an OpenCode-style repo scan before editing config, run the init planner
from the consumer repo. Without `--write`, this is read-only:

```bash
node /path/to/lattice/init.mjs --consumer "$(pwd)" --clients claude,codex --providers serena,semble
# or, after lattice is already mounted at hooks/:
node hooks/init.mjs --clients claude,codex --providers serena,semble
```

The planner prints the same phased install contract plus warnings for common
drift such as deprecated Codex `[features].codex_hooks`.

To let lattice create or update the managed project files, opt in explicitly:

```bash
node hooks/init.mjs --write --clients claude,codex --providers serena,semble
```

`--write` updates `.claude/settings.json`, `.codex/config.toml`,
`.codex/hooks.json`, optional Copilot config, and a managed `AGENTS.md` block.
It is idempotent: rerunning the same command should produce the same files.

### Phase 0 — Declare Inputs

Run these from the consumer repo. Replace `LATTICE_REPO_URL` with the real
repository URL if you use the submodule path.

```bash
export CONSUMER_REPO="$(pwd)"
export LATTICE_REPO_URL="<lattice-repo-url>"
test -d "$CONSUMER_REPO/.git" && echo "consumer repo: $CONSUMER_REPO"
# => consumer repo: /path/to/consumer
```

### Phase 1 — Check Prerequisites

```bash
node --version
# => v20.x.x or higher

git --version
# => git version 2.x.x or higher
```

Optional providers need extra CLIs:

```bash
uvx --version
# => required only for Serena/Semble MCP startup commands

rtk --version
# => required only when LATTICE_REQUIRE_RTK=1
```

### Phase 2 — Mount lattice at `hooks/`

Choose exactly one mount strategy. Do not use both in the same consumer repo.

**Option A: git submodule (recommended for shared project repos)**

```bash
cd "$CONSUMER_REPO"
git submodule add "$LATTICE_REPO_URL" hooks
git submodule update --init --recursive
```

**Option B: internal package copy (only when your private registry mirrors lattice)**

```bash
cd "$CONSUMER_REPO"
pnpm add @lattice/core  # from the approved internal registry only
mkdir -p hooks
node -e "import('node:fs').then(({cpSync,rmSync})=>{rmSync('hooks',{recursive:true,force:true});cpSync('node_modules/@lattice/core','hooks',{recursive:true})})"
```

The consumer path must be exactly `hooks/`. Client configs below depend on
that stable path.

### Phase 3 — Verify the Mount

```bash
cd "$CONSUMER_REPO"
ls hooks/common.mjs hooks/session-start.mjs hooks/codex-hook-runner.mjs hooks/pre-tool-policy.mjs
# => all four files are listed

node --check hooks/common.mjs
node --check hooks/session-start.mjs
node --check hooks/codex-hook-runner.mjs
node --check hooks/pre-tool-policy.mjs
# => each command exits 0
```

If any command fails, re-run Phase 2 before editing client config.

### Phase 4 — Wire the AI Client

Pick every client that must work in this consumer repo.

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
| Serena | You want startup-time Serena MCP lifecycle and dashboard checks | Follow [docs/SERENA-CLIENT-SETUP.md](docs/SERENA-CLIENT-SETUP.md), then set `LATTICE_REQUIRE_SERENA_MCP=1` only after MCP config exists. |
| Semble | You want code-search MCP available at startup | Add a stdio `semble` MCP entry to Claude/Codex config, then set `LATTICE_REQUIRE_SEMBLE_MCP=1` only after config exists. |
| RTK | You want Bash command output rewritten through `rtk rewrite` | Install `rtk`; leave fail-open by default, or set `LATTICE_REQUIRE_RTK=1` only when missing RTK should block startup. |

Reference docs:

- [docs/SERENA-CLIENT-SETUP.md](docs/SERENA-CLIENT-SETUP.md) — Serena MCP for Claude Code and Codex.
- [docs/PROVIDER-ROLLOUT.md](docs/PROVIDER-ROLLOUT.md) — rollout order for provider changes.
- [docs/PROVIDER-AUTHORING.md](docs/PROVIDER-AUTHORING.md) — writing new lattice providers.

### Phase 6 — Smoke Test Before Commit

Run the shared smoke tests from the consumer repo:

```bash
cd "$CONSUMER_REPO"
printf '{}\n' | env LATTICE_PROVIDER=none node hooks/session-start.mjs claude; echo "exit: $?"
# => exit: 0

printf '{}\n' | env LATTICE_PROVIDER=none node hooks/session-start.mjs codex; echo "exit: $?"
# => exit: 0

echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m test"}}' | node hooks/pre-tool-policy.mjs claude
# => stdout contains "permissionDecision":"deny"

echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m test"}}' | node hooks/pre-tool-policy.mjs codex
# => stdout contains "permissionDecision":"deny"
```

For Copilot-only repos, run the same PreToolUse smoke test with `copilot`.

### One-Screen Done Check

Consumer setup is complete only when all applicable checks pass:

```bash
cd "$CONSUMER_REPO"
test -f hooks/common.mjs
node --check hooks/common.mjs
node --check hooks/session-start.mjs
node --check hooks/codex-hook-runner.mjs
node --check hooks/pre-tool-policy.mjs
printf '{}\n' | env LATTICE_PROVIDER=none node hooks/session-start.mjs claude
printf '{}\n' | env LATTICE_PROVIDER=none node hooks/session-start.mjs codex
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m test"}}' | node hooks/pre-tool-policy.mjs claude | grep '"permissionDecision":"deny"'
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m test"}}' | node hooks/pre-tool-policy.mjs codex | grep '"permissionDecision":"deny"'
```

Then confirm each client-specific file exists:

```bash
test -f .claude/settings.json        # if using Claude Code
test -f .codex/config.toml           # if using Codex
test -f .codex/hooks.json            # if using Codex
test -f .github/hooks/repo-guardrails.json  # if using Copilot CLI
```

Optional provider done checks:

```bash
curl -sf http://127.0.0.1:<serena-port>/mcp  # if Serena is required
rg '"semble"|\\bsemble\\b' .mcp.json .codex/config.toml  # if Semble is required
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
  stdout. Empty stdout is invalid; output `{}` when there is no update.
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
| Public barrel | `index.mjs` | Root `@lattice/core` export — re-exports the user-facing surface (`registerProvider`, `dispatch`, constants, types). |
| TypeScript contract | `lattice.d.ts` | Public type definitions for `LatticeProvider`, `LatticeContext`, `LatticeHandlerResult`, and helpers. |
| Dispatcher | `dispatcher.mjs` | v1 event dispatcher — fans events to every registered provider and merges results into Anthropic response shape. |
| Context | `context.mjs` | Builds the frozen `LatticeContext` (cwd, repoRoot, stateDir, env snapshot, signal) per dispatch. |
| Client enum | `client-enum.mjs` | `normalizeClient()` canonicalization (`claude` → `claude-code`, etc.). |
| Timeouts | `timeouts.mjs` | Per-event timeout defaults + `LATTICE_TIMEOUT_*` overrides driving `ctx.signal`. |
| Provider registry | `provider-registry.mjs` | `registerProvider`, selection rules, legacy `bootstrapProviders` (deprecated). |
| Built-in registration | `register-builtins.mjs` | Self-registers built-in providers; also loads `LATTICE_EXTRA_PROVIDERS=<spec>` packages. |
| Built-in providers | `builtins/` | `protection`, `commit-checkpoint`, `screenshot-reminder`, `edit-reminder`, `stop-checklist` v1 providers. |
| Shared runtime | `*.mjs` (root) | Client-agnostic hook entry points and policy logic (`session-start.mjs`, `pre-tool-policy.mjs`, `stop-checklist.mjs`, etc.). |
| Codex runner | `codex-hook-runner.mjs` | Forwards Codex hook payloads to the right entry script (driven by `LATTICE_HOOK_TARGET` / `LATTICE_HOOK_CLIENT`). |
| Testing helpers | `testing.mjs` | `mockContext`, `runProvider`, `mockPayload` — published as `@lattice/core/testing`. |
| MCP config helpers | `mcp-config-common.mjs` | Shared JSON/TOML parser utilities for startup MCP guards. |
| File protection | `protection.mjs` | Edit guard for env files, `.git/`, and detected lockfiles. |
| Verification profile | `verification/` | Stack-aware typecheck/lint detection and optional Stop gate. |
| Serena provider | `serena/` | Serena-specific lifecycle, launcher, dashboard helpers, and v1 provider definition. |
| Serena MCP guard | `serena/mcp-config-guard.mjs` | Optional SessionStart guard for repos that require startup-time Serena stdio MCP. |
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
ls hooks/common.mjs hooks/session-start.mjs hooks/codex-hook-runner.mjs hooks/pre-tool-policy.mjs
# => hooks/common.mjs  hooks/session-start.mjs  hooks/codex-hook-runner.mjs  hooks/pre-tool-policy.mjs
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
node --check hooks/common.mjs && node --check hooks/session-start.mjs && node --check hooks/codex-hook-runner.mjs && node --check hooks/pre-tool-policy.mjs && echo "OK"
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
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/hooks/session-start.mjs claude",
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
            "command": "node \"$CLAUDE_PROJECT_DIR\"/hooks/pre-tool-policy.mjs claude",
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
            "command": "node \"$CLAUDE_PROJECT_DIR\"/hooks/post-tool-reminder.mjs claude",
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
            "command": "node \"$CLAUDE_PROJECT_DIR\"/hooks/stop-checklist.mjs",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

**Smoke test:**

```bash
printf '{}\n' | env LATTICE_PROVIDER=none node hooks/session-start.mjs claude; echo "exit: $?"
# => exit: 0

echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m test"}}' | node hooks/pre-tool-policy.mjs claude
# => stdout contains "permissionDecision":"deny" (commit gate fires)
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

```bash
printf '{}\n' | env LATTICE_PROVIDER=none node hooks/session-start.mjs copilot; echo "exit: $?"
# => exit: 0

echo '{"toolName":"bash","toolArgs":"{\"command\":\"git commit -m test\"}"}' | node hooks/pre-tool-policy.mjs copilot
# => stdout contains "permissionDecision":"deny"
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
            "command": "LATTICE_HOOK_TARGET=session-start.mjs LATTICE_HOOK_CLIENT=codex node --input-type=module -e \"import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','codex-hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/codex-hook-runner.mjs from '+start);process.exit(1)})\"",
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
            "command": "LATTICE_SESSION_KIND=resume LATTICE_HOOK_TARGET=session-start.mjs LATTICE_HOOK_CLIENT=codex node --input-type=module -e \"import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','codex-hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/codex-hook-runner.mjs from '+start);process.exit(1)})\"",
            "statusMessage": "Recovering session context",
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
            "command": "LATTICE_HOOK_TARGET=pre-tool-policy.mjs LATTICE_HOOK_CLIENT=codex node --input-type=module -e \"import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{let p={};try{p=JSON.parse(raw||'{}')}catch{};let start=process.env.CODEX_PROJECT_DIR||process.env.CODEX_WORKSPACE_ROOT||p.cwd||p.current_working_directory||process.cwd();for(let dir=resolve(start);;dir=dirname(dir)){let runner=resolve(dir,'hooks','codex-hook-runner.mjs');if(existsSync(runner)){globalThis.__latticeHookStdin=raw;await import(pathToFileURL(runner));return}let parent=dirname(dir);if(parent===dir)break}console.error('lattice: cannot find hooks/codex-hook-runner.mjs from '+start);process.exit(1)})\"",
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

```bash
printf '{}\n' | env LATTICE_PROVIDER=none node hooks/session-start.mjs codex; echo "exit: $?"
# => exit: 0

echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m test"}}' | node hooks/pre-tool-policy.mjs codex
# => stdout contains "permissionDecision":"deny"
```

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
  "command": "LATTICE_VERIFY_ON_STOP=1 node \"$CLAUDE_PROJECT_DIR\"/hooks/stop-checklist.mjs",
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

If you want the shared hooks without any provider at all, disable everything:

- `LATTICE_PROVIDERS=none` (or `off` / `false` / `0`)

You can also restrict the active set to an explicit allowlist with
`LATTICE_PROVIDERS=<name1>,<name2>`, which takes precedence over
`LATTICE_PROVIDER=<name>`.

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

Default behavior is fail-open:

- If `rtk` is missing, times out, or returns no rewrite, the original command runs.
- `git commit` commands are never rewritten so the Lattice commit gate remains the
  source of truth.
- `RTK_DISABLED=1 <command>` and `LATTICE_RTK_DISABLED=1` skip the provider.
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

1. `ls hooks/common.mjs` → file exists
2. `node --check hooks/common.mjs && node --check hooks/session-start.mjs && node --check hooks/codex-hook-runner.mjs && node --check hooks/pre-tool-policy.mjs` → exits 0
3. The client config file exists at the correct path (see per-client sections above)
4. `printf '{}\n' | env LATTICE_PROVIDER=none node hooks/session-start.mjs <client>` → exits 0
5. The commit-gate smoke test returns `"permissionDecision":"deny"` for `git commit`
6. (If Serena) `curl -sf http://127.0.0.1:<port>/mcp` responds (see SERENA-CLIENT-SETUP.md)
7. (If Semble) Claude/Codex MCP config contains a stdio `semble` entry
8. (If RTK is required) `rtk --version` exits 0 in the AI client's hook environment

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
| `LATTICE_PROVIDERS=<n1>,<n2>` | Explicit ordered allowlist; unknown names fail fast. |
| `LATTICE_PROVIDER=<name>` | Single-provider allowlist; superseded by `LATTICE_PROVIDERS`. |
| `LATTICE_DISABLE=<n1>,<n2>` | Subtract these names from the active list. |
| `LATTICE_PROVIDERS=none` (or `off` / `false` / `0`) | Disable all providers. |
| `LATTICE_EXTRA_PROVIDERS=<spec1>,<spec2>` | Dynamically `import()` external provider modules at register-builtins load time. |

For the **full** list of `LATTICE_*` env vars — including timeouts, Codex
runner controls, built-in provider settings (`LATTICE_VERIFY_*`,
`LATTICE_REQUIRE_SERENA_MCP`, `LATTICE_REQUIRE_SEMBLE_MCP`), and the naming
carve-out for legacy names — see
[`docs/PROVIDER-AUTHORING.md`](docs/PROVIDER-AUTHORING.md) § "Reserved env
vars".

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
| `serena` | SessionStart, validator | Bootstrap [Serena](https://github.com/oraios/serena) MCP server; validate `.mcp.json` / `.codex/config.toml` when `LATTICE_REQUIRE_SERENA_MCP=1`. |
| `semble` | validator only | Validate Semble MCP config when `LATTICE_REQUIRE_SEMBLE_MCP=1`. Skipped for Copilot. |
| `rtk` | PreToolUse, validator | Optionally rewrite Claude/Codex Bash commands via `rtk rewrite`; validate the binary only when `LATTICE_REQUIRE_RTK=1`. Skipped for Copilot. |

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

```bash
# First isolate the shared hook layer:
echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' \
  | env LATTICE_PROVIDER=none node hooks/pre-tool-policy.mjs claude
# => Should exit 0

echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' \
  | env LATTICE_PROVIDER=none node hooks/pre-tool-policy.mjs codex
# => Should exit 0
```

If the isolated command passes, re-enable providers one at a time:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' \
  | env LATTICE_PROVIDER=serena node hooks/pre-tool-policy.mjs claude

echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' \
  | env LATTICE_PROVIDER=rtk node hooks/pre-tool-policy.mjs codex
```

Then fix the provider-specific config or unset that provider until it is ready.

### `PostCompact hook returned invalid PostCompact hook JSON output`

**Cause:** a PostCompact hook wrote empty stdout or non-JSON text. PostCompact
hooks must write valid JSON.

Provider rule:

```json
{}
```

Output `{}` when there is no context update. Write diagnostics to stderr, not
stdout.

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

```bash
# Isolate the shared hook layer by disabling all providers:
printf '{}\n' | env LATTICE_PROVIDER=none node hooks/session-start.mjs claude
# => Should exit 0. If it does, the failure is provider-specific.

# Then validate the selected provider config/env.
# For Serena, follow docs/SERENA-CLIENT-SETUP.md troubleshooting.
```

### Commit gate does not fire (no deny on `git commit`)

**Cause:** Client argument is missing or wrong.

```bash
# Verify the client arg is passed:
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"}}' \
  | node hooks/pre-tool-policy.mjs claude
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
