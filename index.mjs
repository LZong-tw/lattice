#!/usr/bin/env node
/**
 * @lattice/core barrel — the public API for `import ... from "@lattice/core"`.
 *
 * Re-exports the v1 dispatcher, registry, context, timeouts, client enum,
 * and the most common constants. Test helpers live under
 * `@lattice/core/testing`. Built-in providers and provider definitions
 * live under their own subpaths (e.g. `@lattice/core/builtins/protection-provider`).
 */

export {
  CONTRACT_VERSION,
  EVENT_NAMES,
  PERMISSION_DECISIONS,
  STOP_DECISIONS,
  dispatch,
} from "./dispatcher.mjs";

export {
  clearRegistrations,
  getRegisteredProviders,
  registerProvider,
  resolveEffectiveProviders,
  unregisterProvider,
} from "./provider-registry.mjs";

export { createContext } from "./context.mjs";

export {
  ALL_CLIENTS,
  CLIENTS,
  isKnownClient,
  normalizeClient,
  normalizeClientStrict,
} from "./client-enum.mjs";

export {
  DEFAULT_FALLBACK_MS,
  DEFAULT_TIMEOUTS,
  resolveTimeout,
} from "./timeouts.mjs";
