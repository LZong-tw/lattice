#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { isMainModule } from "../is-main.mjs";
import { getSampledProcessRows } from "../serena/cleanup-processes.mjs";

const DEFAULTS = Object.freeze({
  cpuSampleMs: 1200,
  sembleGraceHours: 1,
  playwrightGraceHours: 4,
  highPrivateMb: 512,
  lowWorkingSetMb: 128,
  lowWorkingSetRatio: 0.18,
  idleCpuSeconds: 0.2,
  killScore: 70,
  runawayClaudeSearchGraceMinutes: 15,
  runawayClaudeSearchMinCpuSeconds: 0.3,
});

const ACTIVE_PARENT_NAMES = new Set([
  "claude",
  "codex",
  "node",
  "pwsh",
  "powershell",
  "windowsterminal",
]);

const EXPECTED_ROOT_PARENT_NAMES = new Set([
  "explorer",
  "services",
  "sihost",
  "svchost",
  "wininit",
  "windowsterminal",
]);

const MCP_WRAPPER_NAMES = new Set([
  "cmd",
  "conhost",
  "node",
  "npm",
  "npx",
  "python",
  "python3",
  "semble",
  "uv",
  "uvx",
]);

function numberEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function cleanupOptionsFromEnv(env = process.env) {
  return {
    cpuSampleMs: numberEnv(env, "LATTICE_MCP_CLEANUP_CPU_SAMPLE_MS", DEFAULTS.cpuSampleMs),
    highPrivateMb: numberEnv(env, "LATTICE_MCP_CLEANUP_HIGH_PRIVATE_MB", DEFAULTS.highPrivateMb),
    idleCpuSeconds: numberEnv(env, "LATTICE_MCP_CLEANUP_IDLE_CPU_SECONDS", DEFAULTS.idleCpuSeconds),
    killScore: numberEnv(env, "LATTICE_MCP_CLEANUP_KILL_SCORE", DEFAULTS.killScore),
    lowWorkingSetMb: numberEnv(
      env,
      "LATTICE_MCP_CLEANUP_LOW_WORKING_SET_MB",
      DEFAULTS.lowWorkingSetMb,
    ),
    lowWorkingSetRatio: numberEnv(
      env,
      "LATTICE_MCP_CLEANUP_LOW_WORKING_SET_RATIO",
      DEFAULTS.lowWorkingSetRatio,
    ),
    playwrightGraceHours: numberEnv(
      env,
      "LATTICE_MCP_CLEANUP_PLAYWRIGHT_GRACE_HOURS",
      DEFAULTS.playwrightGraceHours,
    ),
    sembleGraceHours: numberEnv(
      env,
      "LATTICE_MCP_CLEANUP_SEMBLE_GRACE_HOURS",
      DEFAULTS.sembleGraceHours,
    ),
    runawayClaudeSearchGraceMinutes: numberEnv(
      env,
      "LATTICE_MCP_CLEANUP_RUNAWAY_CLAUDE_SEARCH_GRACE_MINUTES",
      DEFAULTS.runawayClaudeSearchGraceMinutes,
    ),
    runawayClaudeSearchMinCpuSeconds: numberEnv(
      env,
      "LATTICE_MCP_CLEANUP_RUNAWAY_CLAUDE_SEARCH_MIN_CPU_SECONDS",
      DEFAULTS.runawayClaudeSearchMinCpuSeconds,
    ),
  };
}

function processName(row) {
  return String(row.name || "").toLowerCase().replace(/\.exe$/, "");
}

function commandLine(row) {
  return String(row.commandLine || "");
}

function commandLineLower(row) {
  return commandLine(row).toLowerCase();
}

function isSembleMarker(row) {
  const cmd = commandLineLower(row);
  const path = String(row.path || "").toLowerCase();
  return (
    cmd.includes("semble[mcp]") ||
    cmd.includes("\\scripts\\semble.exe") ||
    cmd.includes("/scripts/semble") ||
    path.endsWith("\\semble.exe") ||
    path.endsWith("/semble")
  );
}

function isPlaywrightMarker(row) {
  const cmd = commandLineLower(row).replaceAll("\\", "/");
  return cmd.includes("@playwright/mcp") || cmd.includes("@playwright/mcp/cli.js");
}

function isCodexMcpMarker(row) {
  const cmd = commandLineLower(row).replaceAll("\\", "/");
  return (
    cmd.includes("./mcp/server.cjs") ||
    cmd.includes("app-server-broker.mjs") ||
    (cmd.includes("codex.js") && cmd.includes("app-server"))
  );
}

function isClaudeProcess(row) {
  return processName(row).startsWith("claude");
}

function isRunawayClaudeSearch(row) {
  if (!["pwsh", "powershell"].includes(processName(row))) return false;
  const cmd = commandLineLower(row);
  return (
    cmd.includes("get-childitem") &&
    cmd.includes("-recurse") &&
    cmd.includes("select-string") &&
    cmd.includes(".claude") &&
    !cmd.includes("-exclude")
  );
}

function buildIndex(rows) {
  const byId = new Map();
  const childrenByParent = new Map();

  for (const raw of rows) {
    const row = {
      ...raw,
      id: Number(raw.id),
      parentId: Number(raw.parentId || 0),
      cpuDeltaSeconds:
        raw.cpuDeltaSeconds === null || raw.cpuDeltaSeconds === undefined
          ? null
          : Number(raw.cpuDeltaSeconds),
      cpuSeconds: raw.cpuSeconds === null || raw.cpuSeconds === undefined ? null : Number(raw.cpuSeconds),
      handleCount: Number(raw.handleCount || 0),
      privateBytes: Number(raw.privateBytes || 0),
      threadCount: Number(raw.threadCount || 0),
      workingSet: Number(raw.workingSet || 0),
    };
    if (!Number.isFinite(row.id)) continue;
    byId.set(row.id, row);
  }

  for (const row of byId.values()) {
    if (!childrenByParent.has(row.parentId)) childrenByParent.set(row.parentId, []);
    childrenByParent.get(row.parentId).push(row.id);
  }

  return { byId, childrenByParent };
}

function ancestorSet(byId, pid) {
  const seen = new Set();
  let current = byId.get(pid);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.parentId);
  }
  return seen;
}

function descendantSet(childrenByParent, pid) {
  const seen = new Set();
  const stack = [pid];
  while (stack.length) {
    const next = stack.pop();
    if (seen.has(next)) continue;
    seen.add(next);
    for (const child of childrenByParent.get(next) || []) stack.push(child);
  }
  return seen;
}

function hoursSince(row, now) {
  if (!row.startTime) return 0;
  const started = Date.parse(row.startTime);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, (now - started) / 36e5);
}

function hasNewerSibling(byId, childrenByParent, row) {
  const started = Date.parse(row.startTime);
  if (!Number.isFinite(started)) return false;
  return (childrenByParent.get(row.parentId) || []).some((pid) => {
    if (pid === row.id) return false;
    const sibling = byId.get(pid);
    const siblingStarted = Date.parse(sibling?.startTime);
    return Number.isFinite(siblingStarted) && siblingStarted > started;
  });
}

function rootForMcpTree(byId, row) {
  let root = row;
  let parent = byId.get(row.parentId);
  const seen = new Set([row.id]);
  while (parent && !seen.has(parent.id) && MCP_WRAPPER_NAMES.has(processName(parent))) {
    root = parent;
    seen.add(parent.id);
    parent = byId.get(parent.parentId);
  }
  return root;
}

function hasDetachedActiveParent(byId, root) {
  const directParent = byId.get(root.parentId);
  if (!directParent || !ACTIVE_PARENT_NAMES.has(processName(directParent))) return false;

  const seen = new Set([root.id]);
  let current = directParent;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parentId <= 4) return false;

    const parent = byId.get(current.parentId);
    if (!parent) {
      return !EXPECTED_ROOT_PARENT_NAMES.has(processName(current));
    }
    current = parent;
  }

  return false;
}

function treeMetrics(root, byId, childrenByParent, protectedPids, now) {
  const tree = [...descendantSet(childrenByParent, root.id)].filter((pid) => !protectedPids.has(pid));
  const rows = tree.map((pid) => byId.get(pid)).filter(Boolean);
  const privateBytes = rows.reduce((sum, row) => sum + (row.privateBytes || 0), 0);
  const workingSet = rows.reduce((sum, row) => sum + (row.workingSet || 0), 0);
  const cpuDeltas = rows.map((row) => row.cpuDeltaSeconds).filter((value) => Number.isFinite(value));
  const cpuDeltaSeconds = cpuDeltas.length ? cpuDeltas.reduce((sum, value) => sum + value, 0) : null;
  const parent = byId.get(root.parentId);
  const privateMB = privateBytes / 1024 / 1024;
  const workingSetMB = workingSet / 1024 / 1024;

  return {
    ageHours: hoursSince(root, now),
    activeParentDetached: hasDetachedActiveParent(byId, root),
    cpuDeltaSeconds,
    parentMissing: root.parentId > 4 && !parent,
    parentName: parent ? processName(parent) : "",
    privateMB,
    tree,
    workingSetMB,
    workingSetRatio: privateMB > 0 ? workingSetMB / privateMB : 1,
  };
}

function scoreIdleMcp(kind, metrics, options) {
  const signals = [];
  let score = 0;

  if (metrics.privateMB >= options.highPrivateMb) {
    score += 25;
    signals.push(`private>=${options.highPrivateMb}MB`);
  }
  if (metrics.workingSetMB <= options.lowWorkingSetMb || metrics.workingSetRatio <= options.lowWorkingSetRatio) {
    score += 30;
    signals.push("low-working-set");
  }
  if (metrics.cpuDeltaSeconds !== null && metrics.cpuDeltaSeconds <= options.idleCpuSeconds) {
    score += 20;
    signals.push("cpu-idle");
  } else if (metrics.cpuDeltaSeconds !== null && metrics.cpuDeltaSeconds > options.idleCpuSeconds * 4) {
    score -= 40;
    signals.push("cpu-active");
  }
  if (metrics.ageHours >= 1) {
    score += 10;
    signals.push("age>=1h");
  }
  if (metrics.ageHours >= 4) {
    score += 10;
    signals.push("age>=4h");
  }
  if (kind === "playwright-mcp-tree" && metrics.ageHours >= options.playwrightGraceHours) {
    score += 25;
    signals.push(`playwright-age>=${options.playwrightGraceHours}h`);
  }
  if (ACTIVE_PARENT_NAMES.has(metrics.parentName)) {
    if (metrics.activeParentDetached) {
      score += 60;
      signals.push(`detached-active-parent=${metrics.parentName}`);
    } else {
      score -= 15;
      signals.push(`active-parent=${metrics.parentName}`);
    }
  }
  if (kind === "playwright-mcp-tree" && metrics.privateMB < 64) {
    score -= 30;
    signals.push("tiny-playwright-tree");
  }

  return {
    kill: score >= options.killScore,
    reason: `idle-leak-${kind}:score=${score}:${signals.join(",") || "no-signals"}`,
    score,
  };
}

function addTarget(targets, root, kind, metrics, reason) {
  if (targets.has(root.id)) return;
  targets.set(root.id, {
    pid: root.id,
    name: root.name,
    reason,
    ageHours: Number(metrics.ageHours.toFixed(2)),
    cpuDeltaSeconds: metrics.cpuDeltaSeconds === null ? null : Number(metrics.cpuDeltaSeconds.toFixed(3)),
    privateMB: Number(metrics.privateMB.toFixed(1)),
    workingSetMB: Number(metrics.workingSetMB.toFixed(1)),
    workingSetRatio: Number(metrics.workingSetRatio.toFixed(3)),
    kind,
    path: root.path || "",
  });
}

export function collectMcpCleanupTargets(rows, options = cleanupOptionsFromEnv(), ownPid = process.pid) {
  const now = Date.now();
  const { byId, childrenByParent } = buildIndex(rows);
  const protectedPids = ancestorSet(byId, ownPid);
  const targets = new Map();

  for (const row of byId.values()) {
    if (!isRunawayClaudeSearch(row) || protectedPids.has(row.id)) continue;
    const parent = byId.get(row.parentId);
    const metrics = treeMetrics(row, byId, childrenByParent, protectedPids, now);
    if (
      !isClaudeProcess(parent) ||
      metrics.ageHours * 60 < options.runawayClaudeSearchGraceMinutes ||
      metrics.cpuDeltaSeconds === null ||
      metrics.cpuDeltaSeconds < options.runawayClaudeSearchMinCpuSeconds ||
      !hasNewerSibling(byId, childrenByParent, row)
    ) {
      continue;
    }
    addTarget(
      targets,
      row,
      "runaway-claude-search-tree",
      metrics,
      "superseded-active-claude-recursive-search",
    );
  }

  for (const row of byId.values()) {
    const kind = isSembleMarker(row)
      ? "semble-mcp-tree"
      : isPlaywrightMarker(row)
        ? "playwright-mcp-tree"
        : isCodexMcpMarker(row)
          ? "codex-mcp-tree"
          : "";
    if (!kind || protectedPids.has(row.id)) continue;

    const root = rootForMcpTree(byId, row);
    if (protectedPids.has(root.id) || targets.has(root.id)) continue;

    const metrics = treeMetrics(root, byId, childrenByParent, protectedPids, now);
    const graceHours =
      kind === "semble-mcp-tree" ? options.sembleGraceHours : options.playwrightGraceHours;

    if (metrics.parentMissing && metrics.ageHours >= graceHours) {
      addTarget(targets, root, kind, metrics, `orphan-${kind}`);
      continue;
    }
    if (metrics.activeParentDetached && metrics.ageHours >= graceHours) {
      addTarget(targets, root, kind, metrics, `detached-parent-${kind}`);
      continue;
    }
    if (metrics.ageHours < graceHours) continue;

    const decision = scoreIdleMcp(kind, metrics, options);
    if (decision.kill) addTarget(targets, root, kind, metrics, decision.reason);
  }

  return [...targets.values()].sort((a, b) => b.privateMB - a.privateMB);
}

function killTree(pid, dryRun) {
  if (dryRun) return;
  if (process.platform === "win32") {
    execFileSync("taskkill.exe", ["/T", "/F", "/PID", String(pid)], {
      stdio: "ignore",
      timeout: 15_000,
      windowsHide: true,
    });
  } else {
    spawnSync("pkill", ["-TERM", "-P", String(pid)], { stdio: "ignore", timeout: 5000 });
    spawnSync("kill", ["-TERM", String(pid)], { stdio: "ignore", timeout: 5000 });
  }
}

export function cleanupMcpProcesses({
  dryRun = false,
  options = cleanupOptionsFromEnv(),
  rows,
  stderr = process.stderr,
} = {}) {
  const sampledRows = rows ?? getSampledProcessRows(options);
  const targets = collectMcpCleanupTargets(sampledRows, options);
  if (!targets.length) return [];

  stderr.write(
    `[mcp-cleanup] ${dryRun ? "would stop" : "stopping"} ${targets.length} stale MCP helper tree(s)\n`,
  );
  for (const target of targets) {
    stderr.write(
      `[mcp-cleanup] ${target.reason}: pid=${target.pid} name=${target.name} age=${target.ageHours}h private=${target.privateMB}MB ws=${target.workingSetMB}MB cpu=${target.cpuDeltaSeconds ?? "n/a"}s\n`,
    );
    try {
      killTree(target.pid, dryRun);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`[mcp-cleanup] failed pid=${target.pid}: ${message}\n`);
    }
  }

  return targets;
}

async function main() {
  if (!process.stdin.isTTY) {
    process.stdin.resume();
    process.stdin.on("data", () => {});
  }
  cleanupMcpProcesses({ dryRun: process.argv.includes("--dry-run") });
}

const isCli = isMainModule(import.meta.url);
if (isCli) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[mcp-cleanup] ${message}\n`);
  });
}
