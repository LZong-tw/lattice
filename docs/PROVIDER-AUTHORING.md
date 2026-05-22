# Writing a lattice Provider (v1 contract)

> **Audience**: anyone shipping a new provider for `@lzong.tw/lattice` — either
> as an external npm package (e.g. `@your-scope/foo`) or as a new built-in
> inside this repo.

This doc is the contract reference. For the release/rollout flow when
publishing a provider into a consumer repo, see
[`PROVIDER-ROLLOUT.md`](PROVIDER-ROLLOUT.md). For Serena specifics see
[`SERENA-CLIENT-SETUP.md`](SERENA-CLIENT-SETUP.md).

---

## What a provider is

A `LatticeProvider` is a frozen object that declares:

- a unique name (npm package name for external providers; short slug for
  built-ins),
- the contract version it targets (`1` for everything today),
- zero or more event handlers under `handlers`,
- an optional `validate` function (SessionStart-only gate),
- an optional `supportedClients` whitelist.

```javascript
export const myProvider = Object.freeze({
  name: "@my-scope/auth-gate",
  contractVersion: 1,
  supportedClients: Object.freeze(["claude-code", "codex"]), // optional
  handlers: Object.freeze({
    PreToolUse: async (ctx, payload) => { /* ... */ },
    Stop:       async (ctx, payload) => { /* ... */ },
  }),
  validate: async (ctx) => { /* ... */ },  // optional, SessionStart-only
});
```

Register it as a side effect of importing your module:

```javascript
import { registerProvider } from "@lzong.tw/lattice/provider-registry";
import { myProvider } from "./provider.mjs";

registerProvider(myProvider);
```

Consumers then either `import "@my-scope/auth-gate"` directly in their hook
script, or set `LATTICE_EXTRA_PROVIDERS=@my-scope/auth-gate` so
`register-builtins.mjs` dynamically imports it at startup.

---

## Event names

Event keys use Anthropic's canonical PascalCase so `hooks.json` filenames
and lattice `handlers` are 1:1 readable:

| Event | When it fires | Built-in dispatcher in v1? |
|---|---|---|
| `SessionStart` | New Claude / Copilot / Codex session begins | ✅ |
| `PreToolUse` | Before each tool invocation | ✅ |
| `PostToolUse` | After each tool invocation | ✅ |
| `Stop` | Agent declares the turn complete | ✅ |
| `PostCompact` | After context compaction | ✅ |
| `Notification` | Agent needs operator attention | ✅ |
| any other Anthropic event | (future) | ❌ — registration is accepted but inert until a dispatcher ships |

Use `EVENT_NAMES` from `@lzong.tw/lattice/dispatcher` to avoid typos:

```javascript
import { EVENT_NAMES } from "@lzong.tw/lattice/dispatcher";
// EVENT_NAMES.PreToolUse === "PreToolUse"
```

---

## Handler signature

```typescript
type LatticeHandler = (
  ctx: LatticeContext,
  payload: object,
) => Promise<LatticeHandlerResult | void> | LatticeHandlerResult | void;

interface LatticeHandlerResult {
  decision?: "allow" | "deny";              // PreToolUse / PostToolUse
  reason?: string;                          // required when decision === "deny"
  additionalContext?: string;               // Stop / SessionStart
  hookSpecificOutput?: Record<string, unknown>;  // pass-through
  exitCode?: number;                        // non-zero exits the dispatch
}
```

Returning `{}` or `void` is a no-op result. Sync handlers are allowed; async
handlers MUST honor `ctx.signal` for cancellation.

### Result merge rules

The dispatcher invokes every provider's handler for the event in registration
order, then folds the results:

| Field | Merge |
|---|---|
| `decision` | Strictest wins: `"deny"` > `"allow"` > `undefined` |
| `reason` | Bulleted concat (`• provider-name: reason`) in registration order |
| `additionalContext` | Concat with `\n\n` in registration order |
| `hookSpecificOutput` | Shallow merge, last writer wins, **except** `decision: "block"` is sticky |
| `exitCode` | `Math.max` across providers |
| Errors thrown | First error wins; remaining providers for this event are skipped |

Use the exported constants for decision literals:

```javascript
import { PERMISSION_DECISIONS, STOP_DECISIONS } from "@lzong.tw/lattice/dispatcher";
// PERMISSION_DECISIONS.DENY === "deny"
// STOP_DECISIONS.BLOCK === "block"
```

---

## The context object

Every handler invocation receives a fresh, frozen `LatticeContext`:

```typescript
interface LatticeContext {
  readonly client: "claude-code" | "codex" | "copilot-cli";
  readonly contractVersion: 1;
  readonly event: string;                          // PascalCase event name
  readonly cwd: string;                            // process cwd at invocation
  readonly repoRoot: string;                       // resolved consumer repo root
  readonly stateDir: string;                       // per-provider persistent dir
  readonly log: (message: string) => void;         // stderr, prefixed
  readonly env: Readonly<Record<string, string>>;  // frozen env snapshot
  readonly signal: AbortSignal;                    // per-event timeout signal
}
```

- **Always read config from `ctx.env`**, not `process.env`. The dispatcher
  swaps env snapshots in tests.
- **Always read cwd from `ctx.cwd`**, not `process.cwd()`.
- **stateDir is auto-created** under `${XDG_STATE_HOME}/lattice/providers/<name>`.
  Use it for any cross-invocation persistence (counters, cooldowns, caches).
- **log writes to stderr** with a `lattice[<provider>]:` prefix. Do NOT write
  to stdout directly — stdout is reserved for the Anthropic response JSON.

---

## Validators (SessionStart-only)

A `validate` function runs **once per session**, at SessionStart, before any
handlers. It's the right place to enforce required configuration (MCP server
presence, missing env vars, broken files).

```javascript
validate: async (ctx) => {
  if (ctx.env.MY_REQUIRED_FLAG !== "1") return { ok: true };
  const failures = await checkConfig(ctx);
  return failures.length === 0
    ? { ok: true }
    : { ok: false, failures };
}
```

Failure semantics:
- Any provider returning `ok: false` aggregates into a stderr report
- The SessionStart dispatch exits with code 1
- Handlers do NOT run when validators fail

Validators do not run on PreToolUse / PostToolUse / Stop / PostCompact /
Notification. If you want per-event gating, write a handler that short-
circuits with `{ decision: "deny" }` or `{ exitCode: 1 }`.

---

## Per-event timeouts

Every dispatch gets a per-event timeout that drives `ctx.signal`. Defaults
(overridable via env):

| Event | Default | Env override |
|---|---|---|
| `PreToolUse` | 5_000 ms | `LATTICE_TIMEOUT_PRE_TOOL_USE` |
| `PostToolUse` | 5_000 ms | `LATTICE_TIMEOUT_POST_TOOL_USE` |
| `Stop` | 60_000 ms | `LATTICE_TIMEOUT_STOP` |
| `SessionStart` | 30_000 ms | `LATTICE_TIMEOUT_SESSION_START` |
| `PostCompact` | 10_000 ms | `LATTICE_TIMEOUT_POST_COMPACT` |
| `Notification` | 5_000 ms | `LATTICE_TIMEOUT_NOTIFICATION` |
| (any other) | 30_000 ms | `LATTICE_TIMEOUT_DEFAULT` |

On timeout, the dispatcher aborts `ctx.signal`, treats the slow provider as
if it threw an `AbortError`, logs a warning to stderr, and continues with
remaining providers' results.

### Two handler contracts

**Async I/O** (fetch, `child_process.spawn`, `fs/promises`): MUST forward
`ctx.signal` and bail on `AbortError`. Example:

```javascript
async PreToolUse(ctx, payload) {
  const res = await fetch(url, { signal: ctx.signal });
  // ...
}
```

**Sync `spawnSync`-style**: `ctx.signal` cannot interrupt a blocking syscall.
Pass `{ timeout: <ms> }` to `spawnSync` itself, with a value below your
event's budget:

```javascript
Stop(ctx, payload) {
  const r = spawnSync("typecheck", { timeout: 50_000 });  // below 60_000 Stop budget
  // ...
}
```

---

## Client-aware rendering

You don't render the Anthropic response JSON yourself — the dispatcher does
it for you, branching on `ctx.client`. Return a `LatticeHandlerResult` and the
dispatcher renders:

| Event | Claude Code / Codex | GitHub Copilot CLI |
|---|---|---|
| `PreToolUse` / `PostToolUse` | nested `{ hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }` | flat `{ permissionDecision, permissionDecisionReason }` |
| `Stop` / `SessionStart` | `{ additionalContext, hookSpecificOutput? }` | same as Claude (Copilot doesn't have these events) |
| `PostCompact` | `{}` only; use a `SessionStart` compact hook for context re-injection | same as Claude |
| `Notification` and any other | (no stdout) | (no stdout) |

If your provider should never run on a particular client, set
`supportedClients`:

```javascript
supportedClients: Object.freeze(["claude-code"]),  // skipped silently on copilot/codex
```

---

## Testing

`@lzong.tw/lattice/testing` ships three helpers:

```javascript
import { mockContext, runProvider, mockPayload } from "@lzong.tw/lattice/testing";
```

### `runProvider(provider, event, payload, opts?)`

The 90% case. Invokes one provider's handler in isolation, returns the raw
result plus captured stderr.

```javascript
import { runProvider, mockPayload } from "@lzong.tw/lattice/testing";
import { myProvider } from "../provider.mjs";

const { result, stderr } = await runProvider(
  myProvider,
  "PreToolUse",
  mockPayload.preToolUse({
    tool_name: "Edit",
    tool_input: { file_path: "src/index.ts" },
  }),
);

expect(result.decision).toBe("allow");
```

Skips `validate` by default. Pass `{ runValidator: true }` to include it.

### `mockContext(overrides?)`

When you need raw context access — call your handler manually and inspect
state. Always pair with `dispose()` to clean up the temp stateDir.

```javascript
const { ctx, stderr, dispose } = mockContext({
  client: "copilot-cli",
  event: "PreToolUse",
  providerName: "@my-scope/foo",
  env: { MY_CONFIG: "production" },
});
try {
  const result = await myProvider.handlers.PreToolUse(ctx, somePayload);
  // assertions...
} finally {
  dispose();
}
```

### `mockPayload.<event>(overrides?)`

Per-event payload builders matching Anthropic's documented shape. Shallow-
merges overrides onto a sensible default.

```javascript
mockPayload.preToolUse({ tool_name: "Bash", tool_input: { command: "ls" } });
mockPayload.stop({ stop_hook_active: true });
mockPayload.sessionStart({ matcher: "resume" });
```

---

## Worked example: a minimal Stop gate

A provider that blocks Stop if a `BLOCK_STOP` env var is set, otherwise adds
a context line:

```javascript
// provider.mjs
import { STOP_DECISIONS } from "@lzong.tw/lattice/dispatcher";

export const stopGateProvider = Object.freeze({
  name: "@example/stop-gate",
  contractVersion: 1,
  handlers: Object.freeze({
    Stop(ctx, _payload) {
      ctx.log(`stop-gate evaluated; BLOCK_STOP=${ctx.env.BLOCK_STOP ?? "(unset)"}`);
      if (ctx.env.BLOCK_STOP === "1") {
        return {
          hookSpecificOutput: { decision: STOP_DECISIONS.BLOCK },
          additionalContext: "stop-gate refused: BLOCK_STOP=1",
        };
      }
      return { additionalContext: "stop-gate: ok" };
    },
  }),
});
```

```javascript
// index.mjs (registers as side effect of import)
import { registerProvider } from "@lzong.tw/lattice/provider-registry";
import { stopGateProvider } from "./provider.mjs";

registerProvider(stopGateProvider);
```

```javascript
// __tests__/stopGate.test.ts
import { describe, expect, it } from "vitest";
import { runProvider, mockPayload } from "@lzong.tw/lattice/testing";
import { stopGateProvider } from "../provider.mjs";

describe("stop-gate", () => {
  it("blocks when BLOCK_STOP=1", async () => {
    const { result } = await runProvider(
      stopGateProvider,
      "Stop",
      mockPayload.stop(),
      { contextOverrides: { env: { BLOCK_STOP: "1" } } },
    );
    expect(result.hookSpecificOutput?.decision).toBe("block");
  });

  it("passes through when BLOCK_STOP is unset", async () => {
    const { result } = await runProvider(stopGateProvider, "Stop", mockPayload.stop());
    expect(result.additionalContext).toBe("stop-gate: ok");
    expect(result.hookSpecificOutput).toBeUndefined();
  });
});
```

That's the whole shape. Ship it as an npm package, document it, and consumers
can opt in via `LATTICE_EXTRA_PROVIDERS=@example/stop-gate` or by importing it
in their custom hook script.

---

## Naming conventions

| Resource | Convention | Example |
|---|---|---|
| Provider `name` (external) | npm package name | `@my-scope/auth-gate` |
| Provider `name` (built-in) | `lattice/<concern>` slug | `lattice/protection` |
| Provider env vars | `LATTICE_<PROVIDER>_<KEY>` | `LATTICE_AUTH_GATE_TOKEN` |
| Provider stateDir files | freeform under `ctx.stateDir/` | `ctx.stateDir + "/counter.json"` |

## Reserved env vars

This list is the canonical reference for every `LATTICE_*` env var that
`@lzong.tw/lattice` and its built-in providers read at runtime. External
providers must not shadow these names. `README.md` and `PROVIDER-ROLLOUT.md`
include short summaries; this table is the source of truth.

### Core (dispatcher / registry / context)

| Variable | Used by | Purpose |
|---|---|---|
| `LATTICE_PROVIDERS` | `provider-registry.mjs` | Comma-separated ordered allowlist of providers. Takes precedence over `LATTICE_PROVIDER`. Replaces the active set, so unlisted built-ins such as `lattice/protection` and the commit gate do not run. |
| `LATTICE_PROVIDER` | `provider-registry.mjs` | Single-provider allowlist. Superseded by `LATTICE_PROVIDERS`. Also excludes unlisted built-ins. |
| `LATTICE_DISABLE` | `provider-registry.mjs` | Comma-separated denylist subtracted from the active set. Prefer this for normal consumer repos that only need to turn off one provider. |
| `LATTICE_EXTRA_PROVIDERS` | `register-builtins.mjs` | Comma-separated npm specifiers `import()`ed at startup to register external providers. |
| `LATTICE_REPO_ROOT` | `common.mjs`, `context.mjs` | Override the auto-detected consumer repo root. |
| `LATTICE_STATE_NAMESPACE` | `common.mjs` | Override the state directory namespace under `$XDG_STATE_HOME/`. |
| `LATTICE_SESSION_KIND` | `codex-hook-runner.mjs` | Codex SessionStart variant marker (`startup` / `resume`). |
| `LATTICE_TIMEOUT_*` | `timeouts.mjs` | Per-event timeout overrides — see [Per-event timeouts](#per-event-timeouts). |

### Codex runner

| Variable | Used by | Purpose |
|---|---|---|
| `LATTICE_HOOK_TARGET` | `codex-hook-runner.mjs` | Hook script filename the Codex runner should forward stdin to (e.g. `session-start.mjs`, `pre-tool-policy.mjs`). |
| `LATTICE_HOOK_CLIENT` | `codex-hook-runner.mjs` | Client argument passed to the forwarded hook script (typically `codex`). |

### Built-in providers

| Variable | Used by | Purpose |
|---|---|---|
| `LATTICE_VERIFY_ON_STOP` | `lattice/stop-checklist` | Enable the Stop-time verification gate (typecheck/lint). Off by default. |
| `LATTICE_VERIFY_VERBOSE` | `lattice/stop-checklist` | Verbose stderr output during verification. |
| `LATTICE_VERIFY_MAX_STRIKES` | `lattice/stop-checklist` | Override the circuit-breaker threshold for repeated verification failures. |
| `LATTICE_REQUIRE_SERENA_MCP` | `serena` | When set, SessionStart validator fails if `.mcp.json` / `.codex/config.toml` does not declare the Serena stdio MCP entry. |
| `LATTICE_REQUIRE_SEMBLE_MCP` | `semble` | When set, SessionStart validator fails if the Semble stdio MCP entry is missing. Ignored on `copilot-cli`. |

### Naming-convention carve-out

The `LATTICE_VERIFY_*` family predates the v1 `LATTICE_<PROVIDER>_<KEY>`
convention. Strictly applying the convention would rename them to
`LATTICE_STOP_CHECKLIST_VERIFY_*`. We keep the historical `LATTICE_VERIFY_*`
prefix for backwards compatibility — consumer configs and CI runners in the
wild already set these names. Built-in providers may grandfather pre-v1
names; **new providers (built-in or external) must follow
`LATTICE_<PROVIDER>_<KEY>`** so future collisions are mechanically
prevented.

---

## Versioning and breaking changes

- `contractVersion: 1` is the only legal value today. A future
  `contractVersion: 2` would ship alongside v1 for at least one minor
  version with an explicit deprecation period.
- The dispatcher refuses to register a provider whose declared
  `contractVersion` doesn't match what `@lzong.tw/lattice` understands — fail
  fast, no silent skip.
- New optional fields on `LatticeHandlerResult` / `LatticeContext` are
  additive and don't bump the contract version.
- Removing or repurposing existing fields requires a contract bump.

---

## Where to ask

- Bug reports / RFCs / contract proposals → file an issue
- Vulnerabilities → [`SECURITY.md`](../SECURITY.md)
- Contribution workflow → [`CONTRIBUTING.md`](../CONTRIBUTING.md)
- Companion verification provider → [`@lattice/clawback`](https://github.com/lzong-tw/clawback)
