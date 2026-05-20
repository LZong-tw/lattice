#!/usr/bin/env node
import { readJsonStdin } from "./common.mjs";
import { maybePrintCommitCheckpointReminder } from "./commit-checkpoint.mjs";
import { bootstrapProviders } from "./provider-registry.mjs";
import { validateRequiredSerenaMcpConfig } from "./serena/mcp-config-guard.mjs";
import { validateRequiredSembleMcpConfig } from "./semble/mcp-config-guard.mjs";

await readJsonStdin();
maybePrintCommitCheckpointReminder();

const client = process.argv[2];

if (process.env.LATTICE_REQUIRE_SERENA_MCP === "1") {
  const result = validateRequiredSerenaMcpConfig(client);
  if (!result.ok) {
    process.stderr.write(
      [
        "lattice: Serena MCP configuration is required for this project.",
        ...result.failures.map((failure) => `- ${failure}`),
        "Use stdio MCP config so the client attaches Serena tools during session startup.",
      ].join("\n") + "\n",
    );
    process.exit(1);
  }
}

if (process.env.LATTICE_REQUIRE_SEMBLE_MCP === "1") {
  const result = validateRequiredSembleMcpConfig(client);
  if (!result.ok) {
    process.stderr.write(
      [
        "lattice: Semble MCP configuration is required for this project.",
        ...result.failures.map((failure) => `- ${failure}`),
        "Use stdio MCP config so the client attaches Semble tools during session startup.",
      ].join("\n") + "\n",
    );
    process.exit(1);
  }
}

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
