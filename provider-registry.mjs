#!/usr/bin/env node
/**
 * provider-registry.mjs — explicit provider selection and bootstrap contract.
 *
 * Environment-variable contract:
 * - LATTICE_PROVIDERS=<name1,name2>   Ordered provider list. Takes precedence.
 * - LATTICE_PROVIDER=<name>           Single provider name.
 * - LATTICE_PROVIDER=none|off|false|0 Disables all providers.
 *   (The same disable tokens also work in LATTICE_PROVIDERS.)
 *
 * Default when neither env var is set: ["serena"].
 *
 * The default selection path remains permissive at the selection/import layer so
 * current Serena consumers keep the historical fallback:
 * - if ./serena/bootstrap.mjs is absent or fails to import, lattice skips it
 * - if Serena itself returns a non-zero exit code, that exit code still surfaces
 *
 * Future providers should add a bootstrap entry to providerRegistry below.
 */

const DISABLE_PROVIDER_TOKENS = new Set(["none", "off", "false", "0"]);

export const DEFAULT_PROVIDER_NAMES = Object.freeze(["serena"]);

export const providerRegistry = Object.freeze({
  serena: Object.freeze({
    name: "serena",
    async bootstrap(client) {
      try {
        const { bootstrapSerena } = await import("./serena/bootstrap.mjs");
        return bootstrapSerena(client);
      } catch {
        return 0;
      }
    },
  }),
  // "mcp-local-rag": Object.freeze({
  //   async bootstrap(client) {
  //     const { bootstrapMcpLocalRag } = await import("./mcp-local-rag/bootstrap.mjs");
  //     return bootstrapMcpLocalRag(client);
  //   },
  // }),
});

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeProviderName(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function parseProviderList(raw) {
  if (typeof raw !== "string") {
    return [];
  }

  const names = [];
  const seen = new Set();

  for (const token of raw.split(",")) {
    const normalized = normalizeProviderName(token);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    names.push(normalized);
  }

  if (names.length === 0) {
    return [];
  }

  const providers = names.filter((name) => !DISABLE_PROVIDER_TOKENS.has(name));
  return providers.length === 0 ? [] : providers;
}

function getSelectionSource(env) {
  if (hasText(env.LATTICE_PROVIDERS)) {
    return { name: "LATTICE_PROVIDERS", raw: env.LATTICE_PROVIDERS };
  }

  if (hasText(env.LATTICE_PROVIDER)) {
    return { name: "LATTICE_PROVIDER", raw: env.LATTICE_PROVIDER };
  }

  return { name: "default", raw: "" };
}

export function resolveSelectedProviders({ env = process.env, registry = providerRegistry } = {}) {
  const source = getSelectionSource(env);
  const requestedNames =
    source.name === "default" ? [...DEFAULT_PROVIDER_NAMES] : parseProviderList(source.raw);
  const availableProviderNames = Object.keys(registry);
  const providers = [];
  const unknownNames = [];

  for (const name of requestedNames) {
    const entry = registry[name];
    if (!entry) {
      unknownNames.push(name);
      continue;
    }

    providers.push({
      name: entry.name ?? name,
      bootstrap: entry.bootstrap,
    });
  }

  return {
    availableProviderNames,
    providers,
    requestedNames,
    source: source.name,
    strict: source.name !== "default",
    unknownNames,
  };
}

function normalizeExitCode(value) {
  if (value == null) {
    return 0;
  }

  if (Number.isInteger(value)) {
    return value;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? 1 : parsed;
}

function defaultOnError(message) {
  process.stderr.write(`lattice: ${message}\n`);
}

export async function bootstrapProviders(
  client,
  { env = process.env, registry = providerRegistry, onError = defaultOnError } = {},
) {
  const selection = resolveSelectedProviders({ env, registry });

  if (selection.strict && selection.unknownNames.length > 0) {
    const suffix = selection.unknownNames.length === 1 ? "" : "s";
    onError(
      `unknown provider${suffix} in ${selection.source}: ${selection.unknownNames.join(", ")}. ` +
        `Available providers: ${selection.availableProviderNames.join(", ") || "(none)"}.`,
    );
    return 1;
  }

  for (const provider of selection.providers) {
    try {
      const exitCode = normalizeExitCode(await provider.bootstrap(client));
      if (exitCode !== 0) {
        return exitCode;
      }
    } catch (error) {
      if (!selection.strict) {
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      onError(`provider "${provider.name}" bootstrap failed: ${message}`);
      return 1;
    }
  }

  return 0;
}
