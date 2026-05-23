#!/usr/bin/env node
/**
 * lessons/resurface.mjs — given an edited file path, return a "you may
 * want to read X" reminder if the path falls inside a configured
 * lesson domain.
 *
 * Pure function (`buildResurfaceMessage`) so the provider's PostToolUse
 * handler can call it without side-effects. The whole resurface module
 * is a no-op when `config.domains` is empty (default), which keeps it
 * safe to enable in any repo.
 *
 * Resurface semantics: for each domain, IF the touched file matches
 * `domain.match` (regex) AND EITHER (a) the domain has no `trigger`
 * regex OR (b) the file's content matches the `trigger`, emit a one-
 * line nudge naming `domain.doc`. We deliberately only suggest reading
 * — never auto-load — because forcing context into every PostToolUse
 * is expensive and noisy.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function tryRegex(source, flags = "") {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

function normaliseRelative(filePath, repoRoot) {
  if (!filePath) return "";
  // Normalise backslashes so configured regexes can use POSIX-style
  // path fragments and still match on Windows.
  const abs = resolve(repoRoot, filePath).replace(/\\/g, "/");
  const root = resolve(repoRoot).replace(/\\/g, "/");
  if (abs.startsWith(root + "/")) return abs.slice(root.length + 1);
  return abs;
}

/**
 * Pure function. Returns either a string (single reminder, joined when
 * multiple domains match) or `null` to print nothing.
 *
 * @param {object} input
 * @param {string} input.repoRoot
 * @param {string[]} input.filePaths - touched files from the tool payload
 * @param {object} input.config - resolved LessonsConfig
 */
export function buildResurfaceMessage({ repoRoot, filePaths, config }) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return null;
  if (!Array.isArray(config?.domains) || config.domains.length === 0) return null;

  const matches = new Map(); // doc → Set<domainName>

  for (const filePath of filePaths) {
    const rel = normaliseRelative(filePath, repoRoot);
    if (!rel) continue;

    for (const domain of config.domains) {
      const matchRe = tryRegex(domain.match);
      if (!matchRe || !matchRe.test(rel)) continue;

      if (domain.trigger) {
        const abs = resolve(repoRoot, rel);
        if (!existsSync(abs)) continue;
        const triggerRe = tryRegex(domain.trigger);
        if (!triggerRe) continue;
        let content = "";
        try {
          content = readFileSync(abs, "utf8");
        } catch {
          continue;
        }
        if (!triggerRe.test(content)) continue;
      }

      if (!matches.has(domain.doc)) matches.set(domain.doc, new Set());
      matches.get(domain.doc).add(domain.name);
    }
  }

  if (matches.size === 0) return null;

  const lines = ["[lattice/lessons] domain hit — consider reading:"];
  for (const [doc, names] of matches.entries()) {
    lines.push(`  • ${doc} (${[...names].join(", ")})`);
  }
  return lines.join("\n");
}
