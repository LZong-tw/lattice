import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detectProjectStack } from "../verification/detect-stack.mjs";
import {
  filterRelevantOutput,
  parseGitStatusFiles,
  runProjectVerification,
} from "../verification/verify.mjs";

describe("verification profile", () => {
  it("detects JavaScript package manager lockfiles and scripts", () => {
    const root = mkdtempSync(join(tmpdir(), "lattice-detect-stack-"));
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          typecheck: "tsc --noEmit",
          lint: "eslint .",
          test: "vitest run",
        },
      }),
      "utf8",
    );
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    writeFileSync(join(root, "src", "feature.ts"), "export const feature = true;\n", "utf8");

    const stack = detectProjectStack(join(root, "src"));

    expect(stack.projectRoot).toBe(root);
    expect(stack.packageManager).toBe("pnpm");
    expect(stack.lockfiles).toContain("pnpm-lock.yaml");
    expect(stack.sourceExtensions).toContain(".js");
  });

  it("parses changed files from git status output", () => {
    expect(
      parseGitStatusFiles(
        [
          " M src/file.ts",
          "A  src/new.ts",
          "R  src/old.ts -> src/renamed.ts",
          "?? docs/note.md",
        ].join("\n"),
      ),
    ).toEqual(["src/file.ts", "src/new.ts", "src/renamed.ts", "docs/note.md"]);
  });

  it("filters verification output to changed files", () => {
    const output = [
      "src/changed.ts(1,1): error TS1000: broken",
      "src/legacy.ts(1,1): error TS1000: old debt",
    ].join("\n");

    expect(filterRelevantOutput(output, ["src/changed.ts"])).toBe(
      "src/changed.ts(1,1): error TS1000: broken",
    );
  });
});

describe("runProjectVerification — payload.cwd clamping (H3)", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const captured: string[] = [];
  let originalLatticeRepoRoot: string | undefined;

  beforeEach(() => {
    captured.length = 0;
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    });
    originalLatticeRepoRoot = process.env.LATTICE_REPO_ROOT;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (originalLatticeRepoRoot === undefined) {
      delete process.env.LATTICE_REPO_ROOT;
    } else {
      process.env.LATTICE_REPO_ROOT = originalLatticeRepoRoot;
    }
  });

  it("ignores payload.cwd that points outside repoRoot when LATTICE_REPO_ROOT is set", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lattice-verify-root-"));
    const attacker = mkdtempSync(join(tmpdir(), "lattice-verify-attacker-"));
    const stateHome = mkdtempSync(join(tmpdir(), "lattice-verify-state-"));
    process.env.LATTICE_REPO_ROOT = repoRoot;

    const result = runProjectVerification({
      payload: { cwd: attacker },
      root: repoRoot,
      stateHome,
    });

    // No package.json in repoRoot either, so status is "skipped".
    expect(result.status).toBe("skipped");
    expect(captured.join("")).toMatch(/ignoring payload\.cwd/);
    expect(captured.join("")).toContain(attacker);
  });

  it("accepts payload.cwd that is a descendant of repoRoot when LATTICE_REPO_ROOT is set", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lattice-verify-root-"));
    mkdirSync(join(repoRoot, "sub"), { recursive: true });
    const stateHome = mkdtempSync(join(tmpdir(), "lattice-verify-state-"));
    process.env.LATTICE_REPO_ROOT = repoRoot;

    const result = runProjectVerification({
      payload: { cwd: join(repoRoot, "sub") },
      root: repoRoot,
      stateHome,
    });

    expect(result.status).toBe("skipped");
    expect(captured.join("")).not.toMatch(/ignoring payload\.cwd/);
  });

  it("trusts payload.cwd verbatim when LATTICE_REPO_ROOT is unset", () => {
    delete process.env.LATTICE_REPO_ROOT;
    const repoRoot = mkdtempSync(join(tmpdir(), "lattice-verify-root-"));
    const elsewhere = mkdtempSync(join(tmpdir(), "lattice-verify-other-"));
    const stateHome = mkdtempSync(join(tmpdir(), "lattice-verify-state-"));

    const result = runProjectVerification({
      payload: { cwd: elsewhere },
      root: repoRoot,
      stateHome,
    });

    // No project in `elsewhere` → skipped, no clamping warning.
    expect(result.status).toBe("skipped");
    expect(captured.join("")).not.toMatch(/ignoring payload\.cwd/);
  });
});
