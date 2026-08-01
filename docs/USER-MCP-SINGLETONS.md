# User-level MCP singletons (Serena + Semble)

> **Audience:** operators running many checkouts/worktrees on one machine
> (Windows or Unix). Consumer repos that only need per-repo Lattice launchers
> can ignore this doc and follow [SERENA-CLIENT-SETUP.md](./SERENA-CLIENT-SETUP.md)
> / [OPTIONAL-PROVIDER-SETUP.md](./OPTIONAL-PROVIDER-SETUP.md).

## Why this exists

Lattice’s default Serena launchers bind **one port per AI client** (9121–9123)
to **the consumer repo root**. That is correct for a single checkout.

It is the wrong shape when:

- Claude/Codex MCP is configured **once at user scope** (one URL for all sessions)
- You have dozens of git worktrees (e.g. `sugar-wt-*`) and must not spawn a
  Serena tree per worktree or per session
- Semble is launched via per-session `uvx --from semble[mcp] semble` (stdio)
  and multiplies process trees + embedding loads

**User-level HTTP singletons** fix that:

| Service | Default endpoint | Binding |
|---------|------------------|---------|
| Serena | pin or `http://127.0.0.1:18xxx/mcp` | **per registered project** (cwd-lazy) |
| Semble | `http://127.0.0.1:9131/mcp` | **one machine-wide** (tools take `repo=`) |

## Install scripts

From a lattice checkout (or installed package path that includes these files):

```bash
node scripts/install-user-singletons.mjs
```

This copies:

- `serena/user-singleton/*` → `~/.serena/http-singleton/`
- `semble/user-singleton/*` → `~/.semble/http-singleton/`

## Serena: cwd-lazy ensure

```bash
# dry-run resolve
node ~/.serena/http-singleton/ensure-from-cwd.mjs --project /path/to/repo --dry-run

# start if needed
node ~/.serena/http-singleton/ensure-from-cwd.mjs --project /path/to/repo
```

### Worktree policy

1. Path listed in `~/.serena/serena_config.yml` → that path (so an intentionally
   registered worktree can have its own singleton).
2. Unregistered worktree of a registered main → **main** (indexes main tree only).
3. Standalone repo with `.serena/project.yml` → that root.

Pin stable ports in `~/.serena/http-singleton/ports.json`:

```json
{
  "C:\\dev\\sugar-dating": 9127
}
```

### project.yml note

Serena 1.6+ requires `languages:` (list). Older configs with only
`language_servers:` fail with `KeyError: 'languages'`. Rename the key or
regenerate with current Serena.

### Client MCP

Prefer a **stable** loopback URL in user or project MCP config:

```json
{
  "mcpServers": {
    "serena": {
      "type": "http",
      "url": "http://127.0.0.1:9127/mcp"
    }
  }
}
```

For multi-project concurrent use, either:

- pin each main repo to its own port and use project-scoped MCP URLs, or
- use a small stdio bridge that resolves cwd → ensure → `mcp-remote` to that port
  (see your local `serena-stdio-bridge` if installed).

### Lattice provider interaction

If the user singleton owns Serena, **disable the repo launcher**:

```text
LATTICE_DISABLE=serena
```

On Windows hooks, pass through `hook-runner.mjs --env LATTICE_DISABLE=serena`
(not a POSIX env prefix).

`LATTICE_REQUIRE_SERENA_MCP=1` still validates loopback HTTP `/mcp` URLs in the
consumer repo’s `.mcp.json` / `.codex/config.toml`.

## Semble: machine-wide ensure

```bash
node ~/.semble/http-singleton/semble-http-singleton.mjs ensure
node ~/.semble/http-singleton/semble-http-singleton.mjs status
```

Default: `http://127.0.0.1:9131/mcp` (supergateway over stdio Semble).

### Client MCP

```json
{
  "mcpServers": {
    "semble": {
      "type": "http",
      "url": "http://127.0.0.1:9131/mcp"
    }
  }
}
```

```toml
[mcp_servers.semble]
url = "http://127.0.0.1:9131/mcp"
```

Do **not** keep per-repo `uvx --from semble[mcp] semble` stdio entries if the
user singleton is in use — they fight for resources.

`LATTICE_REQUIRE_SEMBLE_MCP=1` accepts:

1. loopback HTTP `/mcp` (preferred), or
2. legacy stdio `uvx --from semble[mcp] semble`, or
3. `node scripts/semble-mcp.mjs`

### Cleanup

`lattice/mcp-cleanup` skips process trees that look like the managed user
singleton (`start-gateway.cmd`, `run-semble-stdio`, `semble-http-singleton`,
supergateway on 9131) so SessionStart cleanup does not kill the shared server.

## Monorepo consumers (e.g. sugar-dating)

**No lattice restructure is required** in the product monorepo when you adopt
user singletons. Recommended shape:

| Layer | Responsibility |
|-------|----------------|
| User profile | HTTP singletons + user MCP URLs + SessionStart ensure |
| sugar-dating `hooks/` | Lattice providers, RTK, serena-enforce policy, worktree gates |
| sugar-dating MCP | Prefer empty / no per-session Semble stdio; rely on user MCP |

Typical env for monorepos that already use an external Serena singleton:

```text
LATTICE_DISABLE=serena
# optional: LATTICE_REQUIRE_SERENA_MCP=1 once .mcp.json has the HTTP url
```

Bump `@lzong.tw/lattice` when you want the updated guards/docs; runtime
behavior of hooks does not require rewiring just because singletons moved
into the lattice package tree.

## SessionStart snippets

Claude user settings (or project settings):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "node \"%USERPROFILE%\\.serena\\http-singleton\\ensure-from-cwd.mjs\""
          },
          {
            "type": "command",
            "command": "node \"%USERPROFILE%\\.semble\\http-singleton\\semble-http-singleton.mjs\" ensure"
          }
        ]
      }
    ]
  }
}
```

Use absolute paths appropriate for your OS. Ensure hooks must exit 0 on skip.

## Related

- [SERENA-CLIENT-SETUP.md](./SERENA-CLIENT-SETUP.md) — repo-scoped launchers (9121–9123)
- [OPTIONAL-PROVIDER-SETUP.md](./OPTIONAL-PROVIDER-SETUP.md) — Semble/RTK opt-in
- `serena/user-singleton/`, `semble/user-singleton/` — source scripts
