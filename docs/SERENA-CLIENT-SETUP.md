# Serena Provider Setup

This document covers the Serena integration shipped with `lattice`.

Inside the `lattice` repo, provider files live under `serena/`. When mounted in
a consumer repo at `hooks/`, those same files are addressed as
`hooks/serena/*`.

## Provider files

| Package file | Consumer path | Purpose |
|--------------|---------------|---------|
| `serena/bootstrap.mjs` | `hooks/serena/bootstrap.mjs` | Called by `session-start.mjs`; starts the Serena MCP server |
| `serena/start-http.mjs` | `hooks/serena/start-http.mjs` | Shared Serena HTTP starter invoked by per-client launchers |
| `serena/start-http-ide.sh` | `hooks/serena/start-http-ide.sh` | Copilot CLI launcher (port 9121) |
| `serena/start-http-claude-code.sh` | `hooks/serena/start-http-claude-code.sh` | Claude Code launcher (port 9122) |
| `serena/start-http-codex.sh` | `hooks/serena/start-http-codex.sh` | Codex CLI launcher (port 9123) |
| `serena/dashboard-state.mjs` | `hooks/serena/dashboard-state.mjs` | Dashboard URL persistence and lookup |
| `serena/open-dashboard.mjs` | `hooks/serena/open-dashboard.mjs` | Helper to reopen the Serena dashboard |

## MCP server lifecycle

`session-start.mjs` delegates to `serena/bootstrap.mjs`, which starts Serena in
streamable HTTP mode through per-client launcher scripts:

| Client | Launcher script | Port | Endpoint |
|--------|----------------|------|----------|
| GitHub Copilot CLI | `serena/start-http-ide.sh` | 9121 | `http://127.0.0.1:9121/mcp` |
| Claude Code | `serena/start-http-claude-code.sh` | 9122 | `http://127.0.0.1:9122/mcp` |
| Codex CLI | `serena/start-http-codex.sh` | 9123 | `http://127.0.0.1:9123/mcp` |

The shared starter runs the official Serena command:

```bash
uvx --from git+https://github.com/oraios/serena serena start-mcp-server \
  --transport streamable-http --host 127.0.0.1 --port <port>
```

Launchers are idempotent, detach the Serena process, and write logs/PIDs to the
consumer repo's runtime-state directory.

## Runtime-state namespace

By default, Serena runtime state is written under:

```text
$XDG_STATE_HOME/<consumer-repo>/serena
~/.local/state/<consumer-repo>/serena
```

The `<consumer-repo>` namespace comes from the detected consumer repo root. If
you need to override it, set:

- `LATTICE_REPO_ROOT`
- `LATTICE_STATE_NAMESPACE`

Each client writes:

- `<client>.pid`
- `<client>.log`
- `<client>.url`

## Dashboard reopen helper

The Serena dashboard is ephemeral and tied to the server lifecycle. Use the
helper to reopen it on demand:

```bash
node hooks/serena/open-dashboard.mjs
node hooks/serena/open-dashboard.mjs claude
node hooks/serena/open-dashboard.mjs codex
node hooks/serena/open-dashboard.mjs copilot
```

If the requested client is not running, the helper attempts to start the
matching launcher first.

## Validation

```bash
pnpm test
pnpm run check
```

## References

- Serena: <https://github.com/oraios/serena>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- GitHub Copilot CLI hooks: <https://docs.github.com/en/copilot/reference/hooks-configuration>
- Codex hooks: <https://developers.openai.com/codex/hooks>
