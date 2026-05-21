#!/usr/bin/env node
/**
 * dispatcher.mjs — v1 hook event dispatcher.
 *
 * Routes a single Anthropic-style hook event payload to every registered
 * provider whose `handlers[event]` is defined, then merges their results
 * into the Anthropic stdout JSON shape and returns a process exit code.
 *
 * Sits one layer below Anthropic's hook contract: each hook file in the
 * consumer repo is expected to be a thin shim that reads stdin, calls
 * `await dispatch(eventName, payload, { client })`, and exits with the
 * returned code.
 *
 * Sync `spawnSync`-style handlers cannot be interrupted by the per-event
 * timeout signal — those handlers must enforce their own subprocess
 * timeout. The dispatcher still fires the signal so async siblings can
 * bail.
 */

import { CLIENTS, normalizeClient } from "./client-enum.mjs";
import { createContext } from "./context.mjs";
import { resolveEffectiveProviders } from "./provider-registry.mjs";

const CONTRACT_VERSION = 1;

/**
 * Canonical Anthropic event names. Open string-keyed in the registry —
 * this enum is for ergonomic imports and typo prevention only.
 */
export const EVENT_NAMES = Object.freeze({
  SessionStart: "SessionStart",
  PreToolUse: "PreToolUse",
  PostToolUse: "PostToolUse",
  Stop: "Stop",
  PostCompact: "PostCompact",
  Notification: "Notification",
});

/**
 * Permission decision string literals returned from PreToolUse / PostToolUse
 * handlers via `LatticeHandlerResult.decision`.
 */
export const PERMISSION_DECISIONS = Object.freeze({
  ALLOW: "allow",
  DENY: "deny",
});

/**
 * Stop / PostCompact hookSpecificOutput.decision literal that blocks the
 * client from declaring the turn complete. Use this constant when emitting
 * a blocking Stop result.
 */
export const STOP_DECISIONS = Object.freeze({
  BLOCK: "block",
});

function defaultStderr(line) {
  process.stderr.write(line);
}

function defaultStdout(line) {
  process.stdout.write(line);
}

function normalizeHandlerResult(value) {
  if (value == null) return {};
  if (typeof value !== "object") {
    throw new Error(
      `lattice: handler must return an object or undefined; got ${typeof value}`,
    );
  }
  return value;
}

function mergeReasons(existing, addition) {
  if (!addition) return existing;
  if (!existing) return `• ${addition}`;
  return `${existing}\n• ${addition}`;
}

function decisionRank(decision) {
  if (decision === "deny") return 2;
  if (decision === "allow") return 1;
  return 0;
}

function mergeHookSpecificOutput(existing, addition) {
  if (!addition || typeof addition !== "object") return existing;
  const merged = { ...(existing ?? {}), ...addition };
  if (existing?.decision === "block") {
    merged.decision = "block";
  }
  return merged;
}

function reduceResults(event, providerResults) {
  /** @type {{ decision?: "allow" | "deny", reason?: string, additionalContext?: string, hookSpecificOutput?: Record<string, unknown>, exitCode: number }} */
  const merged = { exitCode: 0 };

  for (const { name, result } of providerResults) {
    if (result.decision === "allow" || result.decision === "deny") {
      if (decisionRank(result.decision) > decisionRank(merged.decision)) {
        merged.decision = result.decision;
      } else if (
        merged.decision === "deny" &&
        result.decision === "allow" &&
        merged.reason == null
      ) {
        // keep the deny
      }
    }

    // Per spec, reason is meaningful only when a provider denies (or
    // abstains with explanatory context). An allow-voter's reason is
    // discarded so that a later deny doesn't end up bulleting allow
    // rationale into the deny message.
    if (
      typeof result.reason === "string" &&
      result.reason.length > 0 &&
      result.decision !== "allow"
    ) {
      const prefixed = `${name}: ${result.reason}`;
      merged.reason = mergeReasons(merged.reason, prefixed);
    }

    if (
      typeof result.additionalContext === "string" &&
      result.additionalContext.length > 0
    ) {
      merged.additionalContext =
        merged.additionalContext == null
          ? result.additionalContext
          : `${merged.additionalContext}\n\n${result.additionalContext}`;
    }

    if (result.hookSpecificOutput && typeof result.hookSpecificOutput === "object") {
      merged.hookSpecificOutput = mergeHookSpecificOutput(
        merged.hookSpecificOutput,
        result.hookSpecificOutput,
      );
    }

    if (typeof result.exitCode === "number" && Number.isFinite(result.exitCode)) {
      merged.exitCode = Math.max(merged.exitCode, Math.trunc(result.exitCode));
    }
  }

  return merged;
}

function renderPreOrPostToolUse(event, merged, client) {
  if (!merged.decision && !merged.hookSpecificOutput) return null;

  // GitHub Copilot CLI expects a flat permissionDecision response at the
  // root, not the Claude/Codex nested hookSpecificOutput envelope.
  if (client === CLIENTS.COPILOT_CLI) {
    const response = {};
    if (merged.decision) {
      response.permissionDecision = merged.decision;
    }
    if (merged.decision === "deny" && merged.reason) {
      response.permissionDecisionReason = merged.reason;
    }
    if (merged.hookSpecificOutput) {
      Object.assign(response, merged.hookSpecificOutput);
    }
    return Object.keys(response).length > 0 ? response : null;
  }

  const hookSpecificOutput = {
    hookEventName: event,
    ...(merged.hookSpecificOutput ?? {}),
  };
  if (merged.decision) {
    hookSpecificOutput.permissionDecision = merged.decision;
  }
  if (merged.decision === "deny" && merged.reason) {
    hookSpecificOutput.permissionDecisionReason = merged.reason;
  }
  return { hookSpecificOutput };
}

function renderResponseJson(event, merged, client) {
  if (event === EVENT_NAMES.PreToolUse || event === EVENT_NAMES.PostToolUse) {
    return renderPreOrPostToolUse(event, merged, client);
  }

  if (
    event === EVENT_NAMES.Stop ||
    event === EVENT_NAMES.SessionStart ||
    event === EVENT_NAMES.PostCompact
  ) {
    const response = {};
    if (typeof merged.additionalContext === "string" && merged.additionalContext.length > 0) {
      response.additionalContext = merged.additionalContext;
    }
    if (merged.hookSpecificOutput) {
      response.hookSpecificOutput = {
        hookEventName: event,
        ...merged.hookSpecificOutput,
      };
    }
    return Object.keys(response).length > 0 ? response : null;
  }

  // Notification and any custom event: side-effect only.
  return null;
}

async function awaitHandler(handler, ctx, payload, signal) {
  const handlerPromise = Promise.resolve(handler(ctx, payload));
  if (!signal) return handlerPromise;

  const abortPromise = new Promise((_, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error("lattice: handler aborted"));
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });

  return Promise.race([handlerPromise, abortPromise]);
}

/**
 * Dispatch a single Anthropic event payload to all registered providers.
 *
 * @param {string} event             PascalCase Anthropic event name.
 * @param {object} payload           Raw JSON payload as parsed from stdin.
 * @param {Object} opts
 * @param {string} opts.client       Raw client identifier (canonical or bare).
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(line: string) => void} [opts.stdout]   Default: process.stdout.write
 * @param {(line: string) => void} [opts.stderr]   Default: process.stderr.write
 * @returns {Promise<number>} Process exit code.
 */
export async function dispatch(event, payload, opts) {
  if (typeof event !== "string" || event.length === 0) {
    throw new Error("lattice: dispatch requires a non-empty event name");
  }
  if (!opts || typeof opts !== "object") {
    throw new Error("lattice: dispatch requires opts with a client");
  }

  const env = opts.env ?? process.env;
  const stderr = opts.stderr ?? defaultStderr;
  const stdout = opts.stdout ?? defaultStdout;

  const client = normalizeClient(opts.client, { warn: (m) => stderr(`${m}\n`) }) ?? opts.client;

  const selection = resolveEffectiveProviders({ env, onWarn: (m) => stderr(`${m}\n`) });

  if (selection.strict && selection.unknownNames.length > 0) {
    const suffix = selection.unknownNames.length === 1 ? "" : "s";
    stderr(
      `lattice: unknown provider${suffix} in ${selection.source}: ${selection.unknownNames.join(", ")}. ` +
        `Available providers: ${selection.availableProviderNames.join(", ") || "(none)"}.\n`,
    );
    return 1;
  }

  const eligible = selection.providers.filter((provider) => {
    if (!provider.supportedClients) return true;
    return provider.supportedClients.includes(client);
  });

  // Validators are session-scoped per the v1 spec: they run only on
  // SessionStart and gate the rest of the session by failing fast on
  // missing configuration. Per-event invocations (PreToolUse, Stop, etc.)
  // skip validators entirely so they don't re-run on every tool use.
  if (event === EVENT_NAMES.SessionStart) {
    const validatorFailures = [];
    for (const provider of eligible) {
      if (typeof provider.validate !== "function") continue;

      const { ctx, dispose } = createContext({
        client,
        event,
        providerName: provider.name,
        env,
      });
      try {
        const result = await awaitHandler(provider.validate, ctx, payload, ctx.signal);
        if (result && result.ok === false) {
          validatorFailures.push({
            name: provider.name,
            failures: Array.isArray(result.failures) ? result.failures : [],
          });
        }
      } catch (err) {
        // Aggregate validator throws into the same failure list as
        // `{ok: false}` returns so users see every broken validator in
        // one stderr pass instead of having to fix-and-retry one at a
        // time.
        const message = err instanceof Error ? err.message : String(err);
        validatorFailures.push({
          name: provider.name,
          failures: [`validator threw: ${message}`],
        });
      } finally {
        dispose();
      }
    }

    if (validatorFailures.length > 0) {
      for (const failure of validatorFailures) {
        stderr(
          `lattice: provider "${failure.name}" validation failed:\n` +
            failure.failures.map((line) => `- ${line}`).join("\n") +
            "\n",
        );
      }
      return 1;
    }
  }

  // Handlers
  const providerResults = [];
  for (const provider of eligible) {
    const handler = provider.handlers?.[event];
    if (typeof handler !== "function") continue;

    const { ctx, dispose, timeoutMs } = createContext({
      client,
      event,
      providerName: provider.name,
      env,
    });
    try {
      const raw = await awaitHandler(handler, ctx, payload, ctx.signal);
      const result = normalizeHandlerResult(raw);
      providerResults.push({ name: provider.name, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const aborted = ctx.signal.aborted;
      if (aborted) {
        stderr(
          `lattice: provider "${provider.name}" timed out at event ${event} after ${timeoutMs}ms\n`,
        );
        continue;
      }
      stderr(`lattice: provider "${provider.name}" handler failed: ${message}\n`);
      return 1;
    } finally {
      dispose();
    }
  }

  const merged = reduceResults(event, providerResults);
  const rendered = renderResponseJson(event, merged, client);
  if (rendered) {
    stdout(`${JSON.stringify(rendered)}\n`);
  }

  return merged.exitCode;
}

export { CONTRACT_VERSION };
