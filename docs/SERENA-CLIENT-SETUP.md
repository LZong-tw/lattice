# Serena Provider Setup

> **Audience:** LLM agents and developers wiring Serena into a consumer repo.
> Every command is copy-paste ready. Expected output is shown in `# =>` comments.

Serena is an **optional** provider integration shipped with `lattice`. The
shared hook layer works without Serena. You only need this doc if you want
Serena MCP tools plus dashboard lifecycle support.

Important contract:

- AI-client MCP tool attachment must use **stdio** `command` / `args`.
- The managed HTTP server is only for lifecycle and dashboard support.
- Do not configure Serena tools with `url = "http://127.0.0.1:.../mcp"` when
  `LATTICE_REQUIRE_SERENA_MCP=1`; the guard rejects HTTP config because tools
  may attach too late during startup.

---

## Prerequisites

These are **in addition to** the base lattice prerequisites in the root
[README](../README.md#prerequisites).

```bash
python3 --version
# => Python 3.10.x or higher

uvx --version
# => uv-pip x.x.x (any version; provided by https://github.com/astral-sh/uv)
```

**Install if missing:**

```bash
# uv (provides uvx):
curl -LsSf https://astral.sh/uv/install.sh | sh

# Verify after install:
uvx --version
# => uv-pip x.x.x
```

Python 3.10+ must be available as `python3` on PATH. On macOS:
`brew install python@3.12` or use your system Python.

---

## Provider Files

| Package file | Consumer path | Purpose |
|--------------|---------------|---------|
| `serena/bootstrap.mjs` | `hooks/serena/bootstrap.mjs` | Called by `session-start.mjs`; starts the Serena MCP server |
| `serena/cleanup-processes.mjs` | `hooks/serena/cleanup-processes.mjs` | Runs before bootstrap to stop stale orphaned Serena/WebView process trees |
| `serena/start-http.mjs` | `hooks/serena/start-http.mjs` | Shared Serena HTTP starter invoked by per-client launchers |
| `serena/start-http-ide.sh` | `hooks/serena/start-http-ide.sh` | Copilot CLI launcher (port 9121) |
| `serena/start-http-claude-code.sh` | `hooks/serena/start-http-claude-code.sh` | Claude Code launcher (port 9122) |
| `serena/start-http-codex.sh` | `hooks/serena/start-http-codex.sh` | Codex CLI launcher (port 9123) |
| `serena/dashboard-state.mjs` | `hooks/serena/dashboard-state.mjs` | Dashboard URL persistence and lookup |
| `serena/open-dashboard.mjs` | `hooks/serena/open-dashboard.mjs` | Helper to reopen the Serena dashboard |

---

## Per-Client Endpoints

| Client | Launcher script | Port | Managed HTTP endpoint | Serena Context |
|--------|----------------|------|--------------|----------------|
| GitHub Copilot CLI | `serena/start-http-ide.sh` | 9121 | `http://127.0.0.1:9121/mcp` | `ide` |
| Claude Code | `serena/start-http-claude-code.sh` | 9122 | `http://127.0.0.1:9122/mcp` | `claude-code` |
| Codex CLI | `serena/start-http-codex.sh` | 9123 | `http://127.0.0.1:9123/mcp` | `codex` |

---

## MCP Server Lifecycle

`session-start.mjs` delegates to the Serena provider. By default, the provider
first runs `serena/cleanup-processes.mjs` to stop stale orphaned Serena/WebView
process trees, then calls `serena/bootstrap.mjs`, which starts Serena in
streamable HTTP mode through per-client launcher scripts. This is separate from
the stdio MCP tool config below. The shared starter runs:

```bash
uvx --from git+https://github.com/oraios/serena serena start-mcp-server \
  --transport streamable-http --host 127.0.0.1 --port <port> \
  --context <context> --project <consumer-repo-root> \
  --open-web-dashboard false
```

Launchers are **idempotent**: if Serena is already listening on the target port,
the launcher exits 0 without starting a second instance.

The process is **detached** and writes state files to the runtime directory.

### Stale Process Cleanup

The cleanup step is heuristic, not a fixed-age kill switch. It scores each
Serena-like process tree using parent liveness, CPU delta, private memory,
working-set ratio, age, and WebView shape. Active trees are suppressed even when
old; orphaned trees are removed immediately after the short grace window.

Useful switches:

| Variable | Default | Purpose |
|----------|---------|---------|
| `LATTICE_SERENA_CLEANUP=0` | enabled | Disable cleanup before Serena bootstrap. |
| `LATTICE_SERENA_CLEANUP_DRY_RUN=1` | off | Log what cleanup would stop without killing anything. |
| `SERENA_CLEANUP_CPU_SAMPLE_MS` | `1200` | CPU sampling window; set `0` for no second sample. |
| `SERENA_CLEANUP_IDLE_GRACE_HOURS` | `0.25` | Minimum age before idle leak scoring can stop a tree. |
| `SERENA_CLEANUP_ORPHAN_WEBVIEW_GRACE_HOURS` | `0.25` | Minimum age before orphan WebView-only trees are stopped. |
| `SERENA_CLEANUP_HIGH_PRIVATE_MB` | `768` | Private-memory signal threshold. |
| `SERENA_CLEANUP_LOW_WORKING_SET_MB` | `128` | Low working-set signal threshold. |
| `SERENA_CLEANUP_LOW_WORKING_SET_RATIO` | `0.12` | Low working-set/private-memory ratio signal. |
| `SERENA_CLEANUP_IDLE_CPU_SECONDS` | `0.2` | CPU delta considered idle during the sample window. |
| `SERENA_CLEANUP_KILL_SCORE` | `70` | Score required for an old idle tree to be stopped. |

Manual dry-run:

```bash
node hooks/serena/cleanup-processes.mjs --dry-run
```

---

## Setup — Per Client

### Claude Code + Serena

The base hooks config in `.claude/settings.json` (see [README](../README.md#claude-code-config))
already calls `session-start.mjs claude-code`, which triggers Serena bootstrap
automatically.

**Additional MCP config surface** — add Serena as a stdio MCP server so Claude
Code can call Serena tools at startup. The repo-scoped Claude MCP file is
`.mcp.json`:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "serena": {
      "type": "stdio",
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--context",
        "claude-code",
        "--project-from-cwd"
      ]
    }
  }
}
```

If Claude Code does not launch the MCP command from the repo root, replace
`--project-from-cwd` with `--project /absolute/path/to/consumer-repo`.

**Smoke test:**

```bash
echo '{}' | node hooks/session-start.mjs claude-code
# => stderr: "Serena claude is ready at http://127.0.0.1:9122/mcp (PID ...)"
#    OR "Serena already listening on 127.0.0.1:9122 for claude."
#    exit: 0

curl -sf http://127.0.0.1:9122/mcp -o /dev/null && echo "OK" || echo "FAIL"
# => OK

printf '{}\n' | env LATTICE_REQUIRE_SERENA_MCP=1 node hooks/session-start.mjs claude-code
# => exit: 0
```

### GitHub Copilot CLI + Serena

The base hooks config in `.github/hooks/repo-guardrails.json` (see [README](../README.md#github-copilot-cli-config))
already calls `session-start.mjs copilot`, which triggers Serena bootstrap.

**Additional MCP config surface** — Copilot CLI does not currently have a
single repo-scoped MCP file that `lattice` can document as universal. Configure
Serena in the Copilot/IDE MCP surface used by your environment, and point it at:

```text
http://127.0.0.1:9121/mcp
```

In other words: `lattice` owns the launcher and the port, but **not** a
portable repo-local Copilot MCP config file.

**Smoke test:**

```bash
echo '{}' | node hooks/session-start.mjs copilot
# => stderr: "Serena copilot is ready at http://127.0.0.1:9121/mcp (PID ...)"
#    exit: 0

curl -sf http://127.0.0.1:9121/mcp -o /dev/null && echo "OK" || echo "FAIL"
# => OK
```

### Codex CLI + Serena

The base hooks config in `.codex/hooks.json` (see [README](../README.md#codex-cli-config))
already calls `session-start.mjs codex`, which triggers Serena bootstrap.

**Additional MCP config surface** — add Serena as a stdio MCP server to Codex's
repo-scoped `.codex/config.toml`:

```toml
# .codex/config.toml
[features]
hooks = true

[mcp_servers.serena]
command = "uvx"
args = ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server", "--context", "codex", "--project-from-cwd"]
```

If Codex does not launch the MCP command from the repo root, replace
`--project-from-cwd` with `--project /absolute/path/to/consumer-repo`.

**Smoke test:**

```bash
echo '{}' | node hooks/session-start.mjs codex
# => stderr: "Serena codex is ready at http://127.0.0.1:9123/mcp (PID ...)"
#    exit: 0

curl -sf http://127.0.0.1:9123/mcp -o /dev/null && echo "OK" || echo "FAIL"
# => OK

printf '{}\n' | env LATTICE_REQUIRE_SERENA_MCP=1 node hooks/session-start.mjs codex
# => exit: 0
```

---

## Runtime-State Namespace

By default, Serena runtime state is written under:

```text
$XDG_STATE_HOME/<consumer-repo>/serena/
~/.local/state/<consumer-repo>/serena/    (default on Linux/macOS)
```

The `<consumer-repo>` namespace comes from the detected consumer repo root. If
you need to override it, set:

| Variable | Purpose |
|----------|---------|
| `LATTICE_REPO_ROOT` | Override the detected consumer repo root path |
| `LATTICE_STATE_NAMESPACE` | Override the state directory namespace |

Each client writes these files inside the runtime directory:

| File | Content |
|------|---------|
| `<client>.pid` | Process ID of the running Serena server |
| `<client>.log` | Serena server log output |
| `<client>.url` | Dashboard URL (if detected from logs) |

---

## Dashboard Reopen Helper

The Serena dashboard is ephemeral and tied to the server lifecycle. Use the
helper to reopen it on demand:

```bash
node hooks/serena/open-dashboard.mjs          # auto-detect most recent client
node hooks/serena/open-dashboard.mjs claude    # specific client
node hooks/serena/open-dashboard.mjs copilot
node hooks/serena/open-dashboard.mjs codex
node hooks/serena/open-dashboard.mjs --browser # force browser open (Windows override)
```

**Platform behavior:**

| Platform | Default behavior |
|----------|-----------------|
| **Windows** | Serena ships a native tray icon that manages the dashboard window. The helper prints the dashboard URL and instructs you to use Serena's system-tray icon to show the window. It does **not** auto-open a browser. Pass `--browser` to open the raw URL in a browser instead. |
| **macOS** | Opens the dashboard URL in the default browser. Note: Serena's native macOS tray/icon support is **currently disabled upstream** (commented out in Serena source due to tray icon issues), so there is no native tray window to reopen on macOS. |
| **Linux** | Opens the dashboard URL in the default browser. |

> **Note on `OpenDashboardTool` (upstream):** Serena's built-in `OpenDashboardTool`
> opens the default browser on all platforms. It does not reopen a native tray
> window. lattice's helper aligns with this: on Windows it defers to the tray
> icon (which Serena itself controls) rather than silently opening a second
> browser tab.

If the requested client is not running, the helper attempts to start the
matching launcher first.

---

## Done Criteria (Serena)

Serena setup is **complete** when ALL of these pass:

1. `uvx --version` exits 0
2. `echo '{}' | node hooks/session-start.mjs <client>` exits 0 and stderr mentions "ready" or "already listening"
3. `curl -sf http://127.0.0.1:<port>/mcp -o /dev/null` exits 0
4. The MCP config file for your client exists and points to the correct endpoint
   - Claude Code: `.mcp.json`
   - GitHub Copilot CLI: your environment-specific Copilot MCP config
   - Codex CLI: `.codex/config.toml`

---

## Troubleshooting

### `uvx` not found

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
# Then restart your shell or source the profile:
source ~/.bashrc  # or ~/.zshrc
uvx --version
# => uv-pip x.x.x
```

### Serena fails to start — "exited before the HTTP port became ready"

**Cause:** Usually a Python or network issue.

```bash
# Check the log file:
cat ~/.local/state/<consumer-repo>/serena/<client>.log | tail -40
# Look for Python errors, missing dependencies, or port conflicts.

# Common fix — port already in use:
lsof -i :<port>
# If another process holds the port, kill it or change the Serena port.
```

### Port conflict — another Serena instance or service on the same port

```bash
# Check what is using the port:
lsof -i :9122
# => COMMAND  PID  ...

# Kill the conflicting process:
kill <PID>

# Restart:
echo '{}' | node hooks/session-start.mjs claude-code
```

### `curl` to MCP endpoint times out or connection refused

```bash
# 1. Is Serena running?
cat ~/.local/state/<consumer-repo>/serena/<client>.pid
# => Should contain a PID. Check if alive:
kill -0 <pid> 2>/dev/null && echo "alive" || echo "dead"

# 2. If dead, remove stale PID and restart:
rm ~/.local/state/<consumer-repo>/serena/<client>.pid
echo '{}' | node hooks/session-start.mjs <client>

# 3. If alive but curl fails, check the log for binding errors:
tail -20 ~/.local/state/<consumer-repo>/serena/<client>.log
```

### Dashboard URL not found

```bash
# The dashboard URL is extracted from the Serena log. If it is not there:
node hooks/serena/open-dashboard.mjs <client>
# => If this prints "no dashboard URL", Serena may not have emitted it yet.
# Wait a few seconds and retry, or check the log directly:
grep -i dashboard ~/.local/state/<consumer-repo>/serena/<client>.log
```

### Python version too old

```bash
python3 --version
# => Must be 3.10+. If not:
brew install python@3.12   # macOS
# or use pyenv / system package manager
```

---

## Validation

```bash
pnpm test       # vitest test suite (from lattice root)
pnpm run check  # node --check on all entry points
pnpm run doctor # lightweight package health check
```

---

## References

- Serena: <https://github.com/oraios/serena>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- GitHub Copilot CLI hooks: <https://docs.github.com/en/copilot/reference/hooks-configuration>
- Codex hooks: <https://developers.openai.com/codex/hooks>
