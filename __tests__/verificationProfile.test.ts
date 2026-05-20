import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { detectProjectStack } from "../verification/detect-stack.mjs";
import { filterRelevantOutput, parseGitStatusFiles } from "../verification/verify.mjs";

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
