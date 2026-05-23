# `lattice/lessons` — manage accumulating prose rules

## The problem this solves

Most non-trivial repos eventually accumulate a long list of "lessons learned" —
gotchas, anti-patterns, post-incident write-ups — usually living in a single
`CLAUDE.md` or `AGENTS.md`. The list grows monotonically because each lesson
is cheap to add but expensive to retire, and after a few months:

- The file is so long that AI agents (and humans) stop reliably reading every
  rule before acting.
- Rules that **could** be enforced by a regex/audit/hook stay as prose forever
  because nobody promotes them.
- Domain-specific rules (RBAC, frontend, infra) drown the cross-cutting ones
  (security, naming, commit conventions).
- New lessons get repeatedly re-discovered because the existing rule didn't
  surface at the right moment.

`lattice/lessons` is a four-layer system that fights this with progressively
stronger nudges, all opt-in by config.

## The four layers

| Layer | Event | Force | When it fires |
|---|---|---|---|
| **1. Write-gate** | `PreToolUse` (Bash `git commit`) | Blocks the commit | `writeGate.enabled: true` AND staged files touch `watchPaths` AND no `requireDocsUpdate` path edited AND no `bypassToken` in commit message |
| **2. Resurface** | `PostToolUse` (Edit/Write/MultiEdit) | Prints reminder | Touched file matches `domains[].match` AND (no `trigger` configured OR file content matches `trigger`) |
| **3. Size-check** | `Stop` | Prints warning | Root doc > `cap.lines` lines OR > `cap.bullets` top-level `- **…**` bullets |
| **4. Audits** | CLI / cron | Suggests action | `reorganize-audit.mjs` + `promote-audit.mjs` run on demand or from CI |

Default behaviour with **zero config**: only Layer 3 (size-check) fires, and
only when your root `CLAUDE.md` has grown past 700 lines / 130 bullets.
Adding `lattice/lessons` to your registry is always safe — every intrusive
behaviour is opt-in.

## Install

```bash
pnpm add @lzong.tw/lattice
```

The provider is auto-registered by `@lzong.tw/lattice/register-builtins`.
If you assemble your own registry, import and register it explicitly:

```js
import { registerProvider } from "@lzong.tw/lattice/provider-registry";
import { lessonsProvider } from "@lzong.tw/lattice/lessons/provider";

registerProvider(lessonsProvider);
```

## Configure

Drop one of (precedence top→bottom):

1. `LATTICE_LESSONS_CONFIG=/abs/path/to/lessons.json`
2. `<repoRoot>/.lattice/lessons.config.json`
3. `<repoRoot>/lattice.config.json` with a top-level `lessons` key

Example with every field populated:

```json
{
  "rootDoc": "CLAUDE.md",
  "cap": { "lines": 700, "bullets": 130 },
  "domains": [
    {
      "name": "RBAC / Auth / Impersonation",
      "match": "packages/backend/src/(rbac|auth|admin/impersonation)",
      "doc": "packages/backend/src/rbac/CLAUDE.md",
      "trigger": "\\b(AdminGuard|JwtAuthGuard|@RequirePermission|isAdminRole)\\b"
    },
    {
      "name": "Frontend",
      "match": "packages/frontend/src",
      "doc": "packages/frontend/CLAUDE.md"
    }
  ],
  "auditScopes": [
    "CLAUDE.md",
    "packages/backend/CLAUDE.md",
    "packages/backend/src/rbac/CLAUDE.md",
    "packages/frontend/CLAUDE.md"
  ],
  "writeGate": {
    "enabled": false,
    "watchPaths": ["^packages/(backend|frontend)/src/"],
    "requireDocsUpdate": ["CLAUDE.md$", "^docs/"],
    "bypassToken": "[no-decision]"
  }
}
```

### Field reference

| Field | Type | Default | Purpose |
|---|---|---|---|
| `rootDoc` | string | `"CLAUDE.md"` | The top-level lessons file. Path is repo-relative. |
| `cap.lines` | number | `700` | Soft cap for total lines in `rootDoc`. Triggers Stop warning. |
| `cap.bullets` | number | `130` | Soft cap for `^- \*\*` bullets in `rootDoc`. |
| `domains[].name` | string | — | Human label, surfaced in the reorganize-audit report. |
| `domains[].match` | string (regex) | — | Applied to repo-relative paths (forward-slash normalised). Files matching this trigger a Layer 2 reminder. |
| `domains[].doc` | string | — | Path to the per-domain doc the reminder points to. |
| `domains[].trigger` | string (regex, optional) | — | Narrows Layer 2: file contents must also match this regex. Useful for broad `match` patterns. |
| `auditScopes` | string[] | `["CLAUDE.md"]` | Files scanned by `promote-audit.mjs`. |
| `writeGate.enabled` | boolean | `false` | Master switch for Layer 1. |
| `writeGate.watchPaths` | string[] (regex) | `[]` | Staged files matching any of these are considered "code that should have a lesson decision". |
| `writeGate.requireDocsUpdate` | string[] (regex) | `["CLAUDE.md", "docs/"]` | At least one staged file must match one of these for the commit to pass. |
| `writeGate.bypassToken` | string | `"[no-decision]"` | Substring that, when present in the commit message, bypasses the gate. |

## Recipes

### Husky pre-commit (Layer 3 mirrored to commit-time)

Run the same size-check in pre-commit so the warning appears immediately when
you commit a new lesson, not only at the next Claude Code turn end:

```sh
# .husky/pre-commit
node node_modules/@lzong.tw/lattice/lessons/size-check.mjs 2>/dev/null || true
```

The script exits 0 unconditionally — never blocks the commit.

### GitHub Actions: push-triggered audit (cheaper than weekly cron)

A cron that fires on a fixed schedule wastes runner minutes during quiet
weeks. Trigger on `CLAUDE.md` changes instead:

```yaml
name: Lessons Audit
on:
  push:
    paths:
      - 'CLAUDE.md'
      - '**/CLAUDE.md'
  workflow_dispatch: {}

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: pnpm i --frozen-lockfile

      # `gh issue create --label` requires the label to already exist
      # in the repo. `gh label create --force` is idempotent (creates
      # if missing, updates color/description otherwise) so the first
      # workflow run on a fresh repo doesn't fail with
      # "could not add label: 'lessons-audit' not found".
      - env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
        run: |
          gh label create lessons-audit \
            --color "0e8a16" \
            --description "Weekly lessons-doc reorganize/promote audit tracking" \
            --force

      - run: node node_modules/@lzong.tw/lattice/lessons/reorganize-audit.mjs > /tmp/reorg.md
      - run: node node_modules/@lzong.tw/lattice/lessons/promote-audit.mjs > /tmp/promote.md
      - env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        # CRITICAL: use --body-file, NEVER unquoted heredoc with substitution.
        # Lesson markdown contains backticks and $VAR-like fragments
        # ($setOnInsert, $inc, etc.) that bash will try to expand or
        # command-substitute. See "shell-injection trap" below.
        run: |
          {
            echo "## Reorganize audit"; echo; cat /tmp/reorg.md; echo
            echo "---"; echo; echo "## Promote audit"; echo; cat /tmp/promote.md
          } > /tmp/body.md
          gh issue create --title "Lessons Audit — $(date -u +%F)" \
            --body-file /tmp/body.md --label lessons-audit
```

### Optional Stop-hook chain (zero extra config needed)

The provider already handles the Stop event when it is in your registry —
no extra wiring required. You only need a hook chain entry if you want to
run **other** scripts at Stop and route through the same lifecycle.

### Opt into the write-gate

In `.lattice/lessons.config.json`:

```json
{
  "writeGate": {
    "enabled": true,
    "watchPaths": ["^src/", "^packages/[^/]+/src/"],
    "requireDocsUpdate": ["^CLAUDE.md$", "^docs/", "/CLAUDE.md$"],
    "bypassToken": "[no-decision]"
  }
}
```

Now any `git commit` from a Claude Code session that touches source code
without also editing a docs file (or carrying `[no-decision]`) is blocked
with a clear reason. Commits made directly from the terminal (outside the
hooked AI client) are unaffected — the gate runs inside `PreToolUse`.

## The shell-injection trap (why `--body-file` matters)

Lesson markdown reliably contains characters that bash treats as syntax:

- Backticks (`` `foo` ``) → command substitution.
- `$VAR` and `${VAR}` (e.g. `$setOnInsert`, `$inc` in MongoDB-flavoured
  lessons) → variable expansion.
- `!` in `!important` → history expansion in interactive bash.

Both of the following are **broken** and will corrupt issue bodies or fail
outright on the first cron run:

```sh
# BAD: unquoted heredoc — substitutes $VARS and command-runs backticks
BODY=$(cat <<EOF
$REPORT
EOF
)
gh issue create --body "$BODY"
```

```js
// BAD: even with JSON.stringify, the assembled string still goes through
// shell parsing because of the surrounding execSync.
execSync(`gh issue create --body ${JSON.stringify(body)}`);
```

The fix in both cases is the same: **write the body to a file, pass it
through an argv array** so no shell ever parses it.

```js
// GOOD: argv form via execFileSync — bypasses shell entirely
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const bodyFile = resolve(tmpdir(), `body-${Date.now()}.md`);
writeFileSync(bodyFile, body, "utf8");
execFileSync("gh", ["issue", "create", "--title", title, "--body-file", bodyFile, "--label", label]);
```

```sh
# GOOD: quoted heredoc disables expansion AND argv-style --body-file
cat > /tmp/body.md <<'EOF'
$setOnInsert is bad — use $set with the query-key extracted.
EOF
gh issue create --title "..." --body-file /tmp/body.md
```

`promote-audit.mjs` ships the safe pattern by default; the GitHub Actions
recipe above mirrors it. Both are conservative on purpose — the cost of
defensive argv is zero, the cost of a corrupted first cron run is a public
issue with broken text.

### A second first-run trap: missing labels

`gh issue create --label X` **fails** if label `X` doesn't already exist
in the repo. The error (`could not add label: 'X' not found`) only
surfaces on the first workflow run, after which a human has to either
create the label or strip `--label` from the script. `promote-audit.mjs`
ships an idempotent `gh label create … --force` call (cached per
process) before any issue-creation attempt, and the GitHub Actions
recipe above does the same. Adopt this pattern in any script that
references a label you might not have manually created yet.

## How the four layers compose

The layers are deliberately ordered from **strongest** (write-gate, blocks)
to **weakest** (audit reports, advisory). You opt in from weakest to
strongest as your tolerance for false positives matures:

1. **Day 1**: add `lattice/lessons` to your registry, get Layer 3 size-check.
   Costs nothing, surfaces growth.
2. **After a few weeks**: define 2–3 `domains[]` to get Layer 2 resurface.
   The reminders are advisory only — no risk of blocked commits.
3. **After the first reorganize-audit run**: trust the heuristic enough to
   wire it into CI (Layer 4).
4. **When you're confident**: flip `writeGate.enabled` to `true` to enforce
   the decision-with-every-code-change rule.

You can also stop at any layer. Layer 3 alone is already useful on its own.

## What stays in your repo vs what's in lattice

| In `@lzong.tw/lattice/lessons` (universal) | In your repo (project-specific) |
|---|---|
| Hook scripts, audit scanners, write-gate logic | Your lesson **content** (`CLAUDE.md` and per-domain files) |
| Config schema, defaults | Your `domains[]`, `watchPaths`, `requireDocsUpdate` |
| Built-in heuristics (`MUST`/`NEVER`/Case: PR #N) | Your decision on whether a candidate is genuinely promotable |
| Shell-safe issue creation (`--body-file`) | Your `gh issue create` workflow (or none) |

If lattice is ever removed from your repo, the only thing you keep is the
content. Everything else regenerates from config.
