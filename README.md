# lattice

`lattice` is a repo-scoped AI client runtime layer: shared hook entry points,
policy gates, lifecycle reminders, and provider integrations for
**Claude Code**, **GitHub Copilot CLI**, and **Codex CLI**.

This repo is designed to be mounted into a consuming repo at the stable path
`hooks/`. The shared hook logic stays provider-agnostic. `session-start.mjs`
now selects providers through an explicit registry contract: Serena remains the
default, and you can override or disable provider bootstrap with environment
variables.

---

## LLM Quick-Reference

> **If you are an LLM agent**: follow this doc top-to-bottom. Every command is
> copy-paste ready. Expected output is shown in `# =>` comments. If any step
> fails, jump to [Troubleshooting](#troubleshooting).

---

## Prerequisites

Run each command and verify the expected output before proceeding.

```bash
node --version
# => v18.x.x or higher (minimum: Node 18)

git --version
# => git version 2.x.x (any recent version)

pnpm --version
# => 9.x.x or higher (used inside lattice for tests; not required in consumer repos)
```

**Optional — only if you want Serena provider integration:**

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
 │   │       └─ Want Serena provider integration?
 │   │           ├─ YES → also follow docs/SERENA-CLIENT-SETUP.md
 │   │           └─ NO  → shared hooks work standalone, you are done
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
| Shared runtime | `*.mjs` | Client-agnostic hook entry points and policy logic |
| Provider registry | `provider-registry.mjs` | Explicit provider selection and bootstrap contract |
| Provider integration | `serena/` | Serena-specific lifecycle, launcher, and dashboard helpers |
| Serena MCP guard | `serena/mcp-config-guard.mjs` | Optional SessionStart guard for repos that require startup-time Serena stdio MCP |
| Tests | `__tests__/` | Package-level runtime and provider contracts |
| Docs | `docs/` | Provider details and consumer guidance |

## Consumer Path Contract

Inside this repo, scripts live at the package root:

- `session-start.mjs`
- `pre-tool-policy.mjs`
- `commit-checkpoint.mjs`
- `post-tool-reminder.mjs`
- `stop-checklist.mjs`
- `serena/bootstrap.mjs`
- `serena/mcp-config-guard.mjs`

When mounted inside a consumer repo at `hooks/`, clients execute those same
files through consumer-facing paths like:

- `hooks/session-start.mjs`
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
ls hooks/common.mjs hooks/session-start.mjs hooks/pre-tool-policy.mjs
# => hooks/common.mjs  hooks/session-start.mjs  hooks/pre-tool-policy.mjs
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
node --check hooks/common.mjs && node --check hooks/session-start.mjs && node --check hooks/pre-tool-policy.mjs && echo "OK"
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
        "matcher": "Bash|mcp__.*__take_screenshot$",
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
codex_hooks = true
```

```jsonc
// .codex/hooks.json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$(git rev-parse --show-toplevel)/hooks/session-start.mjs\" codex",
            "statusMessage": "Checking lattice startup",
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
            "command": "node \"$(git rev-parse --show-toplevel)/hooks/pre-tool-policy.mjs\" codex",
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

### Step 4 — Serena (Optional)

The default `session-start.mjs` provider selection is Serena. Serena adds MCP
server lifecycle and a dashboard. If you want it:

→ Follow [`docs/SERENA-CLIENT-SETUP.md`](docs/SERENA-CLIENT-SETUP.md)

If you want the shared hooks without any provider bootstrap, explicitly disable
providers in the environment that invokes `session-start.mjs`:

- `LATTICE_PROVIDER=none`
- `LATTICE_PROVIDERS=none`

If you add another provider later, `LATTICE_PROVIDERS=<name1>,<name2>` selects
an ordered list and takes precedence over `LATTICE_PROVIDER=<name>`.

---

## Done Criteria (Consumer)

An LLM agent can consider consumer setup **complete** when ALL of these pass:

1. `ls hooks/common.mjs` → file exists
2. `node --check hooks/common.mjs && node --check hooks/session-start.mjs && node --check hooks/pre-tool-policy.mjs` → exits 0
3. The client config file exists at the correct path (see per-client sections above)
4. `printf '{}\n' | env LATTICE_PROVIDER=none node hooks/session-start.mjs <client>` → exits 0
5. The commit-gate smoke test returns `"permissionDecision":"deny"` for `git commit`
6. (If Serena) `curl -sf http://127.0.0.1:<port>/mcp` responds (see SERENA-CLIENT-SETUP.md)

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
# ✓ Node.js >= 18
# ✓ common.mjs parses
# ✓ session-start.mjs parses
# ✓ provider-registry.mjs parses
# ✓ pre-tool-policy.mjs parses
# ✓ commit-checkpoint.mjs parses
# ✓ post-tool-reminder.mjs parses
# ✓ stop-checklist.mjs parses
# ✓ serena/bootstrap.mjs parses
# ✓ serena/dashboard-state.mjs parses
# ✓ serena/mcp-config-guard.mjs parses
# ✓ serena/start-http.mjs parses
# ✓ serena/open-dashboard.mjs parses
# ✓ package.json exports are valid
# (optional) ✓ uvx available — Serena provider ready
# (optional) ⚠ uvx not found — Serena provider unavailable (non-blocking)
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

Provider bootstrap is selected through `provider-registry.mjs` with this
contract:

| Variable | Behaviour |
|----------|-----------|
| _(none set)_ | Default to `serena` |
| `LATTICE_PROVIDER=<name>` | Select one provider |
| `LATTICE_PROVIDERS=<name1>,<name2>` | Select an ordered list; takes precedence |
| `LATTICE_PROVIDER=none` / `LATTICE_PROVIDERS=none` | Disable all providers |

Explicit provider names are validated. Unknown names fail fast with exit code 1.

The current real provider is [Serena](https://github.com/oraios/serena). See
[`docs/SERENA-CLIENT-SETUP.md`](docs/SERENA-CLIENT-SETUP.md) for full
provider setup with per-client endpoints, smoke tests, and troubleshooting.

If you are adding another provider (for example `mcp-local-rag`) and need it to
flow cleanly into consumer repos, use
[`docs/PROVIDER-ROLLOUT.md`](docs/PROVIDER-ROLLOUT.md). That doc covers the full
chain from provider code in `lattice` to submodule upgrades, consumer config,
and rollout validation.

To add a different provider, create a provider subdirectory with a
`bootstrap.mjs` entry point and register it in `provider-registry.mjs`.

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

### `node --check` fails on a hook file

**Cause:** Node.js version too old or file is corrupted/missing.

```bash
node --version
# Must be >= 18. If not, upgrade Node.js.

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
