/**
 * Type declarations for the lattice v1 public API.
 * Mirrors the JSDoc annotations in the runtime `.mjs` files.
 */

// ---------------------------------------------------------------------------
// client-enum
// ---------------------------------------------------------------------------

export type LatticeClient = "claude-code" | "codex" | "copilot-cli";

export const CLIENTS: {
  readonly CLAUDE_CODE: "claude-code";
  readonly CODEX: "codex";
  readonly COPILOT_CLI: "copilot-cli";
};

export const ALL_CLIENTS: ReadonlyArray<LatticeClient>;

export function normalizeClient(
  raw: unknown,
  opts?: { warn?: (message: string) => void; resetWarnings?: boolean },
): string | undefined;

export function normalizeClientStrict(
  raw: unknown,
  opts?: { warn?: (message: string) => void },
): LatticeClient;

export function isKnownClient(raw: unknown): boolean;

// ---------------------------------------------------------------------------
// timeouts
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEOUTS: Readonly<Record<string, number>>;
export const DEFAULT_FALLBACK_MS: number;

export function pascalToScreamingSnake(event: string): string;
export function resolveTimeout(
  event: string,
  opts?: { env?: NodeJS.ProcessEnv; defaults?: Record<string, number> },
): number;

// ---------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------

export interface LatticeContext {
  readonly client: string;
  readonly contractVersion: 1;
  readonly event: string;
  readonly cwd: string;
  readonly repoRoot: string;
  readonly stateDir: string;
  readonly log: (message: string) => void;
  readonly env: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface CreateContextInput {
  client: string;
  event: string;
  providerName: string;
  cwd?: string;
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  abortController?: AbortController;
  stderrWrite?: (line: string) => void;
  skipStateDirCreation?: boolean;
}

export function createContext(input: CreateContextInput): {
  ctx: LatticeContext;
  dispose: () => void;
  timeoutMs: number;
};

// ---------------------------------------------------------------------------
// provider contract
// ---------------------------------------------------------------------------

export interface LatticeHandlerResult {
  decision?: "allow" | "deny";
  reason?: string;
  additionalContext?: string;
  hookSpecificOutput?: Record<string, unknown>;
  exitCode?: number;
}

export type LatticeHandler = (
  ctx: LatticeContext,
  payload: object,
) => Promise<LatticeHandlerResult | void> | LatticeHandlerResult | void;

export interface ValidatorResult {
  ok: boolean;
  failures?: string[];
}

export type LatticeValidator = (
  ctx: LatticeContext,
) => Promise<ValidatorResult> | ValidatorResult;

export interface LatticeProvider {
  name: string;
  contractVersion: 1;
  handlers?: Record<string, LatticeHandler>;
  validate?: LatticeValidator;
  supportedClients?: LatticeClient[];
}

// ---------------------------------------------------------------------------
// provider-registry
// ---------------------------------------------------------------------------

/**
 * @deprecated Will be removed in v2. Use `dispatch()` from
 * `@lzong.tw/lattice/dispatcher` and `registerProvider()` from
 * `@lzong.tw/lattice/provider-registry` instead.
 */
export const DEFAULT_PROVIDER_NAMES: ReadonlyArray<string>;

/**
 * @deprecated Will be removed in v2. Use `dispatch()` from
 * `@lzong.tw/lattice/dispatcher` and `registerProvider()` from
 * `@lzong.tw/lattice/provider-registry` instead.
 */
export const providerRegistry: Readonly<Record<string, { name?: string; bootstrap: (client: string) => Promise<number> | number }>>;

/**
 * @deprecated Will be removed in v2. Use `dispatch()` from
 * `@lzong.tw/lattice/dispatcher` and `registerProvider()` from
 * `@lzong.tw/lattice/provider-registry` instead.
 */
export function parseProviderList(raw: string): string[];

export interface SelectedProvidersResult {
  availableProviderNames: string[];
  providers: Array<{ name: string; bootstrap: (client: string) => Promise<number> | number }>;
  requestedNames: string[];
  source: string;
  strict: boolean;
  unknownNames: string[];
}

/**
 * @deprecated Will be removed in v2. Use `dispatch()` from
 * `@lzong.tw/lattice/dispatcher` and `registerProvider()` from
 * `@lzong.tw/lattice/provider-registry` instead.
 */
export function resolveSelectedProviders(opts?: {
  env?: NodeJS.ProcessEnv;
  registry?: Record<string, { bootstrap: (client: string) => unknown }>;
}): SelectedProvidersResult;

/**
 * @deprecated Will be removed in v2. Use `dispatch()` from
 * `@lzong.tw/lattice/dispatcher` and `registerProvider()` from
 * `@lzong.tw/lattice/provider-registry` instead.
 */
export function bootstrapProviders(
  client: string,
  opts?: {
    env?: NodeJS.ProcessEnv;
    registry?: Record<string, { bootstrap: (client: string) => unknown }>;
    onError?: (message: string) => void;
  },
): Promise<number>;

export function registerProvider(definition: LatticeProvider): LatticeProvider;
export function unregisterProvider(name: string): void;
export function clearRegistrations(): void;
export function getRegisteredProviders(): LatticeProvider[];

export interface EffectiveProvidersResult {
  providers: LatticeProvider[];
  strict: boolean;
  source: string;
  unknownNames: string[];
  availableProviderNames: string[];
  requestedNames: string[];
}

export function resolveEffectiveProviders(opts?: {
  env?: NodeJS.ProcessEnv;
  runtime?: Map<string, LatticeProvider>;
  legacy?: Record<string, { bootstrap: (client: string) => unknown }>;
  onWarn?: (message: string) => void;
}): EffectiveProvidersResult;

// ---------------------------------------------------------------------------
// dispatcher
// ---------------------------------------------------------------------------

export const CONTRACT_VERSION: 1;

export const EVENT_NAMES: {
  readonly SessionStart: "SessionStart";
  readonly PreToolUse: "PreToolUse";
  readonly PostToolUse: "PostToolUse";
  readonly Stop: "Stop";
  readonly PostCompact: "PostCompact";
  readonly Notification: "Notification";
};

export const PERMISSION_DECISIONS: {
  readonly ALLOW: "allow";
  readonly DENY: "deny";
};

export const STOP_DECISIONS: {
  readonly BLOCK: "block";
};

export function dispatch(
  event: string,
  payload: object,
  opts: {
    client: string;
    env?: NodeJS.ProcessEnv;
    stdout?: (line: string) => void;
    stderr?: (line: string) => void;
  },
): Promise<number>;

// ---------------------------------------------------------------------------
// testing (subpath: "@lzong.tw/lattice/testing")
// ---------------------------------------------------------------------------

export interface MockContextResult {
  ctx: LatticeContext;
  stderr: string[];
  dispose: () => void;
}

export function mockContext(overrides?: {
  client?: string;
  event?: string;
  providerName?: string;
  cwd?: string;
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  abortController?: AbortController;
}): MockContextResult;

export interface RunProviderResult {
  result: LatticeHandlerResult;
  stderr: string[];
  validatorResult?: ValidatorResult;
}

export function runProvider(
  provider: LatticeProvider,
  event: string,
  payload: object,
  opts?: {
    runValidator?: boolean;
    contextOverrides?: Parameters<typeof mockContext>[0];
  },
): Promise<RunProviderResult>;

export const mockPayload: Readonly<{
  preToolUse(overrides?: Record<string, unknown>): Record<string, unknown>;
  postToolUse(overrides?: Record<string, unknown>): Record<string, unknown>;
  stop(overrides?: Record<string, unknown>): Record<string, unknown>;
  sessionStart(overrides?: Record<string, unknown>): Record<string, unknown>;
  postCompact(overrides?: Record<string, unknown>): Record<string, unknown>;
  notification(overrides?: Record<string, unknown>): Record<string, unknown>;
}>;
