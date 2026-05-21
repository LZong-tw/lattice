#!/usr/bin/env node
/**
 * stop-checklist.mjs — Stop hook entry point.
 *
 * Delegates to the dispatcher. The checklist message and the optional
 * verification gate (LATTICE_VERIFY_ON_STOP=1) now live in
 * stopChecklistProvider (see register-builtins.mjs). Stop is currently
 * Claude-only in Anthropic's spec; we default the client to claude-code
 * when none is provided via argv.
 */

import { readJsonStdin } from "./common.mjs";
import { CLIENTS } from "./client-enum.mjs";
import { dispatch, EVENT_NAMES } from "./dispatcher.mjs";
import "./register-builtins.mjs";

const client = process.argv[2] ?? CLIENTS.CLAUDE_CODE;
const payload = await readJsonStdin();

try {
  process.exit(await dispatch(EVENT_NAMES.Stop, payload, { client }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`lattice: Stop dispatch error: ${message}\n`);
  process.exit(1);
}
