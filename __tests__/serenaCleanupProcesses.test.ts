import { describe, expect, it } from "vitest";

import {
  cleanupOptionsFromEnv,
  collectSerenaCleanupTargets,
  idleLeakScore,
} from "../serena/cleanup-processes.mjs";

const mb = (value: number) => value * 1024 * 1024;
const hoursAgo = (value: number) => new Date(Date.now() - value * 36e5).toISOString();

describe("cleanupOptionsFromEnv", () => {
  it("reads options from the provided env snapshot", () => {
    const options = cleanupOptionsFromEnv({
      SERENA_CLEANUP_CPU_SAMPLE_MS: "0",
      SERENA_CLEANUP_IDLE_GRACE_HOURS: "2",
      SERENA_CLEANUP_HIGH_PRIVATE_MB: "1024",
      SERENA_CLEANUP_LOW_WORKING_SET_MB: "64",
      SERENA_CLEANUP_LOW_WORKING_SET_RATIO: "0.08",
      SERENA_CLEANUP_IDLE_CPU_SECONDS: "0.4",
      SERENA_CLEANUP_KILL_SCORE: "90",
    });

    expect(options).toMatchObject({
      cpuSampleMs: 0,
      highPrivateMb: 1024,
      idleCpuSeconds: 0.4,
      idleGraceHours: 2,
      killScore: 90,
      lowWorkingSetMb: 64,
      lowWorkingSetRatio: 0.08,
    });
  });
});

describe("idleLeakScore", () => {
  it("suppresses active trees even when they are old", () => {
    const decision = idleLeakScore(
      "serena-tree",
      {
        ageHours: 8,
        cpuDeltaSeconds: 4,
        parentName: "pwsh",
        privateMB: 300,
        webViewCount: 1,
        workingSetMB: 280,
        workingSetRatio: 0.93,
      },
      cleanupOptionsFromEnv({ SERENA_CLEANUP_KILL_SCORE: "70" }),
    );

    expect(decision.kill).toBe(false);
    expect(decision.reason).toContain("cpu-active");
  });
});

describe("collectSerenaCleanupTargets", () => {
  it("targets orphan Serena process trees", () => {
    const targets = collectSerenaCleanupTargets(
      [
        {
          id: 101,
          parentId: 999_999,
          name: "serena",
          path: "C:\\tools\\serena.exe",
          startTime: hoursAgo(0.5),
          cpuDeltaSeconds: 0,
          privateBytes: mb(100),
          workingSet: mb(90),
        },
      ],
      cleanupOptionsFromEnv({ SERENA_CLEANUP_CPU_SAMPLE_MS: "0" }),
      42,
    );

    expect(targets).toEqual([
      expect.objectContaining({
        kind: "serena-tree",
        pid: 101,
        reason: "orphan-serena-tree",
      }),
    ]);
  });

  it("keeps live active Serena trees alone", () => {
    const targets = collectSerenaCleanupTargets(
      [
        { id: 10, parentId: 1, name: "pwsh", startTime: hoursAgo(10) },
        {
          id: 11,
          parentId: 10,
          name: "serena",
          path: "C:\\tools\\serena.exe",
          startTime: hoursAgo(6),
          cpuDeltaSeconds: 3,
          privateBytes: mb(220),
          workingSet: mb(180),
        },
      ],
      cleanupOptionsFromEnv({ SERENA_CLEANUP_CPU_SAMPLE_MS: "0" }),
      42,
    );

    expect(targets).toEqual([]);
  });

  it("targets Serena trees whose active client parent is detached from its launcher", () => {
    const targets = collectSerenaCleanupTargets(
      [
        { id: 10, parentId: 999_999, name: "sh", startTime: hoursAgo(2) },
        { id: 11, parentId: 10, name: "node", startTime: hoursAgo(2) },
        { id: 12, parentId: 11, name: "codex", startTime: hoursAgo(2) },
        {
          id: 13,
          parentId: 12,
          name: "uvx",
          startTime: hoursAgo(1),
          cpuDeltaSeconds: 0,
          privateBytes: mb(40),
          workingSet: mb(30),
        },
        { id: 14, parentId: 13, name: "uv", startTime: hoursAgo(1) },
        {
          id: 15,
          parentId: 14,
          name: "serena",
          path: "C:\\tools\\serena.exe",
          startTime: hoursAgo(1),
          cpuDeltaSeconds: 0,
          privateBytes: mb(20),
          workingSet: mb(10),
        },
      ],
      cleanupOptionsFromEnv({ SERENA_CLEANUP_CPU_SAMPLE_MS: "0" }),
      42,
    );

    expect(targets).toEqual([
      expect.objectContaining({
        kind: "serena-tree",
        pid: 13,
        reason: "detached-parent-serena-tree",
      }),
    ]);
  });

  it("targets old idle python trees that own WebView children", () => {
    const targets = collectSerenaCleanupTargets(
      [
        { id: 10, parentId: 1, name: "pwsh", startTime: hoursAgo(10) },
        {
          id: 20,
          parentId: 10,
          name: "python",
          startTime: hoursAgo(5),
          cpuDeltaSeconds: 0,
          privateBytes: mb(900),
          workingSet: mb(60),
        },
        {
          id: 21,
          parentId: 20,
          name: "msedgewebview2",
          startTime: hoursAgo(5),
          cpuDeltaSeconds: 0,
          privateBytes: mb(200),
          workingSet: mb(30),
        },
      ],
      cleanupOptionsFromEnv({ SERENA_CLEANUP_CPU_SAMPLE_MS: "0" }),
      42,
    );

    expect(targets).toEqual([
      expect.objectContaining({
        kind: "serena-python-tree",
        pid: 20,
      }),
    ]);
    expect(targets[0].reason).toContain("idle-leak-serena-python-tree");
  });
});
