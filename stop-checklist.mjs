#!/usr/bin/env node
import { messages, printMessage, readJsonStdin } from "./common.mjs";
import { buildStopBlockOutput, runProjectVerification } from "./verification/verify.mjs";

const payload = await readJsonStdin();
printMessage(`\n${messages.stopChecklist}`);

if (process.env.LATTICE_VERIFY_ON_STOP !== "1") {
  process.exit(0);
}

const result = runProjectVerification({ payload });
if (result.status === "failed") {
  process.stdout.write(`${JSON.stringify(buildStopBlockOutput(result.message))}\n`);
} else if (result.status === "allowed") {
  process.stdout.write(`${JSON.stringify({ additionalContext: result.message })}\n`);
} else if (process.env.LATTICE_VERIFY_VERBOSE === "1") {
  printMessage(`lattice verification: ${result.message}`);
}
