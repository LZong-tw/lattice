<!--
Thanks for the PR. Please fill in this template — checklist items mirror the
contributor guide and exist because they've each saved a future maintainer at
some point.

If this is a draft / WIP, prefix the title with `[WIP]` and feel free to leave
unchecked boxes. CI will tell you if anything is broken.
-->

## Summary

<!-- One or two sentences on what changes and why. -->

## Linked issue / discussion

<!-- "Fixes #123" or "Part of #456". For unsolicited PRs, write a short
     motivation paragraph here and expect the first review round to push back
     on scope. -->

## Type of change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New built-in provider or feature (non-breaking)
- [ ] **Contract change** (affects `LatticeProvider` / `LatticeHandlerResult` / `LatticeContext` / dispatcher merge / event names)
- [ ] Docs / examples only
- [ ] CI / build / repo hygiene

## Checklist

- [ ] `pnpm test` passes locally
- [ ] `pnpm run typecheck` passes (no new `tsc` errors)
- [ ] `pnpm run check` passes (`node --check` on every entry point)
- [ ] New code has tests under `__tests__/`
- [ ] Public API changes update `lattice.d.ts`
- [ ] Behavior changes update the relevant doc (`README.md`, `docs/PROVIDER-AUTHORING.md`, or `docs/PROVIDER-ROLLOUT.md`)
- [ ] `CHANGELOG.md` entry under `## [Unreleased]`
- [ ] No `company` / `internal` / internal-only strings in the diff (the `hookPolicyContracts.test.ts` source-grep assertion enforces this)
- [ ] Commit messages describe the **why** in one or two sentences

## For contract changes only

- [ ] Spec at `reports/provider-contract-v1-2026-05-21.md` updated, OR a successor spec file added with a migration note
- [ ] Backwards compat path documented (deprecation, shim, or breaking-bump rationale)
- [ ] Dispatcher / merge-rule tests updated in `__tests__/dispatcher.test.ts`

## Test plan

<!-- Bulleted list of how you verified this works, including any platform-
     specific testing (Windows symlink behavior, etc.) -->
