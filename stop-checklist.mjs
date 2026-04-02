#!/usr/bin/env node
import { messages, printMessage, readJsonStdin } from "./common.mjs";

await readJsonStdin();
printMessage(`\n${messages.stopChecklist}`);
