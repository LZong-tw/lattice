#!/usr/bin/env node
/**
 * session-start.mjs — SessionStart hook entry point.
 *
 * Thin shim that registers built-in providers via `register-builtins.mjs`
 * (side-effect import) then dispatches the SessionStart event. The resume
 * recovery checklist stays inline because it operates on pre-dispatch
 * payload metadata.
 */

import { messages, printMessage, readJsonStdin } from "./common.mjs";
import { dispatch, EVENT_NAMES } from "./dispatcher.mjs";
import "./register-builtins.mjs";

const payload = await readJsonStdin();
const client = process.argv[2];

const sessionKind =
  process.env.LATTICE_SESSION_KIND?.trim().toLowerCase() ||
  (typeof payload.matcher === "string" ? payload.matcher.toLowerCase() : "") ||
  (typeof payload.session_kind === "string" ? payload.session_kind.toLowerCase() : "");

if (sessionKind === "resume") {
  printMessage(messages.resumeRecovery);
}

try {
  process.exit(await dispatch(EVENT_NAMES.SessionStart, payload, { client }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`lattice: SessionStart dispatch error: ${message}\n`);
  process.exit(1);
}
