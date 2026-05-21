#!/usr/bin/env node
/**
 * post-tool-reminder.mjs — PostToolUse hook entry point.
 *
 * Delegates to the dispatcher. The edit-reminder logic now lives in the
 * editReminderProvider built-in (see register-builtins.mjs).
 */

import { readJsonStdin } from "./common.mjs";
import { dispatch, EVENT_NAMES } from "./dispatcher.mjs";
import "./register-builtins.mjs";

const client = process.argv[2];
const payload = await readJsonStdin();

try {
  process.exit(await dispatch(EVENT_NAMES.PostToolUse, payload, { client }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`lattice: PostToolUse dispatch error: ${message}\n`);
  process.exit(1);
}
