# Optional Provider Setup

> **Audience:** LLM agents and developers enabling Semble or RTK in a consumer
> repo. Run these commands from the consumer repo root after `hooks/` is mounted.

The base Lattice hook layer works without these providers. Enable them only when
the repo needs the behavior, and set `LATTICE_REQUIRE_*` flags only after the
matching smoke tests pass.

---

## Semble MCP

Semble provides code-search MCP tools. It supports Claude Code and Codex. It is
not used for GitHub Copilot CLI.

### Claude Code

Add or merge this into the repo-scoped `.mcp.json`:

```jsonc
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

Smoke test:

```bash
uvx --version
# => exits 0

printf '{}\n' | env LATTICE_REQUIRE_SEMBLE_MCP=1 node hooks/session-start.mjs claude
# => exit: 0
```

### Codex CLI

Add or merge this into `.codex/config.toml`:

```toml
[mcp_servers.semble]
command = "uvx"
args = ["--from", "semble[mcp]", "semble"]
```

Smoke test:

```bash
uvx --version
# => exits 0

printf '{}\n' | env LATTICE_REQUIRE_SEMBLE_MCP=1 node hooks/session-start.mjs codex
# => exit: 0
```

### Init Shortcut

`init.mjs --write --providers semble` writes the Claude and Codex Semble MCP
entries for selected clients:

```bash
node hooks/init.mjs --write --clients claude,codex --providers semble
```

---

## RTK Command Rewrite

[RTK](https://github.com/rtk-ai/rtk) is not an MCP server. The Lattice `rtk`
provider runs on Claude/Codex `PreToolUse` Bash commands and delegates command
rewrites to:

```bash
rtk rewrite '<command>'
```

Default behavior is fail-open:

- If `rtk` is missing, times out, or returns no rewrite, the original command runs.
- `git commit` commands are never rewritten; the Lattice commit gate remains the
  source of truth.
- `RTK_DISABLED=1 <command>` skips one command.
- `LATTICE_RTK_DISABLED=1` skips the provider for the whole hook environment.
- `LATTICE_REQUIRE_RTK=1` makes startup fail if `rtk --version` does not pass.

Useful environment knobs:

```bash
LATTICE_RTK_BIN=/opt/homebrew/bin/rtk
LATTICE_RTK_TIMEOUT_MS=2000
LATTICE_REQUIRE_RTK=1
```

Smoke tests:

```bash
rtk --version
# => exits 0

printf '{}\n' | env LATTICE_REQUIRE_RTK=1 node hooks/session-start.mjs codex
# => exit: 0

echo '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' \
  | env LATTICE_PROVIDER=rtk node hooks/pre-tool-policy.mjs codex
# => exits 0; may return updatedInput.command when RTK chooses a rewrite
```

### Init Shortcut

`init.mjs --write --providers rtk` records the provider choice in the managed
`AGENTS.md` block. RTK has no MCP config file because it is a CLI command
rewrite provider:

```bash
node hooks/init.mjs --write --clients claude,codex --providers rtk
```
