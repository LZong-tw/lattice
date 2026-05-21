#!/usr/bin/env node
/**
 * context.mjs — LatticeContext factory.
 *
 * One context is constructed per dispatcher invocation per provider. The
 * context carries everything a handler needs (client, event, cwd, repo
 * root, per-provider state directory, env snapshot, abort signal, logger)
 * and nothing more. Handlers MUST NOT reach for `process.env` or
 * `process.cwd()` directly — they read `ctx.env` and `ctx.cwd` so the
 * dispatcher can swap inputs for testing and so handlers stay pure.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { repoRoot as resolvedRepoRoot } from "./common.mjs";
import { normalizeClient } from "./client-enum.mjs";
import { resolveTimeout } from "./timeouts.mjs";

const CONTRACT_VERSION = 1;

function freezeEnvSnapshot(env) {
  const snapshot = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (typeof value === "string") {
      snapshot[key] = value;
    }
  }
  return Object.freeze(snapshot);
}

function resolveStateRoot(env) {
  const xdg = env.XDG_STATE_HOME?.trim();
  if (xdg) return xdg;
  return path.join(os.homedir(), ".local", "state");
}

/**
 * Sanitize a single path segment by collapsing anything not in
 * [A-Za-z0-9_.-] to `_`. Used to keep provider names from escaping
 * their dedicated state directory.
 */
function sanitizeSegment(segment) {
  return String(segment).replace(/[^A-Za-z0-9_.-]/g, "_");
}

function resolveProviderStateDir(providerName, env) {
  const raw = String(providerName);

  // Split off an optional `@scope/` prefix so scoped names stay legible
  // on disk (`@lattice/clawback` → `@lattice/clawback`, not `_lattice_clawback`).
  let safeName;
  if (raw.startsWith("@")) {
    const firstSlash = raw.indexOf("/");
    if (firstSlash > 0) {
      const scope = "@" + sanitizeSegment(raw.slice(1, firstSlash));
      const rest = raw
        .slice(firstSlash + 1)
        .split("/")
        .map(sanitizeSegment)
        .join("/");
      safeName = `${scope}/${rest}`;
    } else {
      safeName = "@" + sanitizeSegment(raw.slice(1));
    }
  } else {
    safeName = raw
      .split("/")
      .map(sanitizeSegment)
      .join("/");
  }

  const stateRoot = resolveStateRoot(env);
  const providersRoot = path.resolve(stateRoot, "lattice", "providers");
  const resolved = path.resolve(providersRoot, safeName);
  const boundary = providersRoot + path.sep;
  if (resolved !== providersRoot && !resolved.startsWith(boundary)) {
    throw new Error("lattice: providerName escapes state directory");
  }
  return resolved;
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    if (err && err.code !== "EEXIST") {
      throw err;
    }
  }
}

function makeLogger(providerName, write) {
  const prefix = `lattice[${providerName}]:`;
  return (message) => {
    write(`${prefix} ${String(message)}\n`);
  };
}

function buildSignal({ event, env, abortController }) {
  const controller = abortController ?? new AbortController();
  const timeoutMs = resolveTimeout(event, { env });
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new Error(`lattice: event "${event}" timed out after ${timeoutMs}ms`));
    }
  }, timeoutMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return { signal: controller.signal, controller, timer, timeoutMs };
}

/**
 * Construct a LatticeContext for a single provider invocation.
 *
 * @param {Object} input
 * @param {string} input.client          Already-normalized canonical client identifier.
 * @param {string} input.event           PascalCase Anthropic event name.
 * @param {string} input.providerName    Provider name (drives stateDir, log prefix).
 * @param {string} [input.cwd]           Defaults to process.cwd().
 * @param {string} [input.repoRoot]      Defaults to common.mjs repoRoot.
 * @param {NodeJS.ProcessEnv} [input.env] Defaults to process.env.
 * @param {AbortController} [input.abortController] Provide your own to drive cancellation externally.
 * @param {(line: string) => void} [input.stderrWrite] Override for log target (testing).
 * @param {boolean} [input.skipStateDirCreation] Skip mkdir (testing).
 * @returns {{ ctx: LatticeContext, dispose: () => void }}
 */
export function createContext(input) {
  const env = input.env ?? process.env;
  const envSnapshot = freezeEnvSnapshot(env);

  const client = normalizeClient(input.client) ?? input.client;
  const event = input.event;
  if (typeof event !== "string" || event.length === 0) {
    throw new Error("lattice: createContext requires a non-empty event string");
  }

  const providerName = input.providerName;
  if (typeof providerName !== "string" || providerName.length === 0) {
    throw new Error("lattice: createContext requires a providerName");
  }

  const cwd = input.cwd ?? process.cwd();
  const repoRoot = input.repoRoot ?? resolvedRepoRoot;
  const stateDir = resolveProviderStateDir(providerName, env);

  if (!input.skipStateDirCreation) {
    ensureDir(stateDir);
  }

  const stderrWrite = input.stderrWrite ?? ((line) => process.stderr.write(line));
  const log = makeLogger(providerName, stderrWrite);

  const { signal, controller, timer, timeoutMs } = buildSignal({
    event,
    env,
    abortController: input.abortController,
  });

  /** @type {LatticeContext} */
  const ctx = Object.freeze({
    client,
    contractVersion: CONTRACT_VERSION,
    event,
    cwd,
    repoRoot,
    stateDir,
    log,
    env: envSnapshot,
    signal,
  });

  const dispose = () => {
    clearTimeout(timer);
    if (!controller.signal.aborted) {
      controller.abort(new Error("lattice: context disposed"));
    }
  };

  return { ctx, dispose, timeoutMs };
}

/**
 * @typedef {Object} LatticeContext
 * @property {string} client
 * @property {1} contractVersion
 * @property {string} event
 * @property {string} cwd
 * @property {string} repoRoot
 * @property {string} stateDir
 * @property {(message: string) => void} log
 * @property {Readonly<Record<string, string>>} env
 * @property {AbortSignal} signal
 */
