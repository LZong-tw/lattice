#!/usr/bin/env node
/**
 * lessons/promote-audit.mjs — scan lessons docs for prose rules that
 * look promotable to a stronger enforcement layer (audit test, hook,
 * pre-commit check).
 *
 * Heuristics for promotion (each adds to a score):
 *   +2  imperative keyword (MUST / NEVER / always / every / ALL)
 *   +2  references a specific decorator / function / file (regex-able)
 *   +3  has "Case: PR #N" / "Case: production" tail (proven incident)
 *   +1  body contains "audit/regex/scan/architecture-audit" (similar
 *       pattern already exists in the repo)
 *   +1  body length > 500 chars (long lessons → more enforcement
 *       opportunity)
 *
 * Threshold: score >= 4 → candidate. Tunable via
 * `LATTICE_LESSONS_PROMOTE_THRESHOLD`.
 *
 * Files scanned: `config.auditScopes` (defaults to `["CLAUDE.md"]`).
 *
 * Usage:
 *   node node_modules/@lzong.tw/lattice/lessons/promote-audit.mjs
 *   node node_modules/@lzong.tw/lattice/lessons/promote-audit.mjs --json
 *   node node_modules/@lzong.tw/lattice/lessons/promote-audit.mjs --open-issues
 *
 * `--open-issues` requires `gh` CLI. To avoid the well-known shell-
 * injection trap with markdown bodies (backticks → command
 * substitution; `$inc` / `$set` → variable expansion), this script
 * writes the body to a temp file and passes `--body-file` via
 * `execFileSync` argv array (no shell parse, ever).
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { loadLessonsConfig } from "./config.mjs";
import { extractLessons } from "./reorganize-audit.mjs";

const IMPERATIVE_KEYWORDS = /\b(MUST|NEVER|always|every|ALL|ALWAYS|MUST NOT)\b/;
const REGEXABLE_HINTS = /@\w+\(|`[\w.-]+\.(ts|tsx|js|mjs)`|\$\w+|`\.(set|setOnInsert|select|lean|exec)`/;
const HAS_REAL_INCIDENT = /Case:\s+(PR #\d+|production|prod|prod-down|shipped|broke)/i;
const ALREADY_AUDITED = /(audit (test|at)|architecture-audit|risk-analysis|catches this|enforced by)/i;

function repoRootFromGit(fallback) {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

export function scoreLesson(lesson) {
  const full = `${lesson.title}\n${lesson.body}`;
  let score = 0;
  const reasons = [];

  if (IMPERATIVE_KEYWORDS.test(full)) {
    score += 2;
    reasons.push("imperative rule (MUST/NEVER/always)");
  }
  if (REGEXABLE_HINTS.test(full)) {
    score += 2;
    reasons.push("references a specific symbol/decorator/file (regex-able)");
  }
  if (HAS_REAL_INCIDENT.test(full)) {
    score += 3;
    reasons.push("caused a real production incident (proven cost)");
  }
  if (ALREADY_AUDITED.test(full)) {
    score += 1;
    reasons.push("similar audit pattern already exists");
  }
  if (lesson.body.length > 500) {
    score += 1;
    reasons.push(`detailed (${lesson.body.length} chars)`);
  }
  return { score, reasons };
}

function suggestEnforcement(lesson) {
  const full = `${lesson.title}\n${lesson.body}`.toLowerCase();
  if (/regex|grep|scan|audit/.test(full)) return "extend the project's architecture-audit test";
  if (/pre-?commit|hook|stage/.test(full)) return "add a .husky/pre-commit step";
  if (/git\s+(diff|add|commit|push)/.test(full)) return "add a git hook or pre-commit gate";
  if (/test|spec|vitest/.test(full)) return "add a unit test or coverage gate";
  if (/build|tsc|next build/.test(full)) return "add a build-time check or CI step";
  return "review for enforceability";
}

function openIssue({ title, body, label }) {
  // Body contains backticks and `$...` from lesson markdown. Passing
  // through shell would corrupt or fail; argv-form + temp file is the
  // only safe path.
  const bodyFile = resolve(
    tmpdir(),
    `lattice-lessons-promote-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
  );
  writeFileSync(bodyFile, body, "utf8");
  try {
    execFileSync(
      "gh",
      ["issue", "create", "--title", title, "--body-file", bodyFile, "--label", label],
      { stdio: "inherit" },
    );
  } catch (err) {
    process.stderr.write(
      `lattice/lessons: failed to create issue "${title}" — ${err.message}\n`,
    );
  }
}

function run() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const openIssues = argv.includes("--open-issues");

  const repoRoot = repoRootFromGit(process.cwd());
  const config = loadLessonsConfig({ env: process.env, repoRoot });
  const threshold = Number(process.env.LATTICE_LESSONS_PROMOTE_THRESHOLD) || 4;

  const all = [];
  for (const scope of config.auditScopes) {
    const abs = resolve(repoRoot, scope);
    for (const lesson of extractLessons(abs)) {
      all.push({ ...lesson, file: scope });
    }
  }

  const scored = all
    .map((lesson) => ({ ...lesson, ...scoreLesson(lesson) }))
    .filter((l) => l.score >= threshold)
    .sort((a, b) => b.score - a.score);

  if (asJson) {
    process.stdout.write(JSON.stringify({ threshold, scored }, null, 2) + "\n");
    return;
  }

  process.stdout.write(`# Lessons Promote Audit\n\n`);
  process.stdout.write(
    `Scanned ${config.auditScopes.length} file(s), ${all.length} lessons. ` +
      `${scored.length} candidates scored >= ${threshold}.\n\n`,
  );

  if (scored.length === 0) {
    process.stdout.write(
      "No high-score candidates. Either the lessons are fine as prose or the heuristics need tuning.\n",
    );
    return;
  }

  process.stdout.write("## Top promotion candidates\n\n");
  for (const lesson of scored.slice(0, 20)) {
    process.stdout.write(`### [${lesson.score}] ${lesson.title}\n`);
    process.stdout.write(`- **File**: ${lesson.file}:${lesson.line}\n`);
    process.stdout.write(`- **Why promotable**: ${lesson.reasons.join("; ")}\n`);
    process.stdout.write(`- **Suggested enforcement**: ${suggestEnforcement(lesson)}\n\n`);
  }

  if (openIssues) {
    process.stdout.write("\n## Opening GitHub issues for top 5 candidates...\n");
    for (const lesson of scored.slice(0, 5)) {
      const title = `Promote lesson to audit: ${lesson.title.slice(0, 80)}`;
      const body =
        `**Lesson location**: \`${lesson.file}:${lesson.line}\`\n\n` +
        `**Promotion score**: ${lesson.score}\n\n` +
        `**Reasons**: ${lesson.reasons.join(", ")}\n\n` +
        `**Suggested enforcement**: ${suggestEnforcement(lesson)}\n\n` +
        `**Lesson body**:\n> ${lesson.body.slice(0, 500).replace(/\n/g, "\n> ")}\n\n` +
        `Generated by \`@lzong.tw/lattice/lessons/promote-audit.mjs\`.`;
      openIssue({ title, body, label: "lessons-promote" });
    }
  }
}

run();
