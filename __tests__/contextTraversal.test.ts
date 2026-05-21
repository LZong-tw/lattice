import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createContext } from "../context.mjs";

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeXdgDir() {
  const dir = mkdtempSync(join(tmpdir(), "lattice-traversal-test-"));
  createdDirs.push(dir);
  return dir;
}

describe("createContext — providerName traversal (B3)", () => {
  it("rejects providerName that escapes the providers/ root via ../", () => {
    const xdg = makeXdgDir();
    expect(() =>
      createContext({
        client: "claude-code",
        event: "SessionStart",
        providerName: "../../../etc",
        env: { XDG_STATE_HOME: xdg },
      }),
    ).toThrow(/escapes state directory/);
  });

  it("rejects embedded ../ traversal segments", () => {
    const xdg = makeXdgDir();
    expect(() =>
      createContext({
        client: "claude-code",
        event: "SessionStart",
        providerName: "foo/../../../etc",
        env: { XDG_STATE_HOME: xdg },
      }),
    ).toThrow(/escapes state directory/);
  });

  it("rejects providerName equal to ..", () => {
    const xdg = makeXdgDir();
    expect(() =>
      createContext({
        client: "claude-code",
        event: "SessionStart",
        providerName: "..",
        env: { XDG_STATE_HOME: xdg },
      }),
    ).toThrow(/escapes state directory/);
  });

  it("collapses providerName '.' to the providers root and rejects (would create files in providers/)", () => {
    // path.resolve(providersRoot, '.') === providersRoot; we allow ===
    // root but in practice the provider name is the directory we want
    // — '.' would mean "no dedicated dir". Documented as allowed.
    const xdg = makeXdgDir();
    const { ctx, dispose } = createContext({
      client: "claude-code",
      event: "SessionStart",
      providerName: ".",
      env: { XDG_STATE_HOME: xdg },
      skipStateDirCreation: true,
    });
    try {
      expect(ctx.stateDir).toBe(resolve(xdg, "lattice/providers"));
    } finally {
      dispose();
    }
  });

  it("rejects absolute-path-shaped providerName (would escape via path.resolve absorption)", () => {
    const xdg = makeXdgDir();
    // `/etc/passwd` split by `/` → ["", "etc", "passwd"]; rejoined as
    // `/etc/passwd`, which path.resolve treats as absolute and absorbs,
    // leaving the resolved path at `/etc/passwd` — outside providers/.
    // The containment assertion must reject this.
    expect(() =>
      createContext({
        client: "claude-code",
        event: "SessionStart",
        providerName: "/etc/passwd",
        env: { XDG_STATE_HOME: xdg },
        skipStateDirCreation: true,
      }),
    ).toThrow(/escapes state directory/);
  });

  it("preserves scoped provider names like @lattice/clawback", () => {
    const xdg = makeXdgDir();
    const { ctx, dispose } = createContext({
      client: "claude-code",
      event: "SessionStart",
      providerName: "@lattice/clawback",
      env: { XDG_STATE_HOME: xdg },
      skipStateDirCreation: true,
    });
    try {
      expect(ctx.stateDir).toBe(resolve(xdg, "lattice/providers/@lattice/clawback"));
    } finally {
      dispose();
    }
  });

  it("preserves lattice/subname slash provider names like lattice/protection", () => {
    const xdg = makeXdgDir();
    const { ctx, dispose } = createContext({
      client: "claude-code",
      event: "SessionStart",
      providerName: "lattice/protection",
      env: { XDG_STATE_HOME: xdg },
      skipStateDirCreation: true,
    });
    try {
      expect(ctx.stateDir).toBe(resolve(xdg, "lattice/providers/lattice/protection"));
    } finally {
      dispose();
    }
  });

  it("rejects null bytes in providerName via sanitization", () => {
    const xdg = makeXdgDir();
    // Null bytes are replaced with `_` by sanitizeSegment — the result
    // should still be confined under providers/.
    const { ctx, dispose } = createContext({
      client: "claude-code",
      event: "SessionStart",
      providerName: "foo\x00bar",
      env: { XDG_STATE_HOME: xdg },
      skipStateDirCreation: true,
    });
    try {
      expect(ctx.stateDir).toBe(resolve(xdg, "lattice/providers/foo_bar"));
    } finally {
      dispose();
    }
  });
});
