#!/usr/bin/env node
/**
 * @lzong.tw/lattice barrel — the public API for `import ... from "@lzong.tw/lattice"`.
 *
 * Re-exports the v1 dispatcher, registry, context, timeouts, client enum,
 * and the most common constants. Test helpers live under
 * `@lzong.tw/lattice/testing`. Built-in providers and provider definitions
 * live under their own subpaths (e.g. `@lzong.tw/lattice/builtins/protection-provider`).
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
