# Codex Plugin Hook Repair

Codex global plugins are installed under `~/.codex/plugins/cache`. Some plugins
ship `hooks/hooks.json` commands that are portable in intent but not portable in
Windows shells. Lattice provides a local compatibility repair so teams do not
need to wait for every upstream plugin to update.

## Command

Preview repairs:

```powershell
lattice repair codex-plugin-hooks
```

Apply repairs:

```powershell
lattice repair codex-plugin-hooks --write
```

Useful options:

```powershell
lattice repair codex-plugin-hooks --codex-home C:\Users\you\.codex
lattice repair codex-plugin-hooks --git-bash "C:\Program Files\Git\bin\bash.exe"
lattice repair codex-plugin-hooks --json
```

## What It Repairs

The command scans `~/.codex/plugins/cache/**/hooks/hooks.json` and updates
`command` fields only.

- Expands literal `${CLAUDE_PLUGIN_ROOT}` placeholders to the concrete plugin
  root path.
- On Windows, rewrites bare `bash ".../hook.sh"` commands to Git Bash when Git
  Bash is installed.
- On Windows, adds `node --no-warnings` for Codex companion lifecycle hooks
  whose Node deprecation warnings are otherwise surfaced as hook UI noise.

It does not edit project hooks, provider code, or plugin source files outside
the hook manifest.

## When To Run It

Run it after installing or updating global Codex plugins, or whenever the Codex
UI reports a plugin hook `exited with code 1` while the repo-local Lattice hooks
smoke clean.

Use dry-run output as the audit trail before applying:

```powershell
lattice repair codex-plugin-hooks
lattice repair codex-plugin-hooks --write
```
