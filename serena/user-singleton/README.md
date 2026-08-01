# Serena user-level HTTP singletons

Machine-wide (user-profile) Serena lifecycle for multi-repo / multi-worktree
machines. This is **complementary** to the repo-scoped launchers in
`serena/start-http*.sh` (ports 9121–9123).

## When to use which

| Mode | Ports | Project binding | Use when |
|------|-------|-----------------|----------|
| Lattice repo launchers | 9121–9123 | Always `repoRoot` | Single checkout, provider-managed |
| **User singleton (this dir)** | pin or 18000–19999 | cwd → registered path / main worktree | Many worktrees, shared Claude/Codex MCP URL |

If Claude/Codex already point at a user singleton (e.g. `http://127.0.0.1:9127/mcp`),
disable the repo launcher with `LATTICE_DISABLE=serena` so you do not run both.

## Resolve policy

See `project-resolve.mjs`:

1. Registered path under `~/.serena/serena_config.yml` (deepest match)
2. Unregistered git worktree → main if main is registered / has `.serena/project.yml`
3. Nearest `.serena/project.yml` for standalone repos

## Install

```bash
node scripts/install-user-singletons.mjs
# or copy this tree to ~/.serena/http-singleton/ and wire MCP (see docs/USER-MCP-SINGLETONS.md)
```

## Commands

```bash
node serena/user-singleton/ensure-from-cwd.mjs --dry-run
node serena/user-singleton/ensure-from-cwd.mjs --project /path/to/repo
```
