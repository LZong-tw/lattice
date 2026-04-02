# lattice

`lattice` is a repo-scoped AI client runtime layer: shared hook entry points,
policy gates, lifecycle reminders, and provider integrations for
**Claude Code**, **GitHub Copilot CLI**, and **Codex CLI**.

This repo is designed to be mounted into a consuming repo at a stable path such
as `hooks/`.

## Layout

| Layer | Location | Purpose |
|-------|----------|---------|
| Shared runtime | `*.mjs` | Client-agnostic hook entry points and policy logic |
| Provider integration | `serena/` | Serena-specific lifecycle, launcher, and dashboard helpers |
| Tests | `__tests__/` | Package-level runtime and provider contracts |
| Docs | `docs/` | Provider details and consumer guidance |

## Consumer path contract

Inside this repo, scripts live at the package root:

- `session-start.mjs`
- `pre-tool-policy.mjs`
- `commit-checkpoint.mjs`
- `post-tool-reminder.mjs`
- `stop-checklist.mjs`
- `serena/bootstrap.mjs`

When mounted inside a consumer repo at `hooks/`, clients execute those same
files through consumer-facing paths like:

- `hooks/session-start.mjs`
- `hooks/pre-tool-policy.mjs`
- `hooks/serena/open-dashboard.mjs`

Keeping that `hooks/` mount path stable is the main compatibility contract.

## Recommended consumption

### Git submodule

```bash
git submodule add <repo-url> hooks
git submodule update --init --recursive
```

### Directory copy

```bash
cp -R lattice/ <your-repo>/hooks/
```

If you copy instead of using a submodule, keep the destination path as `hooks/`
so existing config commands remain valid.

## Client-agnostic quick start

If you want the fastest setup path without committing to any provider yet, use
this baseline flow:

1. Mount `lattice` at `hooks/` in your repo.
2. Wire your client to the two shared entry points first:
   - `hooks/session-start.mjs <client>`
   - `hooks/pre-tool-policy.mjs <client>`
3. Add richer lifecycle hooks only if your client supports them:
   - `hooks/post-tool-reminder.mjs <client>`
   - `hooks/stop-checklist.mjs <client>`
4. Treat provider integration as optional. The shared layer works without
   Serena; a provider only becomes necessary when you want session services such
   as MCP startup or dashboard helpers.
5. Validate the mounted package:

```bash
node --check hooks/common.mjs
node --check hooks/session-start.mjs
node --check hooks/pre-tool-policy.mjs
```

The only hard compatibility rule is that the mounted path stays `hooks/`, so the
same client commands keep working across repos.

## Wiring per client

| Client | Config file | Example entry |
|--------|-------------|---------------|
| Claude Code | `.claude/settings.json` | `node "$CLAUDE_PROJECT_DIR"/hooks/session-start.mjs claude` |
| GitHub Copilot CLI | `.github/hooks/repo-guardrails.json` | `node ./hooks/session-start.mjs copilot` |
| Codex CLI | `.codex/hooks.json` | `node "$(git rev-parse --show-toplevel)/hooks/session-start.mjs" codex` |

Start every client with `session-start.mjs` and `pre-tool-policy.mjs`. Treat
`post-tool-reminder.mjs` and `stop-checklist.mjs` as optional per-client extras,
not as part of the minimum contract.

## State and consumer-root detection

`lattice` auto-detects the consuming repo root when it is mounted at `hooks/`.
That repo name becomes the default runtime-state namespace under
`$XDG_STATE_HOME/<repo-name>/...`.

You can override detection when needed:

- `LATTICE_REPO_ROOT`
- `LATTICE_STATE_NAMESPACE`

## Provider integration

The current provider is [Serena](https://github.com/oraios/serena). See
[`docs/SERENA-CLIENT-SETUP.md`](docs/SERENA-CLIENT-SETUP.md) for provider
details and dashboard behavior.

To add a different provider, create a provider subdirectory with a
`bootstrap.mjs` entry point that `session-start.mjs` can delegate to.

## Validation

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run check
```

## Tests

Tests cover:

- Commit checkpoint reminder behavior
- Hook policy entry-point behavior
- Serena runtime state helpers
