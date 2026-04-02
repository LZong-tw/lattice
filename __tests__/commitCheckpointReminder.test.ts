import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildCommitCheckpointReminder } from "../commit-checkpoint.mjs";

let tempRepo: string | null = null;
let tempStateHome: string | null = null;

function initGitRepo(root: string) {
  const result = spawnSync("git", ["init"], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "git init failed");
  }
}

afterEach(() => {
  if (tempRepo) {
    rmSync(tempRepo, { recursive: true, force: true });
    tempRepo = null;
  }

  if (tempStateHome) {
    rmSync(tempStateHome, { recursive: true, force: true });
    tempStateHome = null;
  }
});

describe("commit checkpoint reminder", () => {
  it("ignores the repo-local .serena runtime state", () => {
    tempRepo = mkdtempSync(resolve(tmpdir(), "lattice-commit-reminder-"));
    tempStateHome = mkdtempSync(resolve(tmpdir(), "lattice-commit-reminder-state-"));

    initGitRepo(tempRepo);
    mkdirSync(resolve(tempRepo, ".serena"), { recursive: true });
    writeFileSync(resolve(tempRepo, ".serena", "memory.txt"), "local runtime state", "utf8");

    expect(
      buildCommitCheckpointReminder({
        repoPath: tempRepo,
        stateHome: tempStateHome,
        now: 1_000,
      }),
    ).toBeNull();
  });

  it("returns a checkpoint reminder for a real dirty tree and suppresses repeats", () => {
    tempRepo = mkdtempSync(resolve(tmpdir(), "lattice-commit-reminder-"));
    tempStateHome = mkdtempSync(resolve(tmpdir(), "lattice-commit-reminder-state-"));

    initGitRepo(tempRepo);
    writeFileSync(resolve(tempRepo, "notes.txt"), "keep me", "utf8");

    const reminder = buildCommitCheckpointReminder({
      repoPath: tempRepo,
      stateHome: tempStateHome,
      now: 1_000,
    });
    const repeatedReminder = buildCommitCheckpointReminder({
      repoPath: tempRepo,
      stateHome: tempStateHome,
      now: 1_000,
    });

    expect(reminder).toContain("COMMIT CHECKPOINT");
    expect(reminder).toContain("changed file");
    expect(repeatedReminder).toBeNull();
  });
});
