#!/usr/bin/env node
/**
 * Resolve which Serena project root + port a session should use (user-level).
 *
 * Policy:
 *  1. Exact/registered path match wins (including intentionally registered worktrees).
 *  2. Else unregistered git worktree of a registered main → main.
 *  3. Else nearest ancestor with `.serena/project.yml`.
 *  4. Else null.
 *
 * Ports: pins in ports.json (optional); others use stable hash ports 18000–19999.
 * sugar-dating is commonly pinned to 9127 in ports.json.example.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir();
const DEFAULT_PORTS_FILE = path.join(HERE, "ports.json");
const USER_PORTS_FILE = path.join(HOME, ".serena", "http-singleton", "ports.json");
const SERENA_CONFIG = path.join(HOME, ".serena", "serena_config.yml");
const HOST = process.env.SERENA_HTTP_SINGLETON_HOST || "127.0.0.1";

export function normalizePath(p) {
  return path.resolve(p).replace(/\//g, path.sep);
}

export function pathKey(p) {
  return normalizePath(p).toLowerCase();
}

function hash(value) {
  return crypto.createHash("sha1").update(String(value).toLowerCase()).digest("hex").slice(0, 10);
}

export function defaultPort(projectPath) {
  const value = Number.parseInt(hash(normalizePath(projectPath)).slice(0, 6), 16);
  return 18000 + (value % 2000);
}

export function loadPortPins() {
  const out = new Map();
  for (const file of [DEFAULT_PORTS_FILE, USER_PORTS_FILE]) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const [k, v] of Object.entries(raw || {})) {
        const port = Number(v);
        if (Number.isInteger(port) && port > 0 && port <= 65535) {
          out.set(pathKey(k), port);
        }
      }
    } catch {
      // ignore bad pins
    }
  }
  return out;
}

export function portFor(projectPath) {
  const pins = loadPortPins();
  return pins.get(pathKey(projectPath)) ?? defaultPort(projectPath);
}

export function endpointFor(projectPath, port = portFor(projectPath)) {
  return `http://${HOST}:${port}/mcp`;
}

export function listRegisteredProjects() {
  const projects = [];
  try {
    const text = fs.readFileSync(SERENA_CONFIG, "utf8");
    let inProjects = false;
    for (const line of text.split(/\r?\n/)) {
      if (/^projects:\s*$/.test(line)) {
        inProjects = true;
        continue;
      }
      if (inProjects) {
        const m = line.match(/^\s*-\s+(.+?)\s*$/);
        if (m) {
          projects.push(normalizePath(m[1].replace(/^["']|["']$/g, "")));
          continue;
        }
        if (line.trim() && !/^\s/.test(line) && !line.trim().startsWith("#")) break;
      }
    }
  } catch {
    // ignore
  }
  return projects;
}

function hasProjectYml(dir) {
  return fs.existsSync(path.join(dir, ".serena", "project.yml"));
}

function walkAncestors(start) {
  const out = [];
  let dir = normalizePath(start);
  for (;;) {
    out.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

function gitCommonMainRoot(cwd) {
  try {
    const common = execFileSync(
      "git",
      ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (!common) return null;
    const normalized = normalizePath(common);
    if (normalized.toLowerCase().endsWith(`${path.sep}.git`.toLowerCase())) {
      return path.dirname(normalized);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {string} startDir
 * @returns {{ project: string, port: number, endpoint: string, reason: string } | null}
 */
export function resolveSerenaProject(startDir) {
  if (!startDir) return null;
  let start;
  try {
    start = normalizePath(startDir);
  } catch {
    return null;
  }
  if (!fs.existsSync(start)) return null;

  const registered = listRegisteredProjects();
  const registeredKeys = new Map(registered.map((p) => [pathKey(p), p]));

  for (const dir of walkAncestors(start)) {
    const hit = registeredKeys.get(pathKey(dir));
    if (hit) {
      return {
        project: hit,
        port: portFor(hit),
        endpoint: endpointFor(hit),
        reason: "registered",
      };
    }
  }

  const mainRoot = gitCommonMainRoot(start);
  if (mainRoot && pathKey(mainRoot) !== pathKey(start)) {
    const mainHit = registeredKeys.get(pathKey(mainRoot));
    if (mainHit) {
      return {
        project: mainHit,
        port: portFor(mainHit),
        endpoint: endpointFor(mainHit),
        reason: "worktree-main-registered",
      };
    }
    if (hasProjectYml(mainRoot)) {
      return {
        project: mainRoot,
        port: portFor(mainRoot),
        endpoint: endpointFor(mainRoot),
        reason: "worktree-main",
      };
    }
  }

  for (const dir of walkAncestors(start)) {
    if (hasProjectYml(dir)) {
      return {
        project: dir,
        port: portFor(dir),
        endpoint: endpointFor(dir),
        reason: "project.yml",
      };
    }
  }

  return null;
}

export function resolveStartDir(hookPayload = {}, argvProject) {
  if (argvProject) return normalizePath(argvProject);

  const envCandidates = [
    process.env.SERENA_HTTP_SINGLETON_PROJECT,
    process.env.CLAUDE_PROJECT_DIR,
    process.env.CLAUDE_PROJECT_ROOT,
    process.env.CODEX_PROJECT_DIR,
    process.env.CODEX_WORKSPACE_ROOT,
    process.env.CURSOR_PROJECT_DIR,
  ];
  for (const c of envCandidates) {
    if (c && String(c).trim()) return normalizePath(c);
  }

  const payloadCandidates = [
    hookPayload.cwd,
    hookPayload.current_working_directory,
    hookPayload.workspace_roots?.[0],
    hookPayload.workspaceRoots?.[0],
    hookPayload.project_dir,
    hookPayload.projectDir,
  ];
  for (const c of payloadCandidates) {
    if (c && String(c).trim()) return normalizePath(c);
  }

  return normalizePath(process.cwd());
}

export async function readHookStdin() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
