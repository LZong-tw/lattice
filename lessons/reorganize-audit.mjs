#!/usr/bin/env node
/**
 * lessons/reorganize-audit.mjs — scan the root lessons doc for top-level
 * bullets whose body matches a configured domain. Each match is a
 * candidate for MOVING from the root doc into its per-domain doc.
 *
 * Usage:
 *   node node_modules/@lzong.tw/lattice/lessons/reorganize-audit.mjs
 *   node node_modules/@lzong.tw/lattice/lessons/reorganize-audit.mjs --json
 *
 * The output is markdown by default (so it can be `cat /tmp/out.md` into
 * a GitHub issue body via `--body-file`). JSON output is for CI scripts.
 *
 * Heuristic: a lesson "belongs to" a domain when its title+body matches
 * the domain's `trigger` regex (config field). If the domain has no
 * `trigger`, the heuristic falls back to `match` regex applied to body
 * text (less precise; intended only for early adoption).
 *
 * Exit code is always 0 — this is advisory only, never blocks CI by
 * itself. A consumer who wants it to gate merges can pipe through
 * `--json` and assert in their own workflow.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadLessonsConfig } from "./config.mjs";

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

function tryRegex(source, flags = "i") {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/**
 * Extract top-level lessons from a markdown file. A "top-level lesson"
 * is a bullet starting with `- **<title>**`. Continuation lines (any
 * line indented with 2+ spaces, or blank lines between continuation
 * lines) are appended to the current lesson's body until the next
 * top-level bullet.
 *
 * Normalises CRLF so the `$` end-of-line anchor matches reliably on
 * Windows.
 */
export function extractLessons(filePath) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n").map((line) => line.replace(/\r$/, ""));

  const lessons = [];
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const startMatch = line.match(/^- \*\*(.+?)\*\*\s*[—:-]?\s*(.*)$/);
    if (startMatch) {
      if (current) lessons.push(current);
      current = {
        line: i + 1,
        title: startMatch[1].trim(),
        body: startMatch[2] || "",
      };
    } else if (current && line.startsWith("  ")) {
      current.body += "\n" + line.trim();
    } else if (current && line.trim() === "") {
      current.body += "\n";
    } else if (current && line.startsWith("- ")) {
      lessons.push(current);
      current = null;
    }
  }
  if (current) lessons.push(current);
  return lessons;
}

function classifyLesson(lesson, domains) {
  const haystack = `${lesson.title}\n${lesson.body}`;
  const hits = [];
  for (const domain of domains) {
    const re =
      tryRegex(domain.trigger, "i") || tryRegex(domain.match, "i");
    if (re && re.test(haystack)) hits.push(domain);
  }
  return hits;
}

function renderMarkdown(report) {
  const lines = ["# Lessons Reorganize Audit", ""];
  lines.push(
    `Scanned \`${report.rootDoc}\`: ${report.totalLessons} top-level lessons.`,
  );
  lines.push(`${report.candidates.length} candidates suggest moving to a per-domain file.`);
  lines.push("");

  if (report.candidates.length === 0) {
    lines.push("No candidates. Either the root doc is already well-organised or no domains are configured.");
    return lines.join("\n");
  }

  const byDoc = new Map();
  for (const c of report.candidates) {
    for (const d of c.hits) {
      if (!byDoc.has(d.doc)) byDoc.set(d.doc, []);
      byDoc.get(d.doc).push({ lesson: c.lesson, domainName: d.name });
    }
  }

  for (const [doc, items] of byDoc.entries()) {
    lines.push(`## → ${doc}`);
    lines.push("");
    for (const { lesson, domainName } of items) {
      lines.push(`- **${lesson.title}** (matched domain: ${domainName}, line ${lesson.line})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function run() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");

  const repoRoot = repoRootFromGit(process.cwd());
  const config = loadLessonsConfig({ env: process.env, repoRoot });
  const rootDocPath = resolve(repoRoot, config.rootDoc);
  const lessons = extractLessons(rootDocPath);

  const candidates = lessons
    .map((lesson) => ({ lesson, hits: classifyLesson(lesson, config.domains) }))
    .filter((c) => c.hits.length > 0);

  const report = {
    rootDoc: config.rootDoc,
    totalLessons: lessons.length,
    candidates,
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }
  process.stdout.write(renderMarkdown(report) + "\n");
}

run();
