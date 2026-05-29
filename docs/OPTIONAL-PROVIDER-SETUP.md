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

printf '{}\n' | env LATTICE_REQUIRE_SEMBLE_MCP=1 node hooks/session-start.mjs claude-code
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

### Install RTK Once Per Machine

RTK is a user/global dependency, not project-local state. Do not reinstall RTK
per repo. The project only opts into the Lattice `rtk` provider and may record
`LATTICE_RTK_BIN` / `LATTICE_REQUIRE_RTK` policy.

If `rtk --version` is missing on a developer machine or CI image, install it
from the upstream RTK repo. On macOS, Homebrew is acceptable when it resolves to
the RTK formula:

```bash
brew install rtk
brew info rtk
# => CLI proxy to minimize LLM token consumption
# => https://www.rtk-ai.app/
```

For environments without Homebrew, use the upstream installer:

```bash
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh
```

If the install script is unavailable, use Cargo:

```bash
cargo install --git https://github.com/rtk-ai/rtk rtk
```

### Install ripgrep for RTK rewrites

RTK rewrites many search commands to `rg`. Install ripgrep once per machine and
verify it from the same shell your AI client launches hooks from:

```bash
# Windows
winget install --id BurntSushi.ripgrep.MSVC --exact

# macOS
brew install ripgrep

# Debian / Ubuntu
sudo apt-get update
sudo apt-get install -y ripgrep

# Fedora
sudo dnf install ripgrep

# Arch
sudo pacman -S ripgrep

# Cargo fallback
cargo install ripgrep
```

After installing on Windows, restart already-open terminals so the updated PATH
is visible to Claude Code, Codex, and their hooks.

Verify the binary is on the same PATH used by your AI-client hooks:

```bash
command -v rtk
command -v rg
rtk --version
rg --version
rtk gain
```

On Windows, use `where rtk` and `where rg` for the PATH checks.

If hooks cannot see the binary, set `LATTICE_RTK_BIN` in the project hook
environment to the absolute path from `command -v rtk`.

### Native RTK hooks vs. Lattice RTK provider

RTK also has its own global hook installer. Run this to inspect whether RTK
has patched the installed AI clients on the machine:

```bash
rtk init -g --show
```

If RTK reports that no hook is installed, choose one rewrite layer:

- **Native RTK hook mode:** run the `rtk init -g ...` command suggested by RTK
  for the installed clients. In Lattice-managed repos, leave `--providers rtk`
  off or set `LATTICE_RTK_DISABLED=1` so the same Bash command is not rewritten
  twice.
- **Lattice RTK provider mode:** keep RTK native hooks unpatched and enable the
  Lattice `rtk` provider per repo. Some RTK versions may still print a global
  "No hook installed" reminder; that is RTK's native-hook status, not proof that
  Lattice failed to call `rtk rewrite`.

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

Do not copy `LATTICE_PROVIDER=rtk` or `LATTICE_PROVIDERS=rtk` into project hook
config. Those are isolated smoke-test allowlists and would disable built-ins such
as the commit gate. Normal projects should leave provider allowlists unset and
use `LATTICE_DISABLE=<name>` only when subtracting a provider is intentional.

### Init Shortcut

`init.mjs --write --providers rtk` records the provider choice in the managed
`AGENTS.md` block. It does not install RTK and does not create project-local RTK
state. RTK has no MCP config file because it is a CLI command rewrite provider:

```bash
node hooks/init.mjs --write --clients claude,codex --providers rtk
```
