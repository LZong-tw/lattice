# clawback adapter — example provider

This directory is a **proof-of-concept** showing how
[clawback](https://github.com/lzong-tw/clawback) would plug into the
lattice v1 provider contract. It exists inside the lattice repo as Phase 3
evidence that the contract can express clawback's full five-hook surface
without modification. The real adapter will live in its own repo,
publishing as `@lattice/clawback`.

The handlers are intentional **stubs**: every one logs what the real
implementation would do and returns the shape the v1 dispatcher expects.
No real file IO, no real linter invocation — those belong in the
production package, where they would call into clawback's existing
`hooks/*.cjs` modules.

## Mapping table

clawback ships five hooks. Each one maps onto a single lattice v1 event
and a single handler return shape:

| clawback hook (file)                      | lattice event  | handler return                                                                               |
|-------------------------------------------|----------------|----------------------------------------------------------------------------------------------|
| `hooks/protect-files.cjs`                 | `PreToolUse`   | `{ decision: "deny", reason }` when path is protected, else `{}`                             |
| `hooks/post-edit.cjs`                     | `PostToolUse`  | `{}` (pure side-effect: format + lint)                                                       |
| `hooks/stop-verify.cjs`                   | `Stop`         | `{ additionalContext }` always; `{ hookSpecificOutput: { decision: "block" } }` on failure   |
| `hooks/post-compact-reinject.cjs`         | `PostCompact`  | `{ additionalContext }` (re-injects git state + gotchas.md)                                  |
| `hooks/notification.cjs`                  | `Notification` | `{}` (pure side-effect: desktop notification)                                                |

All five fit the v1 `LatticeHandlerResult` shape exactly — no contract
extensions needed.

## How a consumer would plug it in

In the consumer's hook entrypoint (e.g. `hooks/pre-tool-policy.mjs`):

```js
import { readJsonStdin } from "lattice/common";
import { dispatch } from "lattice/dispatcher";
import { registerProvider } from "lattice/provider-registry";

// In the real world this would just be:  import "@lattice/clawback";
import { clawbackProvider } from "@lattice/clawback";

registerProvider(clawbackProvider);

const payload = await readJsonStdin();
process.exit(await dispatch("PreToolUse", payload, { client: process.argv[2] }));
```

## How the real `@lattice/clawback` would be packaged

Published as `@lattice/clawback` on npm with:

- `name: "@lattice/clawback"` matching the provider's `name` field
  (required by the v1 contract for external providers).
- An import side-effect that calls `registerProvider(clawbackProvider)`
  so consumers only write `import "@lattice/clawback";` and never have
  to touch the registry directly.
- A `peerDependency` on `lattice` (so the contract version is
  resolved against the consumer's installed core).
- Handler bodies that delegate to the existing `hooks/*.cjs` files,
  preserving clawback's standalone CLI usage.

## Why the stubs return what they return

- **PreToolUse** is the only event where clawback needs to influence
  Claude's tool execution. The v1 dispatcher folds `decision: "deny"`
  into `hookSpecificOutput.permissionDecision`.
- **Stop** uses both rendering channels: `additionalContext` for the
  "verification ran" breadcrumb and `hookSpecificOutput.decision:
  "block"` to short-circuit completion. `CLAWBACK_FORCE_BLOCK=1` is the
  test/demo lever; the real impl derives `block` from subprocess exit
  codes.
- **PostToolUse** and **Notification** are side-effect-only events. The
  v1 dispatcher emits no stdout JSON when the merged result is empty,
  which matches clawback's existing behavior.
- **PostCompact** is the only event with no built-in lattice handlers
  in v1; clawback is the motivating consumer, so this example doubles
  as the canonical PostCompact usage.

## What's intentionally missing

- Real file IO. The stubs are pure and deterministic so the test suite
  runs without touching disk or spawning subprocesses.
- A `validate()` function. Clawback has no required configuration to
  enforce at SessionStart — its hooks degrade gracefully when a stack
  isn't detected.
- A `supportedClients` whitelist. Clawback's hooks are client-agnostic
  (Claude Code, Codex, Copilot CLI all emit the same payload shapes
  lattice normalizes).
