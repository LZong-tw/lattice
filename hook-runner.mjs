#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const allowedHookTargets = new Set([
  "session-start.mjs",
  "pre-tool-policy.mjs",
  "post-tool-reminder.mjs",
  "stop-checklist.mjs",
]);

export const packageRoot = dirname(fileURLToPath(import.meta.url));

function parseEnvAssignment(raw) {
  const index = raw.indexOf("=");
  if (index <= 0) {
    throw new Error(`lattice: invalid --env assignment: ${raw}`);
  }

  const key = raw.slice(0, index);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`lattice: invalid env var name: ${key}`);
  }

  return [key, raw.slice(index + 1)];
}

export function parseRunnerArgs(argv, env = process.env) {
  const positional = [];
  const envUpdates = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--env") {
      i += 1;
      if (i >= argv.length) throw new Error("lattice: --env requires KEY=VALUE");
      const [key, value] = parseEnvAssignment(argv[i]);
      envUpdates[key] = value;
      continue;
    }

    if (arg.startsWith("--env=")) {
      const [key, value] = parseEnvAssignment(arg.slice("--env=".length));
      envUpdates[key] = value;
      continue;
    }

    if (arg === "--session-kind") {
      i += 1;
      if (i >= argv.length) throw new Error("lattice: --session-kind requires a value");
      envUpdates.LATTICE_SESSION_KIND = argv[i];
      continue;
    }

    if (arg.startsWith("--session-kind=")) {
      envUpdates.LATTICE_SESSION_KIND = arg.slice("--session-kind=".length);
      continue;
    }

    positional.push(arg);
  }

  return {
    target: positional[0] || env.LATTICE_HOOK_TARGET,
    client: positional[1] || env.LATTICE_HOOK_CLIENT,
    envUpdates,
  };
}

export function readStdinText() {
  return new Promise((resolveText) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolveText(raw));
  });
}

export function runHookTarget({ target, client, rawInput, env = process.env }) {
  if (!target || !allowedHookTargets.has(target)) {
    console.error(`lattice: invalid hook target: ${target || "<missing>"}`);
    return 1;
  }

  const scriptPath = resolve(packageRoot, target);
  if (!existsSync(scriptPath)) {
    console.error(`lattice: missing hook script: ${scriptPath}`);
    return 1;
  }

  const args = client ? [scriptPath, client] : [scriptPath];
  const result = spawnSync(process.execPath, args, {
    input: rawInput,
    encoding: "utf8",
    cwd: packageRoot,
    env,
    stdio: ["pipe", "inherit", "inherit"],
  });

  if (result.error) {
    console.error(`lattice: failed to run hook: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

export async function main(argv = process.argv.slice(2), opts = {}) {
  let parsed;
  try {
    parsed = parseRunnerArgs(argv, process.env);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }

  const env = { ...process.env, ...parsed.envUpdates };
  const rawInput =
    typeof opts.rawInput === "string"
      ? opts.rawInput
      : typeof globalThis.__latticeHookStdin === "string"
        ? globalThis.__latticeHookStdin
        : await readStdinText();

  process.exit(runHookTarget({
    target: parsed.target,
    client: parsed.client || opts.defaultClient,
    rawInput,
    env,
  }));
}

if (Array.isArray(globalThis.__latticeHookArgs)) {
  await main(globalThis.__latticeHookArgs, {
    rawInput: typeof globalThis.__latticeHookStdin === "string"
      ? globalThis.__latticeHookStdin
      : undefined,
  });
} else if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
