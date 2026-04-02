# lattice

General-purpose AI-client hook layer — repo-scoped guardrails and lifecycle hooks
for **Claude Code**, **GitHub Copilot CLI**, and **Codex CLI**.

## Overview

This package provides a consistent, provider-agnostic hook layer that gives
three AI coding clients repo-scoped guardrails and lifecycle hooks. It is
designed to be **independently consumable** — either as a pnpm workspace
package, a git submodule, or a standalone directory copy.

### Structure

| Layer | Location | Purpose |
|-------|----------|---------|
| **General-purpose hooks** | `*.mjs` (package root) | Client-agnostic policy logic shared by all three clients |
| **Provider integration** | `serena/` | Serena-specific lifecycle, launcher, and dashboard scripts |

### Hook scripts

| Script | Behavior |
|--------|----------|
| `session-start.mjs` | Session bootstrap; delegates to provider bootstrap if present |
| `pre-tool-policy.mjs` | Blocks `git commit` via tool-use denial; surfaces commit-checkpoint reminders |
| `commit-checkpoint.mjs` | Dirty-tree detection and checkpoint reminder logic |
| `post-tool-reminder.mjs` | Post-tool-use reminders (screenshot review, edit lessons) |
| `stop-checklist.mjs` | End-of-turn checklist |
| `common.mjs` | Shared utilities used by all hooks |

## Zero dependencies

The hook layer has **no npm dependencies**. It requires only Node.js (≥ 18)
and standard shell utilities. This makes it trivially embeddable.

## Adopting in another repo

### Option A: Git submodule

```bash
git submodule add <repo-url> hooks
# Then wire per-client configs to point at hooks/*.mjs
```

### Option B: Directory copy

```bash
cp -R hooks/ <your-repo>/hooks/
```

### Option C: pnpm workspace dependency

If your project is already a pnpm workspace:

```yaml
# pnpm-workspace.yaml
packages:
  - hooks
```

### Wiring per-client configs

After placing the hooks directory, wire each AI client:

| Client | Config file | Example entry |
|--------|-------------|---------------|
| Claude Code | `.claude/settings.json` | `node "$CLAUDE_PROJECT_DIR"/hooks/session-start.mjs claude` |
| GitHub Copilot CLI | `.github/hooks/repo-guardrails.json` | `node ./hooks/session-start.mjs copilot` |
| Codex CLI | `.codex/hooks.json` | `node "$(git rev-parse --show-toplevel)/hooks/session-start.mjs" codex` |

## Provider integration

The `session-start.mjs` hook delegates to a **provider bootstrap** script if
one exists under a provider subdirectory (e.g., `serena/bootstrap.mjs`).

The current provider is [Serena](https://github.com/oraios/serena).

To add a different provider, create a directory under `<provider>/` with a
`bootstrap.mjs` that `session-start.mjs` can delegate to.

## Validation

```bash
# Syntax-check all hook scripts
pnpm run check

# Run tests
pnpm test
```

## Tests

Tests live in `__tests__/` and cover:

- Commit checkpoint reminder logic
- Serena dashboard state helpers

Repo-integration tests (verifying that consumer config files wire through the
shared scripts) belong in the consuming repository, not here.
