# Provider Rollout: `lattice` -> Consumer Repos

> **For the v1 provider API** (definition shape, handlers, merge rules,
> validators, testing helpers, env-var reservations), see
> [`PROVIDER-AUTHORING.md`](PROVIDER-AUTHORING.md). **This document covers
> only the release-and-rollout lifecycle** — how a provider that already
> exists in `lattice` reaches a consumer repo and gets validated end-to-end.

> **Audience:** Maintainers adding a new provider to `lattice` and consumer repos
> that need to adopt it afterwards.
>
> This document explains the full chain:
>
> 1. add a provider inside `lattice` (see `PROVIDER-AUTHORING.md` for the API)
> 2. validate and release the new `lattice` commit
> 3. update the consumer repo's `hooks/` submodule
> 4. wire any provider-specific config/env/docs in the consumer repo
> 5. validate that the consumer repo is actually using the new provider

For the canonical list of `LATTICE_*` env vars (selection, timeouts, built-in
provider settings), see `PROVIDER-AUTHORING.md` § "Reserved env vars". A short
summary lives in `README.md` § "Provider Integration".

---

## What This Document Solves

The general hook layer and the provider layer live in different places:

- `lattice` owns the shared hook runtime and provider implementations
- a consumer repo such as `consumer-repo` owns the repo-specific config, env,
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

1. The `hooks/` mount path (the consumer-side mount) stays stable.
2. Shared hook logic remains provider-agnostic.
3. Provider logic lives under `<provider>/` inside the `lattice` repo
   (which the consumer sees as `hooks/<provider>/` once mounted).
4. Provider setup stays optional; the shared hook layer must still work without
   any single provider — consumers can opt out via `LATTICE_DISABLE=<name>`.
5. Consumer repos only receive the new provider after they update the `hooks/`
   submodule to a commit that contains it.

---

## Phase 1 - Add the Provider in `lattice`

Build the provider against the v1 contract documented in
[`PROVIDER-AUTHORING.md`](PROVIDER-AUTHORING.md). For an in-tree built-in,
the conventional shape is:

| File | Purpose |
|------|---------|
| `<provider>/provider.mjs` | The `LatticeProvider` definition (handlers, optional `validate`, `supportedClients`). |
| `<provider>/*` | Any helpers the provider needs (launchers, state, MCP guards, etc.). |
| `register-builtins.mjs` | Add a `registerProvider(<yourProvider>)` line so it self-registers on import. |
| `package.json` `exports` | Add a `./<provider>/provider` subpath so consumers can import the definition directly. |
| `package.json` `check` script + `doctor.mjs` `entryPoints` | Add the new files so `pnpm run check` and `pnpm run doctor` exercise them. |
| Provider-specific doc | Operator-facing setup and troubleshooting (see `docs/SERENA-CLIENT-SETUP.md` for the shape). |

### Keep the shared layer clean

Do not bury provider-specific assumptions in `common.mjs`,
`pre-tool-policy.mjs`, or other shared entry points unless they are truly
generic.

Good pattern: the provider self-contains its logic under `<provider>/` and
the dispatcher fans events out via `register-builtins.mjs`.

Bad pattern: hard-coded provider-specific branches inside shared entry points
or `common.mjs`.

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

In a consumer repo such as `consumer-repo`, update the `hooks/` submodule to the
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
cd hooks && pnpm run doctor && cd ..
git --no-pager diff --check
```

Expected result:

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

1. In `lattice`, add `mcp-local-rag/provider.mjs` (the v1 `LatticeProvider`
   definition — see [`PROVIDER-AUTHORING.md`](PROVIDER-AUTHORING.md)), any
   helpers it needs (launcher, state, MCP guard), and a provider doc.
2. Add `registerProvider(mcpLocalRagProvider)` to `register-builtins.mjs`
   so the dispatcher picks it up. Built-ins activate by default; consumers
   opt out via `LATTICE_DISABLE=mcp-local-rag`.
3. Validate in `lattice` with:
   - `pnpm run doctor`
   - `pnpm test`
   - `pnpm run check`
   - provider-specific smoke test
4. Commit and push the new `lattice` SHA.
5. In `consumer-repo`, update the `hooks/` submodule to that SHA.
6. Add or adjust any consumer repo surfaces needed by `mcp-local-rag`, such as:
   - `.mcp.json`
   - `.codex/config.toml`
   - Copilot user MCP config
   - `.env.example` / env templates if the provider needs new settings
7. Update `consumer-repo` docs to explain how to enable and validate
   `mcp-local-rag`.
8. Run:
   - `cd hooks && pnpm run doctor`
   - provider-specific smoke tests

Only after steps 5-8 does `consumer-repo` actually "enjoy" the new provider.

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
