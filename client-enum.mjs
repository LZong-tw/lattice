#!/usr/bin/env node
/**
 * client-enum.mjs — canonical AI client identifiers and normalization.
 *
 * The pre-v1 codebase uses bare client strings (`claude`, `copilot`,
 * `codex`) passed through `process.argv[2]`. v1 contract pins these to
 * canonical forms while a compat shim accepts the bare inputs and emits a
 * one-time deprecation warning per bare form. Bare support is removed in
 * v2.
 */

/**
 * Canonical client identifiers. Provider authors should import this
 * constant and compare against its values rather than hard-coding strings.
 */
export const CLIENTS = Object.freeze({
  CLAUDE_CODE: "claude-code",
  CODEX: "codex",
  COPILOT_CLI: "copilot-cli",
});

export const ALL_CLIENTS = Object.freeze([
  CLIENTS.CLAUDE_CODE,
  CLIENTS.CODEX,
  CLIENTS.COPILOT_CLI,
]);

const CANONICAL_SET = new Set(ALL_CLIENTS);

const BARE_TO_CANONICAL = Object.freeze({
  claude: CLIENTS.CLAUDE_CODE,
  copilot: CLIENTS.COPILOT_CLI,
  codex: CLIENTS.CODEX,
});

const warnedBareForms = new Set();

function defaultWarn(message) {
  process.stderr.write(`${message}\n`);
}

/**
 * Map a raw client string to its canonical form.
 *
 * - Canonical inputs pass through unchanged.
 * - Bare inputs (`claude`, `copilot`, `codex`) are mapped to the canonical
 *   form and emit one deprecation warning per bare form per process.
 * - Unknown inputs are returned as-is so callers can apply
 *   `supportedClients` filtering or their own validation.
 *
 * @param {unknown} raw
 * @param {{ warn?: (message: string) => void, resetWarnings?: boolean }} [opts]
 * @returns {string | undefined}
 */
export function normalizeClient(raw, opts = {}) {
  if (opts.resetWarnings) {
    warnedBareForms.clear();
  }

  if (typeof raw !== "string") {
    return undefined;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (CANONICAL_SET.has(trimmed)) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  if (CANONICAL_SET.has(lower)) {
    return lower;
  }

  const canonical = BARE_TO_CANONICAL[lower];
  if (canonical) {
    if (!warnedBareForms.has(lower)) {
      warnedBareForms.add(lower);
      const warn = opts.warn ?? defaultWarn;
      warn(
        `lattice: client identifier "${lower}" is deprecated; use "${canonical}". ` +
          "Bare client identifiers will be removed in lattice v2.",
      );
    }
    return canonical;
  }

  return trimmed;
}

/**
 * Strict variant: throws on unknown input. Used by the dispatcher edge
 * where unrecognized clients indicate caller misconfiguration.
 *
 * @param {unknown} raw
 * @param {{ warn?: (message: string) => void }} [opts]
 * @returns {string}
 */
export function normalizeClientStrict(raw, opts = {}) {
  const normalized = normalizeClient(raw, opts);
  if (!normalized || (!CANONICAL_SET.has(normalized) && !BARE_TO_CANONICAL[normalized])) {
    throw new Error(
      `lattice: unknown client identifier "${raw}". ` +
        `Expected one of: ${ALL_CLIENTS.join(", ")}.`,
    );
  }
  return normalized;
}

/**
 * Check whether a client identifier (canonical or bare) is recognized.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isKnownClient(raw) {
  if (typeof raw !== "string") return false;
  const lower = raw.trim().toLowerCase();
  return CANONICAL_SET.has(lower) || Object.prototype.hasOwnProperty.call(BARE_TO_CANONICAL, lower);
}

/**
 * Test-only: clears the warned-bare-forms memo so tests can assert the
 * one-time warning behavior reliably.
 */
export function __resetClientWarnings() {
  warnedBareForms.clear();
}
