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

/**
 * @deprecated Will be removed in v2. Use `dispatch()` from
 * `@lattice/core/dispatcher` and `registerProvider()` from
 * `@lattice/core/provider-registry` instead.
 */
export const DEFAULT_PROVIDER_NAMES = Object.freeze(["serena"]);

/**
 * @deprecated Will be removed in v2. Use `dispatch()` from
 * `@lattice/core/dispatcher` and `registerProvider()` from
 * `@lattice/core/provider-registry` instead.
 */
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

/**
 * @deprecated Will be removed in v2. Use `dispatch()` from
 * `@lattice/core/dispatcher` and `registerProvider()` from
 * `@lattice/core/provider-registry` instead.
 */
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

/**
 * @deprecated Will be removed in v2. Use `dispatch()` from
 * `@lattice/core/dispatcher` and `registerProvider()` from
 * `@lattice/core/provider-registry` instead.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   registry?: Record<string, { name?: string, bootstrap: (client: string) => unknown }>
 * }} [opts]
 */
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

/**
 * @deprecated Will be removed in v2. Use `dispatch()` from
 * `@lattice/core/dispatcher` and `registerProvider()` from
 * `@lattice/core/provider-registry` instead.
 *
 * @param {string} client
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   registry?: Record<string, { name?: string, bootstrap: (client: string) => unknown }>,
 *   onError?: (message: string) => void,
 * }} [opts]
 */
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

// ---------------------------------------------------------------------------
// v1 contract: runtime registration + effective-provider resolution.
//
// Sits alongside the legacy `bootstrapProviders` path. New consumers (the
// dispatcher) read from `resolveEffectiveProviders`, which combines runtime
// registrations with auto-wrapped legacy `{ bootstrap }` entries from
// `providerRegistry`. Legacy callers continue to use `bootstrapProviders`
// unchanged.
// ---------------------------------------------------------------------------

const runtimeRegistry = new Map();
const legacyWrapWarned = new Set();

const CONTRACT_VERSION = 1;

function validateProviderDefinition(definition) {
  if (!definition || typeof definition !== "object") {
    throw new Error("lattice: provider definition must be a non-null object");
  }
  if (typeof definition.name !== "string" || definition.name.length === 0) {
    throw new Error("lattice: provider definition requires a non-empty name");
  }
  if (definition.contractVersion !== CONTRACT_VERSION) {
    throw new Error(
      `lattice: provider "${definition.name}" declares contractVersion=${definition.contractVersion}; ` +
        `expected ${CONTRACT_VERSION}`,
    );
  }
  if (definition.handlers != null && typeof definition.handlers !== "object") {
    throw new Error(
      `lattice: provider "${definition.name}" handlers must be an object map`,
    );
  }
  if (definition.validate != null && typeof definition.validate !== "function") {
    throw new Error(
      `lattice: provider "${definition.name}" validate must be a function`,
    );
  }
  if (
    definition.supportedClients != null &&
    !Array.isArray(definition.supportedClients)
  ) {
    throw new Error(
      `lattice: provider "${definition.name}" supportedClients must be an array of client identifiers`,
    );
  }
}

/**
 * Register a v1-contract provider for dispatch. Last write wins per name —
 * re-registration is allowed and lets test suites swap providers between
 * cases. Definitions are frozen on entry.
 *
 * @param {Object} definition
 * @param {string} definition.name
 * @param {1} definition.contractVersion
 * @param {Object<string, Function>} [definition.handlers]
 * @param {Function} [definition.validate]
 * @param {string[]} [definition.supportedClients]
 */
export function registerProvider(definition) {
  validateProviderDefinition(definition);

  const frozen = Object.freeze({
    name: definition.name,
    contractVersion: definition.contractVersion,
    handlers: definition.handlers ? Object.freeze({ ...definition.handlers }) : undefined,
    validate: definition.validate,
    supportedClients: definition.supportedClients
      ? Object.freeze([...definition.supportedClients])
      : undefined,
  });

  runtimeRegistry.set(frozen.name, frozen);
  return frozen;
}

/**
 * Remove a runtime registration. Test-only.
 * @param {string} name
 */
export function unregisterProvider(name) {
  runtimeRegistry.delete(name);
}

/**
 * Drop every runtime registration. Test-only.
 */
export function clearRegistrations() {
  runtimeRegistry.clear();
  legacyWrapWarned.clear();
}

/**
 * Snapshot of runtime registrations. Order is insertion order.
 */
export function getRegisteredProviders() {
  return Array.from(runtimeRegistry.values());
}

function wrapLegacyProvider(name, legacyEntry, onWarn) {
  if (!legacyWrapWarned.has(name)) {
    legacyWrapWarned.add(name);
    onWarn(
      `lattice: provider "${name}" uses the legacy {bootstrap} shape; auto-wrapping as a SessionStart handler. ` +
        "Migrate to { name, contractVersion: 1, handlers: { SessionStart } } before lattice v2.",
    );
  }

  return Object.freeze({
    name,
    contractVersion: CONTRACT_VERSION,
    handlers: Object.freeze({
      SessionStart: async (ctx) => {
        // Legacy `bootstrap(client)` cannot be truly cancelled — its
        // signature predates ctx.signal. Race it against the abort so
        // dispatcher timeouts surface as errors instead of hanging the
        // hook; the bootstrap itself keeps running in the background
        // until it finishes on its own.
        const bootstrapCall = Promise.resolve(legacyEntry.bootstrap(ctx.client));
        const signal = ctx.signal;
        const raced =
          signal == null
            ? bootstrapCall
            : Promise.race([
                bootstrapCall,
                new Promise((_, reject) => {
                  const onAbort = () => {
                    signal.removeEventListener("abort", onAbort);
                    reject(signal.reason ?? new Error("lattice: legacy bootstrap aborted"));
                  };
                  if (signal.aborted) {
                    onAbort();
                  } else {
                    signal.addEventListener("abort", onAbort, { once: true });
                  }
                }),
              ]);
        const exitCode = normalizeExitCode(await raced);
        return exitCode === 0 ? {} : { exitCode };
      },
    }),
    validate: undefined,
    supportedClients: undefined,
  });
}

/**
 * Resolve the providers that should participate in this dispatch.
 *
 * Combines runtime registrations with auto-wrapped legacy `providerRegistry`
 * entries, then applies the same `LATTICE_PROVIDERS` / `LATTICE_PROVIDER`
 * selection semantics used by `bootstrapProviders`. Unknown explicit
 * selections still fail fast.
 *
 * @param {Object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {Map<string, Object>} [opts.runtime]
 * @param {Object} [opts.legacy]
 * @param {(message: string) => void} [opts.onWarn]
 * @returns {{
 *   providers: Array<Object>,
 *   strict: boolean,
 *   source: string,
 *   unknownNames: string[],
 *   availableProviderNames: string[],
 *   requestedNames: string[],
 * }}
 */
export function resolveEffectiveProviders(opts = {}) {
  const env = opts.env ?? process.env;
  const runtime = opts.runtime ?? runtimeRegistry;
  const legacy = opts.legacy ?? providerRegistry;
  const onWarn = opts.onWarn ?? defaultOnError;

  const availableProviderNames = Array.from(
    new Set([...Object.keys(legacy), ...runtime.keys()]),
  );

  const source = getSelectionSource(env);
  // Default selection differs between the legacy bootstrap path and the
  // new dispatcher path. Legacy stays on DEFAULT_PROVIDER_NAMES (serena
  // only) for backwards compat. The dispatcher path activates every
  // registered provider by default so built-in event handlers
  // (protection, stop-checklist, reminders, ...) participate without
  // requiring the consumer to opt in explicitly.
  const requestedNames =
    source.name === "default" ? [...availableProviderNames] : parseProviderList(source.raw);
  const strict = source.name !== "default";

  const disabled = new Set(parseProviderList(env.LATTICE_DISABLE ?? ""));

  const providers = [];
  const unknownNames = [];

  for (const name of requestedNames) {
    if (disabled.has(name)) continue;
    if (runtime.has(name)) {
      providers.push(runtime.get(name));
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(legacy, name)) {
      providers.push(wrapLegacyProvider(name, legacy[name], onWarn));
      continue;
    }
    unknownNames.push(name);
  }

  return {
    providers,
    strict,
    source: source.name,
    unknownNames,
    availableProviderNames,
    requestedNames,
  };
}
