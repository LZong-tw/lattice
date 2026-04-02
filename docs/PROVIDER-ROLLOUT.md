# Provider Rollout: `lattice` -> Consumer Repos

> **Audience:** Maintainers adding a new provider to `lattice` and consumer repos
> that need to adopt it afterwards.
>
> This document explains the full chain:
>
> 1. add a provider inside `lattice`
> 2. validate and release the new `lattice` commit
> 3. update the consumer repo's `hooks/` submodule
> 4. wire any provider-specific config/env/docs in the consumer repo
> 5. validate that the consumer repo is actually using the new provider

---

## Provider Registry Contract

Provider selection is managed by `provider-registry.mjs` at the package root.
`session-start.mjs` delegates to `bootstrapProviders(client)` from that module.

### Environment variables

| Variable | Behaviour |
|----------|-----------|
| _(none set)_ | Default: activates `["serena"]`. Existing behaviour preserved. |
| `LATTICE_PROVIDER=<name>` | Activate a single named provider. |
| `LATTICE_PROVIDERS=<name1>,<name2>` | Activate an ordered list of providers. **Takes precedence over `LATTICE_PROVIDER`.** |
| `LATTICE_PROVIDER=none` (or `off` / `false` / `0`) | Disable all providers. |
| `LATTICE_PROVIDERS=none` | Disable all providers. |

Rules:
- **Default selection stays backward-compatible.** Serena activates by default. If
  `serena/bootstrap.mjs` is absent or fails to import, the session hook still exits
  0 — matching the historical fallback in `session-start.mjs`.
- **Explicit selections fail fast.** If `LATTICE_PROVIDER` or `LATTICE_PROVIDERS` names
  an unknown provider, the hook exits 1 with a clear error message.
- Provider names are case-insensitive. Duplicate names are collapsed while preserving
  the first occurrence.
- Disable tokens (`none`, `off`, `false`, `0`) are case-insensitive. A list made up
  entirely of disable tokens resolves to `[]`; mixed lists keep the real providers.
- Selected providers run in the order listed and stop on the first non-zero exit code.

### Adding a new provider (copy-paste ready)

1. Create `<provider-name>/bootstrap.mjs` with a named export matching the pattern.
2. Register it in `providerRegistry` inside `provider-registry.mjs`:

```js
"mcp-local-rag": {
  name: "mcp-local-rag",
  async bootstrap(client) {
    const { bootstrapMcpLocalRag } = await import("./mcp-local-rag/bootstrap.mjs");
    return bootstrapMcpLocalRag(client);
  },
},
```

3. Expose it in `package.json` exports:

```json
"./mcp-local-rag/bootstrap": "./mcp-local-rag/bootstrap.mjs"
```

4. Add `mcp-local-rag/bootstrap.mjs` to the `entryPoints` array in `doctor.mjs`
   and to the `check` script in `package.json`.
5. Run `pnpm run doctor && pnpm test && pnpm run check` before committing.

---

## What This Document Solves

The general hook layer and the provider layer live in different places:

- `lattice` owns the shared hook runtime and provider implementations
- a consumer repo such as `example-consumer` owns the repo-specific config, env,
  and operational docs

That means adding a provider is never a one-file change. To make a new provider
usable in a consumer repo, the whole chain must stay connected.

---

## System Map

```text
provider code in lattice
  -> lattice docs + validation
  -> new lattice commit pushed
  -> consumer repo updates hooks/ submodule
  -> consumer repo wires provider-specific config/env/docs
  -> consumer repo validates linkage + provider smoke tests
```

If any one step is skipped, the consumer repo does not fully "get" the new
provider.

---

## Core Rules

Before adding a new provider, keep these invariants intact:

1. The `hooks/` mount path stays stable.
2. Shared hook logic remains provider-agnostic.
3. Provider logic lives under `hooks/<provider>/`.
4. Provider setup stays optional; the shared hook layer must still work without
   that provider.
5. Consumer repos only receive the new provider after they update the `hooks/`
   submodule to a commit that contains it.

---

## Phase 1 - Add the Provider in `lattice`

Create a provider directory under the hook root:

```text
hooks/<provider>/
```

Typical files:

| File | Purpose |
|------|---------|
| `hooks/<provider>/bootstrap.mjs` | Entry point called from `session-start.mjs` or a provider registry |
| `hooks/<provider>/start-*.mjs` / `*.sh` | Launch or transport helpers |
| `hooks/<provider>/state-*.mjs` | Runtime state helpers, logs, PID tracking, URLs |
| `hooks/<provider>/README` or doc entry | Provider-specific setup and troubleshooting |

### Keep the shared layer clean

Do not bury provider-specific assumptions in `common.mjs`, `pre-tool-policy.mjs`,
or other shared entry points unless they are truly generic.

Good pattern:

```text
session-start.mjs
  -> provider bootstrap selection
  -> hooks/<provider>/bootstrap.mjs
```

Bad pattern:

```text
common.mjs
  -> hard-coded provider-specific branches
  -> consumer repo assumptions
```

### If you are adding a second provider

Today `lattice` ships Serena as the current provider. If you add another
provider such as `mcp-local-rag`, do not rely on "the provider" still meaning a
single thing forever.

Before rollout, make provider selection explicit in `lattice`, for example via:

- a provider registry
- an enable-list
- a documented environment variable contract
- per-client bootstrap selection logic

Without an explicit selection contract, a second provider will be hard to roll
out safely across consumer repos.

---

## Phase 2 - Validate the New Provider in `lattice`

Run the package-level checks first:

```bash
cd /path/to/lattice
pnpm run doctor
pnpm test
pnpm run check
```

Expected result:

- `doctor: all checks passed`
- Vitest passes
- `pnpm run check` exits 0

If your provider launches a local service, also add provider-specific smoke
tests to its doc. For example:

```bash
echo '{}' | node hooks/<provider>/bootstrap.mjs
curl -sf http://127.0.0.1:<port>/<path> -o /dev/null && echo "OK"
```

Only move on after the standalone repo works by itself.

---

## Phase 3 - Release the New `lattice` Commit

Once the provider works in `lattice`:

1. commit the provider changes in `lattice`
2. push them to the `lattice` remote
3. note the new commit SHA that consumer repos must adopt

At this point, the provider exists in `lattice`, but consumer repos still do not
use it yet.

---

## Phase 4 - Update the Consumer Repo

In a consumer repo such as `example-consumer`, update the `hooks/` submodule to the
new `lattice` commit:

```bash
cd /path/to/consumer-repo
git -C hooks fetch origin
git -C hooks checkout <new-lattice-sha>
git add hooks
```

That updates the hook layer itself, but the consumer repo may still need
provider-specific wiring.

### Shared hook wiring usually does not change

These files normally stay pointed at the same shared entry points:

- `.claude/settings.json`
- `.github/hooks/repo-guardrails.json`
- `.codex/hooks.json`

If the new provider only changes bootstrap behavior behind `session-start.mjs`,
the shared hook wiring may remain unchanged.

### Consumer repo changes that may still be required

You must inspect whether the new provider needs any of these:

| Consumer concern | Typical files |
|------------------|---------------|
| Claude MCP endpoint | `.mcp.json` |
| Codex MCP endpoint / feature flags | `.codex/config.toml` |
| Copilot MCP registration | external user-managed Copilot MCP config |
| New env variables | `.env.example`, package env templates |
| New troubleshooting / operator guidance | consumer docs |

If the provider is optional, the consumer repo docs must say so explicitly.

---

## Phase 5 - Validate the Consumer Repo

After bumping the submodule and updating provider-specific config/docs, run the
consumer checks:

```bash
cd /path/to/consumer-repo
node scripts/validate-lattice-linkage.mjs
cd hooks && pnpm run doctor && cd ..
git --no-pager diff --check
```

Expected result:

- `lattice linkage OK`
- `doctor: all checks passed`
- `git diff --check` prints nothing

Then run provider-specific smoke tests from the consumer repo. For a local HTTP
provider, that usually means:

```bash
echo '{}' | node hooks/session-start.mjs <client>
curl -sf http://127.0.0.1:<port>/<path> -o /dev/null && echo "OK"
```

If the provider needs consumer env/config, validate those exact surfaces too.

---

## Worked Example: Adding `mcp-local-rag`

If you add `mcp-local-rag` later, the clean rollout path is:

1. In `lattice`, add `hooks/mcp-local-rag/`
   - bootstrap entry point
   - launch helpers
   - state helpers if needed
   - provider doc
2. Make provider selection explicit if Serena and `mcp-local-rag` can both exist.
3. Validate in `lattice` with:
   - `pnpm run doctor`
   - `pnpm test`
   - `pnpm run check`
   - provider-specific smoke test
4. Commit and push the new `lattice` SHA.
5. In `example-consumer`, update the `hooks/` submodule to that SHA.
6. Add or adjust any consumer repo surfaces needed by `mcp-local-rag`, such as:
   - `.mcp.json`
   - `.codex/config.toml`
   - Copilot user MCP config
   - `.env.example` / env templates if the provider needs new settings
7. Update `example-consumer` docs to explain how to enable and validate
   `mcp-local-rag`.
8. Run:
   - `node scripts/validate-lattice-linkage.mjs`
   - `cd hooks && pnpm run doctor`
   - provider-specific smoke tests

Only after steps 5-8 does `example-consumer` actually "enjoy" the new provider.

---

## Done Criteria

A provider rollout is complete only when all of these are true:

1. The provider exists and is documented in `lattice`.
2. `lattice` validation passes.
3. The new `lattice` commit is pushed.
4. The consumer repo's `hooks/` submodule points at that commit.
5. Any provider-specific consumer config/env/docs are updated.
6. Consumer linkage validation passes.
7. Provider smoke tests pass from the consumer repo.

If any item is missing, the rollout is incomplete.
