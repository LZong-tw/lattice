#!/usr/bin/env node
/**
 * Install user-level Serena + Semble HTTP singleton scripts into the home profile.
 *
 * Copies:
 *   serena/user-singleton/*  →  ~/.serena/http-singleton/
 *   semble/user-singleton/*  →  ~/.semble/http-singleton/
 *
 * Does not rewrite Claude/Codex MCP configs (see docs/USER-MCP-SINGLETONS.md).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir();

const COPIES = [
  {
    from: path.join(REPO, "serena", "user-singleton"),
    to: path.join(HOME, ".serena", "http-singleton"),
    skip: new Set(["README.md", "ports.json.example"]),
  },
  {
    from: path.join(REPO, "semble", "user-singleton"),
    to: path.join(HOME, ".semble", "http-singleton"),
    skip: new Set(["README.md"]),
  },
];

function copyTree(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.has(ent.name)) continue;
    if (ent.name.startsWith("_")) continue;
    const src = path.join(from, ent.name);
    const dst = path.join(to, ent.name);
    if (ent.isDirectory()) {
      copyTree(src, dst, skip);
    } else {
      fs.copyFileSync(src, dst);
      console.error(`copied ${src} → ${dst}`);
    }
  }
}

function maybeCopyPortsExample() {
  const example = path.join(REPO, "serena", "user-singleton", "ports.json.example");
  const dest = path.join(HOME, ".serena", "http-singleton", "ports.json");
  if (!fs.existsSync(dest) && fs.existsSync(example)) {
    fs.copyFileSync(example, dest);
    console.error(`created ${dest} from ports.json.example — edit pins as needed`);
  }
}

function main() {
  for (const spec of COPIES) {
    if (!fs.existsSync(spec.from)) {
      console.error(`missing source ${spec.from}`);
      process.exit(1);
    }
    copyTree(spec.from, spec.to, spec.skip);
  }
  maybeCopyPortsExample();
  console.error(`
User singletons installed.

Next:
  1. Edit ~/.serena/http-singleton/ports.json (pin main repos, e.g. sugar-dating → 9127)
  2. Wire Claude/Codex MCP URLs per docs/USER-MCP-SINGLETONS.md
  3. SessionStart (optional):
       node ~/.serena/http-singleton/ensure-from-cwd.mjs
       node ~/.semble/http-singleton/semble-http-singleton.mjs ensure
  4. For monorepos that already use a user Serena singleton, keep LATTICE_DISABLE=serena
`);
}

main();
