#!/usr/bin/env node
/**
 * lessons/config.mjs — config loader for the lattice/lessons provider.
 *
 * Consumers configure the provider via one of (precedence top→bottom):
 *   1. `LATTICE_LESSONS_CONFIG` env var pointing at a JSON file
 *   2. `<repoRoot>/.lattice/lessons.config.json`
 *   3. `<repoRoot>/lattice.config.json` with a top-level `lessons` key
 *   4. Built-in defaults (size-check cap only; no domains, no write-gate)
 *
 * Defaults are intentionally conservative: with zero config you get just
 * the size-check warning. Everything else (resurface routing, write-gate,
 * audit scopes) is opt-in via config so the provider can't surprise a
 * consumer that just added `lattice/lessons` to their builtins list.
 *
 * Config schema (all fields optional except where noted):
 * {
 *   "rootDoc": "CLAUDE.md",
 *   "cap": { "lines": 700, "bullets": 130 },
 *   "domains": [
 *     {
 *       "name": "RBAC",
 *       "match": "packages/backend/src/(rbac|auth)",   // regex (string)
 *       "doc": "packages/backend/src/rbac/CLAUDE.md",  // relative to repoRoot
 *       "trigger": "\\b(AdminGuard|@RequirePermission)\\b" // optional regex
 *     }
 *   ],
 *   "auditScopes": ["CLAUDE.md", "packages/backend/CLAUDE.md"],
 *   "writeGate": {
 *     "enabled": false,                              // default off — opt-in
 *     "watchPaths": ["src/", "packages/"],           // regex strings
 *     "requireDocsUpdate": ["CLAUDE.md", "docs/"],   // regex strings
 *     "bypassToken": "[no-decision]"
 *   }
 * }
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULTS = Object.freeze({
  rootDoc: "CLAUDE.md",
  cap: { lines: 700, bullets: 130 },
  domains: [],
  auditScopes: ["CLAUDE.md"],
  writeGate: {
    enabled: false,
    watchPaths: [],
    requireDocsUpdate: ["CLAUDE.md", "docs/"],
    bypassToken: "[no-decision]",
  },
});

function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    process.stderr.write(
      `lattice/lessons: failed to parse ${path}: ${err.message}\n`,
    );
    return null;
  }
}

function mergeWithDefaults(user) {
  if (!user || typeof user !== "object") return { ...DEFAULTS };
  return {
    rootDoc: typeof user.rootDoc === "string" ? user.rootDoc : DEFAULTS.rootDoc,
    cap: {
      lines:
        Number.isFinite(user.cap?.lines) && user.cap.lines > 0
          ? user.cap.lines
          : DEFAULTS.cap.lines,
      bullets:
        Number.isFinite(user.cap?.bullets) && user.cap.bullets > 0
          ? user.cap.bullets
          : DEFAULTS.cap.bullets,
    },
    domains: Array.isArray(user.domains) ? user.domains.filter(isValidDomain) : [],
    auditScopes:
      Array.isArray(user.auditScopes) && user.auditScopes.every((s) => typeof s === "string")
        ? user.auditScopes
        : DEFAULTS.auditScopes,
    writeGate: {
      enabled: user.writeGate?.enabled === true,
      watchPaths:
        Array.isArray(user.writeGate?.watchPaths)
          ? user.writeGate.watchPaths.filter((s) => typeof s === "string")
          : [],
      requireDocsUpdate:
        Array.isArray(user.writeGate?.requireDocsUpdate)
          ? user.writeGate.requireDocsUpdate.filter((s) => typeof s === "string")
          : DEFAULTS.writeGate.requireDocsUpdate,
      bypassToken:
        typeof user.writeGate?.bypassToken === "string"
          ? user.writeGate.bypassToken
          : DEFAULTS.writeGate.bypassToken,
    },
  };
}

function isValidDomain(d) {
  return (
    d &&
    typeof d === "object" &&
    typeof d.name === "string" &&
    typeof d.match === "string" &&
    typeof d.doc === "string"
  );
}

/**
 * Resolve the effective lessons config given an env snapshot and a repoRoot.
 * Pure function: no fs writes, no logging beyond parse errors. Always returns
 * a fully-populated config object (defaults fill any missing fields).
 */
export function loadLessonsConfig({ env, repoRoot }) {
  const envPath = env?.LATTICE_LESSONS_CONFIG?.trim();
  if (envPath) {
    const json = readJsonSafe(resolve(envPath));
    if (json) return mergeWithDefaults(json);
  }

  const dotLattice = resolve(repoRoot, ".lattice", "lessons.config.json");
  const fromDotLattice = readJsonSafe(dotLattice);
  if (fromDotLattice) return mergeWithDefaults(fromDotLattice);

  const lattice = resolve(repoRoot, "lattice.config.json");
  const fromLattice = readJsonSafe(lattice);
  if (fromLattice?.lessons) return mergeWithDefaults(fromLattice.lessons);

  return mergeWithDefaults(null);
}

export const _internal = { DEFAULTS, mergeWithDefaults, isValidDomain };
