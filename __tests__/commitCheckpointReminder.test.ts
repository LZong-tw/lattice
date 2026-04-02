import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildCommitCheckpointReminder } from "../commit-checkpoint.mjs";

let tempRepo: string | null = null;
let tempStateHome: string | null = null;
const testRoot = resolve(process.cwd(), ".test-state", "commitCheckpointReminder");

function createTestDir(prefix: string) {
  const dir = resolve(testRoot, `${prefix}-${process.pid}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function initGitRepo(root: string) {
  const result = spawnSync("git", ["init"], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`git init could not run: ${result.error.message}`);
  }

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

  rmSync(testRoot, { recursive: true, force: true });
});

describe("commit checkpoint reminder", () => {
  it("ignores the repo-local .serena runtime state", () => {
    tempRepo = createTestDir("repo");
    tempStateHome = createTestDir("state");

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
    tempRepo = createTestDir("repo");
    tempStateHome = createTestDir("state");

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
