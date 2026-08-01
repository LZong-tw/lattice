# Semble user-level HTTP singleton

Machine-wide Semble MCP (one process for all repos). Official Semble is
stdio-only; this wraps it with `supergateway` streamable-HTTP.

Default endpoint: `http://127.0.0.1:9131/mcp`

## Why not per-session `uvx semble`?

Each client session that launches `uvx --from semble[mcp] semble` spawns a full
process tree and reloads the embedding model. One HTTP singleton shares the
on-disk index cache under `%LOCALAPPDATA%\semble\Cache` (Windows).

Semble tools take `repo` as an argument — **one** singleton serves every project.

## Install

```bash
node scripts/install-user-singletons.mjs
```

Then point Claude/Codex at the HTTP URL (see `docs/USER-MCP-SINGLETONS.md`).

## Commands

```bash
node semble/user-singleton/semble-http-singleton.mjs ensure
node semble/user-singleton/semble-http-singleton.mjs status
node semble/user-singleton/semble-http-singleton.mjs stop
```

After install, the live copy lives under `~/.semble/http-singleton/`.
