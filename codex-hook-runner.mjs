import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const allowedTargets = new Set([
  "session-start.mjs",
  "pre-tool-policy.mjs",
]);

function readStdin() {
  return new Promise((resolveText) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolveText(raw));
  });
}

const packageRoot = dirname(fileURLToPath(import.meta.url));
const target = process.env.LATTICE_HOOK_TARGET;
const client = process.env.LATTICE_HOOK_CLIENT || "codex";
const rawInput = typeof globalThis.__latticeHookStdin === "string"
  ? globalThis.__latticeHookStdin
  : await readStdin();

if (!target || !allowedTargets.has(target)) {
  console.error(`lattice: invalid Codex hook target: ${target || "<missing>"}`);
  process.exit(1);
}

const scriptPath = resolve(packageRoot, target);
if (!existsSync(scriptPath)) {
  console.error(`lattice: missing Codex hook script: ${scriptPath}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [scriptPath, client], {
  input: rawInput,
  encoding: "utf8",
  cwd: packageRoot,
  env: process.env,
  stdio: ["pipe", "inherit", "inherit"],
});

if (result.error) {
  console.error(`lattice: failed to run Codex hook: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
