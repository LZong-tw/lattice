# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.x     | :white_check_mark: |

lattice is pre-1.0. Security fixes land on the latest `0.x` minor; older
`0.x` lines are not patched.

## Reporting a vulnerability

**Please do not file public GitHub issues for security reports.**

Email: **lzong.tw@gmail.com**

Subject line prefix: `[lattice-security]`

Include:
- A description of the issue (what an attacker can achieve)
- A minimal reproduction or proof-of-concept
- The affected version range
- Any mitigations you've identified

You should receive an acknowledgement within **7 days**. If you don't, please
re-send — your email may have been filtered. Coordinated disclosure timelines
will be agreed case-by-case; the default target is 90 days from acknowledgement
to public fix.

## Scope

In-scope:
- Code in `@lzong.tw/lattice` (this repo) that runs as part of a hook invocation
- The way provider definitions are loaded via `LATTICE_EXTRA_PROVIDERS`
- Anything in `lattice.d.ts` that could mislead a provider author into writing
  unsafe code

Out of scope:
- Vulnerabilities in third-party providers — report to the provider's own
  repository
- Vulnerabilities in Anthropic / GitHub / OpenAI client behavior — report to
  the upstream
- Bugs in the example clawback adapter (`examples/clawback-adapter/`) —
  it's intentionally stub-only

## Acknowledgement

Reporters who follow this process and act in good faith will be credited
in the release notes for the fix (opt-out available).
