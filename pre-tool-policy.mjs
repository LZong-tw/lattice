#!/usr/bin/env node
/**
 * pre-tool-policy.mjs — PreToolUse hook entry point.
 *
 * Delegates to the dispatcher. File protection, commit-gate denial,
 * commit-checkpoint reminders, and screenshot reminders are now
 * implemented by built-in providers (see register-builtins.mjs).
 */

import { readJsonStdin } from "./common.mjs";
import { dispatch, EVENT_NAMES } from "./dispatcher.mjs";
import "./register-builtins.mjs";

const client = process.argv[2];
const payload = await readJsonStdin();

try {
  process.exit(await dispatch(EVENT_NAMES.PreToolUse, payload, { client }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`lattice: PreToolUse dispatch error: ${message}\n`);
  process.exit(1);
}
