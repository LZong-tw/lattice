import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import { isMainModule } from "../is-main.mjs";

const self = fileURLToPath(import.meta.url);

describe("isMainModule", () => {
  it("returns true under a symlinked invocation where the raw paths differ (regression for the silent no-op)", () => {
    // pnpm / `npm link` expose the script through a symlink: argv[1] keeps the
    // link path while import.meta.url resolves to the real path. A raw compare
    // is false; realpath canonicalises both to the same target.
    const symlinkPath = `${self}.link`;
    expect(symlinkPath === self).toBe(false); // raw compare WOULD have failed
    const realpath = (p: string) => (p === symlinkPath || p === self ? "/canonical/target" : p);

    expect(isMainModule(import.meta.url, { argv: ["node", symlinkPath], realpath })).toBe(true);
  });

  it("returns true when invoked directly (default realpathSync on a real file)", () => {
    expect(isMainModule(import.meta.url, { argv: ["node", self] })).toBe(true);
  });

  it("returns false when imported (argv[1] is a different script)", () => {
    const realpath = (p: string) => p;
    expect(isMainModule(import.meta.url, { argv: ["node", "/some/other/entry.mjs"], realpath })).toBe(false);
  });

  it("returns false when there is no argv[1] (e.g. `node -e`)", () => {
    expect(isMainModule(import.meta.url, { argv: ["node"], realpath: (p: string) => p })).toBe(false);
  });

  it("falls back to a raw compare when realpath throws (path not canonicalisable)", () => {
    const throwing = () => {
      throw new Error("ENOENT");
    };
    expect(isMainModule(import.meta.url, { argv: ["node", self], realpath: throwing })).toBe(true);
    expect(isMainModule(import.meta.url, { argv: ["node", "/gone"], realpath: throwing })).toBe(false);
  });
});
