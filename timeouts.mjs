#!/usr/bin/env node
/**
 * timeouts.mjs — per-event timeout resolution.
 *
 * Every dispatch gets a per-event timeout that backs the AbortSignal on
 * LatticeContext. Defaults are tuned to Anthropic's typical hook envelope
 * and overridable per-event via LATTICE_TIMEOUT_<SCREAMING_SNAKE>=ms.
 *
 * Sync `spawnSync`-style handlers cannot be interrupted by the signal;
 * those handlers MUST set their own subprocess timeout below the event's
 * budget. The dispatcher fires the signal anyway so async siblings can
 * bail.
 */

/**
 * Default per-event timeouts in milliseconds. Frozen.
 */
export const DEFAULT_TIMEOUTS = Object.freeze({
  PreToolUse: 5_000,
  PostToolUse: 5_000,
  Stop: 60_000,
  SessionStart: 30_000,
  PostCompact: 10_000,
  Notification: 5_000,
});

/**
 * Fallback budget for any event that is not in DEFAULT_TIMEOUTS. Also the
 * fallback when LATTICE_TIMEOUT_DEFAULT is unset.
 */
export const DEFAULT_FALLBACK_MS = 30_000;

/**
 * Convert a PascalCase event name to SCREAMING_SNAKE_CASE for env var
 * lookup. `PreToolUse` → `PRE_TOOL_USE`.
 *
 * @param {string} event
 * @returns {string}
 */
export function pascalToScreamingSnake(event) {
  if (typeof event !== "string" || event.length === 0) {
    return "";
  }

  return event
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
}

function parsePositiveInt(raw, sourceLabel) {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== trimmed) {
    throw new Error(
      `lattice: invalid timeout value in ${sourceLabel}: "${raw}". ` +
        "Expected a positive integer (milliseconds).",
    );
  }

  return parsed;
}

/**
 * Resolve the timeout in ms for an event.
 *
 * Precedence:
 * 1. LATTICE_TIMEOUT_<EVENT_IN_SCREAMING_SNAKE>
 * 2. DEFAULT_TIMEOUTS[event]
 * 3. LATTICE_TIMEOUT_DEFAULT
 * 4. DEFAULT_FALLBACK_MS (30_000)
 *
 * @param {string} event
 * @param {{ env?: NodeJS.ProcessEnv, defaults?: Record<string, number> }} [opts]
 * @returns {number}
 */
export function resolveTimeout(event, opts = {}) {
  const env = opts.env ?? process.env;
  const defaults = opts.defaults ?? DEFAULT_TIMEOUTS;

  const eventScreaming = pascalToScreamingSnake(event);
  if (eventScreaming.length > 0) {
    const eventKey = `LATTICE_TIMEOUT_${eventScreaming}`;
    const fromEvent = parsePositiveInt(env[eventKey], eventKey);
    if (fromEvent !== undefined) {
      return fromEvent;
    }
  }

  const fromDefaults = defaults[event];
  if (typeof fromDefaults === "number" && fromDefaults > 0) {
    return fromDefaults;
  }

  const fromGlobal = parsePositiveInt(env.LATTICE_TIMEOUT_DEFAULT, "LATTICE_TIMEOUT_DEFAULT");
  if (fromGlobal !== undefined) {
    return fromGlobal;
  }

  return DEFAULT_FALLBACK_MS;
}
