#!/usr/bin/env node
import { readJsonStdin } from "./common.mjs";
import { maybePrintCommitCheckpointReminder } from "./commit-checkpoint.mjs";
import { bootstrapProviders } from "./provider-registry.mjs";

await readJsonStdin();
maybePrintCommitCheckpointReminder();

const client = process.argv[2];

// Provider selection is driven by provider-registry.mjs.
// Unknown explicit providers fail fast; the default Serena selection preserves
// the historical fallback when serena/bootstrap.mjs is absent.
try {
  process.exit(await bootstrapProviders(client));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`lattice: provider bootstrap error: ${message}\n`);
  process.exit(1);
}
