/**
 * is-main.mjs — symlink-safe "am I being run as a CLI script?" guard.
 *
 * The naive guard `process.argv[1] === fileURLToPath(import.meta.url)` (or the
 * `resolve()`-wrapped variant) is a silent no-op under symlinked installs:
 * pnpm and `npm link` expose the package through a symlink/junction, so
 * `process.argv[1]` keeps the link path while Node resolves `import.meta.url`
 * to the real path. The two never compare equal and the script's `run()`/
 * `main()` never fires — producing no output and no error.
 *
 * `realpathSync` canonicalises both sides (following symlinks) before the
 * comparison. `realpath` is injectable so the behaviour is unit-testable
 * without creating real symlinks (which are platform-specific and often
 * blocked in sandboxes).
 *
 * Zero module-load side effects, so importing this stays cheap even in the
 * lean SessionStart cleanup path.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {string} metaUrl - `import.meta.url` of the calling module.
 * @param {{ argv?: string[], realpath?: (path: string) => string }} [opts] - injectable for testing.
 * @returns {boolean}
 */
export function isMainModule(metaUrl, { argv = process.argv, realpath = realpathSync } = {}) {
  const entry = argv[1];
  if (!entry) return false;
  const self = fileURLToPath(metaUrl);
  try {
    return realpath(entry) === realpath(self);
  } catch {
    // A path that can't be canonicalised (e.g. deleted) — fall back to a raw
    // compare so behaviour never regresses below the old guard.
    return entry === self;
  }
}
