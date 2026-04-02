#!/usr/bin/env node
import { readJsonStdin } from "./common.mjs";
import { maybePrintCommitCheckpointReminder } from "./commit-checkpoint.mjs";

await readJsonStdin();
maybePrintCommitCheckpointReminder();

const client = process.argv[2];

// Serena integration is optional and lives in serena/bootstrap.mjs.
// If the module is missing or the client is unrecognised, skip silently.
try {
  const { bootstrapSerena } = await import("./serena/bootstrap.mjs");
  process.exit(bootstrapSerena(client));
} catch {
  process.exit(0);
}
