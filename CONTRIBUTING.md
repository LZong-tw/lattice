# Contributing to lattice

Thanks for your interest. lattice is a small, opinionated runtime layer for
AI client hooks. Contributions are welcome — please read this guide first so
your change has the best chance of landing quickly.

## Code of Conduct

This project adopts the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md).
By participating you agree to abide by its terms.

## Before you start

For non-trivial changes, **open an issue first** describing:
- What problem you're solving
- The shape of the change (new provider? contract change? builtin tweak?)
- Whether it would land in `@lzong.tw/lattice` or as a separate provider package

Contract changes (anything modifying `lattice.d.ts`, `dispatcher.mjs`,
`provider-registry.mjs`, `context.mjs`, `client-enum.mjs`, `timeouts.mjs`) are
held to a higher bar because they affect every downstream provider. Expect
the maintainers to push back on additions that aren't load-bearing.

## Development setup

```bash
git clone https://github.com/lzong-tw/lattice.git
cd lattice
corepack enable && corepack prepare pnpm@latest --activate
pnpm install --frozen-lockfile
pnpm test
pnpm run check
```

Node 18+ is required.

## What goes in `@lzong.tw/lattice` vs your own package

**In core**: things every consumer needs — the dispatcher, the contract,
the built-in protection / commit-gate / reminders / Serena / Semble providers.

**In your own package**: domain-specific providers (verification gates,
custom notifications, project-specific guardrails). Ship them as
`@your-scope/your-provider` and have users opt in via
`LATTICE_EXTRA_PROVIDERS=@your-scope/your-provider` or via direct
`import "@your-scope/your-provider"` in their custom hook script. See
[`docs/PROVIDER-AUTHORING.md`](docs/PROVIDER-AUTHORING.md) for the contract.

## Pull request checklist

- [ ] `pnpm test` passes (run with sandbox disabled if you hit
      `Operation not permitted` on git-template fixtures)
- [ ] `pnpm run check` passes (syntax check on every entry point)
- [ ] New code has tests in `__tests__/`
- [ ] Public API changes update `lattice.d.ts`
- [ ] Behavior changes update the relevant doc
      (`README.md`, `docs/PROVIDER-AUTHORING.md`, or `docs/PROVIDER-ROLLOUT.md`)
- [ ] No `company` / `internal` / internal-only strings in the diff
      (the `hookPolicyContracts.test.ts` source-grep assertions enforce this)
- [ ] Commit message describes the *why* in one or two sentences

## Test scope

Tests live in `__tests__/`. Three layers:

1. **Unit tests** — pure functions, pure providers. Use the
   `@lzong.tw/lattice/testing` helpers (`mockContext`, `runProvider`,
   `mockPayload`). Most provider work belongs here.
2. **Dispatcher tests** — `dispatcher.test.ts` covers merge rules, validator
   semantics, client-aware rendering, timeout handling. Anything that changes
   dispatch behavior needs a test here.
3. **Source-contract tests** — `hookPolicyContracts.test.ts` greps entry-point
   source files to enforce wiring invariants and spawns the entry points as
   subprocesses to validate end-to-end JSON output. Update these when entry
   points change shape.

## Style

- ES modules (`.mjs`) with JSDoc types. No TypeScript compilation step for
  runtime files — types live in `lattice.d.ts`.
- TypeScript tests (`.test.ts`) run through vitest's transpilation.
- No new top-level dependencies without a strong reason. Zero runtime deps
  is a feature.
- Cross-platform: prefer `node:fs` / `node:path` over shell. When you must
  spawn, set a timeout. Avoid bash-only shebangs in shipped code.

## Reporting bugs

Open an issue with:
- lattice version (`@lzong.tw/lattice` in your `package.json`)
- Node version
- AI client (Claude Code / Copilot CLI / Codex CLI) and version
- Minimal repro: ideally a stdin payload + the exact dispatcher invocation
- Expected vs actual output

## Reporting security issues

See [`SECURITY.md`](./SECURITY.md). Please do not file public issues for
security reports.
