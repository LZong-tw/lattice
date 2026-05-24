#!/usr/bin/env node
/**
 * register-builtins.mjs — side-effect module that registers every built-in
 * v1 provider plus the bundled optional providers (Serena, Semble, RTK), then
 * optionally loads external providers listed in `LATTICE_EXTRA_PROVIDERS`.
 *
 * Every hook entry point in this repo (`session-start.mjs`,
 * `pre-tool-policy.mjs`, `post-tool-reminder.mjs`, `stop-checklist.mjs`)
 * imports this module before calling `dispatch()`. Consumers who want a
 * custom provider set can either:
 *
 *   1. Set LATTICE_EXTRA_PROVIDERS=@my-org/foo,@my-org/bar — comma-
 *      separated module specifiers that will be dynamically imported here.
 *      Each external provider is expected to call `registerProvider` as
 *      an import side effect.
 *   2. Set LATTICE_DISABLE=lattice/edit-reminder,serena — names of
 *      providers to skip at dispatch time.
 *   3. Set LATTICE_PROVIDERS=lattice/protection — explicit allowlist that
 *      ignores everything else, including builtins.
 *
 * The order of registration determines handler invocation order at
 * dispatch time, which in turn drives merge order (e.g. reason concat
 * order). Built-ins are registered first so they always run first.
 */

import { registerProvider } from "./provider-registry.mjs";
import { protectionProvider } from "./builtins/protection-provider.mjs";
import { stopChecklistProvider } from "./builtins/stop-checklist-provider.mjs";
import {
  commitCheckpointProvider,
  editReminderProvider,
  screenshotReminderProvider,
} from "./builtins/reminders-provider.mjs";
import { serenaProvider } from "./serena/provider.mjs";
import { sembleProvider } from "./semble/provider.mjs";
import { rtkProvider } from "./rtk/provider.mjs";
import { lessonsProvider } from "./lessons/provider.mjs";

registerProvider(protectionProvider);
registerProvider(commitCheckpointProvider);
registerProvider(screenshotReminderProvider);
registerProvider(editReminderProvider);
registerProvider(stopChecklistProvider);
registerProvider(serenaProvider);
registerProvider(sembleProvider);
registerProvider(rtkProvider);
registerProvider(lessonsProvider);

const extra = (process.env.LATTICE_EXTRA_PROVIDERS ?? "")
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);

/**
 * Validate that a LATTICE_EXTRA_PROVIDERS entry is shaped like an npm
 * package specifier. We are deliberately strict: this loader is a
 * registration shortcut, NOT a plugin path that should accept file:,
 * data:, http(s):, absolute paths, or relative paths. Any of those
 * shapes lets an attacker who can set env vars execute arbitrary code
 * inside the hook process.
 *
 * Accepted:
 *   - bare:   `pkg-name`                        → ^[a-z0-9][a-z0-9._-]*$
 *   - scoped: `@scope/pkg-name`                 → ^@scope/pkg$
 *   - either form may carry a `/subpath` suffix → `pkg/sub/path`
 *
 * Rejected (returns false): leading `.` / `/` / `\`, `..` segments,
 * any `file:` / `data:` / `http:` / `https:` / `node:` / `npm:` URL
 * shape, whitespace, control chars, uppercase (npm names are lowercase).
 */
export function isValidNpmSpecifier(specifier) {
  if (typeof specifier !== "string" || specifier.length === 0) {
    return false;
  }

  // Reject any URL-ish prefix outright.
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) {
    return false;
  }

  // Reject absolute paths and relative paths.
  if (specifier.startsWith("/") || specifier.startsWith("\\") || specifier.startsWith(".")) {
    return false;
  }

  // Reject any backslash (Windows path separator).
  if (specifier.includes("\\")) {
    return false;
  }

  // Reject null bytes and control / whitespace chars.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\s]/.test(specifier)) {
    return false;
  }

  // Trailing slash is meaningless and indicates a malformed specifier.
  if (specifier.endsWith("/")) {
    return false;
  }

  // Split off optional `/subpath`; the package-name portion is everything
  // before the first `/` (for bare names) or before the second `/` (for
  // scoped names).
  let pkgName;
  let subpath;
  if (specifier.startsWith("@")) {
    const firstSlash = specifier.indexOf("/");
    if (firstSlash < 0) return false;
    const secondSlash = specifier.indexOf("/", firstSlash + 1);
    if (secondSlash < 0) {
      pkgName = specifier;
      subpath = "";
    } else {
      pkgName = specifier.slice(0, secondSlash);
      subpath = specifier.slice(secondSlash + 1);
    }
    if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(pkgName)) {
      return false;
    }
  } else {
    const firstSlash = specifier.indexOf("/");
    if (firstSlash < 0) {
      pkgName = specifier;
      subpath = "";
    } else {
      pkgName = specifier.slice(0, firstSlash);
      subpath = specifier.slice(firstSlash + 1);
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(pkgName)) {
      return false;
    }
  }

  // Subpath must not contain empty segments or `.`/`..` traversal.
  if (subpath.length > 0) {
    const segments = subpath.split("/");
    for (const segment of segments) {
      if (segment.length === 0 || segment === "." || segment === "..") {
        return false;
      }
    }
  }

  return true;
}

for (const specifier of extra) {
  if (!isValidNpmSpecifier(specifier)) {
    process.stderr.write(
      `lattice: rejected LATTICE_EXTRA_PROVIDERS entry "${specifier}" — must be a bare or scoped npm package name (optionally with /subpath). file:, data:, http(s):, relative, and absolute paths are not allowed.\n`,
    );
    continue;
  }

  try {
    await import(specifier);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `lattice: failed to load LATTICE_EXTRA_PROVIDERS "${specifier}": ${message}\n`,
    );
    // H2: this entry was explicitly listed by the operator and passed
    // shape validation, but failed to load. Treat as fatal so the AI
    // client refuses to start the session rather than silently running
    // with degraded protection.
    process.exit(1);
  }
}
