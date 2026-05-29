import { main } from "./hook-runner.mjs";

const argv = Array.isArray(globalThis.__latticeHookArgs)
  ? globalThis.__latticeHookArgs
  : process.argv.slice(2);

await main(argv, { defaultClient: "codex" });
