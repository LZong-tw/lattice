import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  extractDashboardUrl,
  getRuntimeRoot,
  openExternalUrl,
  pickMostRecentActiveClient,
  readDashboardUrlFile,
} from "../serena/dashboard-state.mjs";

const originalStateHome = process.env.XDG_STATE_HOME;
let tempStateHome: string | null = null;

afterEach(() => {
  if (tempStateHome) {
    rmSync(tempStateHome, { recursive: true, force: true });
    tempStateHome = null;
  }

  process.env.XDG_STATE_HOME = originalStateHome;
});

describe("Serena dashboard state helpers", () => {
  it("extracts dashboard URLs from the current Serena log formats", () => {
    const explicitUrlLog = [
      "INFO 2026-04-01 11:12:31,453 [MainThread] serena.agent:__init__:379 - Serena web dashboard started at http://127.0.0.1:24283/dashboard/index.html",
    ].join("\n");

    const portOnlyLog = [
      "INFO 2026-04-01 11:12:31,452 [MainThread] serena.dashboard:run_in_thread:678 - Starting dashboard (listen_address=127.0.0.1, port=24283)",
    ].join("\n");

    expect(extractDashboardUrl(explicitUrlLog)).toBe("http://127.0.0.1:24283/dashboard/index.html");
    expect(extractDashboardUrl(portOnlyLog)).toBe("http://127.0.0.1:24283/dashboard/index.html");
    expect(extractDashboardUrl("INFO nothing useful here")).toBeNull();
  });

  it("prefers the newest active Serena dashboard", async () => {
    tempStateHome = mkdtempSync(resolve(tmpdir(), "lattice-serena-state-"));
    process.env.XDG_STATE_HOME = tempStateHome;

    const runtimeRoot = getRuntimeRoot();
    mkdirSync(runtimeRoot, { recursive: true });

    const clientRows = [
      {
        client: "copilot",
        dashboardUrl: "http://127.0.0.1:24282/dashboard/index.html",
        mtimeMs: Date.now() - 10_000,
      },
      {
        client: "claude",
        dashboardUrl: "http://127.0.0.1:24283/dashboard/index.html",
        mtimeMs: Date.now() - 1_000,
      },
    ] as const;

    for (const row of clientRows) {
      const pidFile = resolve(runtimeRoot, `${row.client}.pid`);
      const logFile = resolve(runtimeRoot, `${row.client}.log`);
      const urlFile = resolve(runtimeRoot, `${row.client}.url`);

      writeFileSync(pidFile, String(process.pid), "utf8");
      writeFileSync(
        logFile,
        [
          "INFO 2026-04-01 11:12:31,452 [MainThread] serena.dashboard:run_in_thread:678 - Starting dashboard (listen_address=127.0.0.1, port=24283)",
          `INFO 2026-04-01 11:12:31,453 [MainThread] serena.agent:__init__:379 - Serena web dashboard started at ${row.dashboardUrl}`,
        ].join("\n"),
        "utf8",
      );
      writeFileSync(urlFile, row.dashboardUrl, "utf8");

      const timestamp = new Date(row.mtimeMs);
      utimesSync(logFile, timestamp, timestamp);
      utimesSync(urlFile, timestamp, timestamp);
    }

    const active = await pickMostRecentActiveClient();
    expect(active?.client).toBe("claude");
    expect(active?.dashboardUrl).toBe("http://127.0.0.1:24283/dashboard/index.html");
  });

  it("reads persisted dashboard URLs from the .url file", () => {
    tempStateHome = mkdtempSync(resolve(tmpdir(), "lattice-serena-url-"));
    process.env.XDG_STATE_HOME = tempStateHome;

    const runtimeRoot = getRuntimeRoot();
    mkdirSync(runtimeRoot, { recursive: true });

    const urlFile = resolve(runtimeRoot, "claude.url");
    writeFileSync(urlFile, "  http://127.0.0.1:24283/dashboard/index.html  \n", "utf8");

    expect(readDashboardUrlFile(urlFile)).toBe("http://127.0.0.1:24283/dashboard/index.html");
  });

  it("reports successful browser launches with an ok result", () => {
    const runner = () => ({
      status: 0,
    });

    expect(
      openExternalUrl("http://127.0.0.1:24283/dashboard/index.html", {
        platform: "darwin",
        runner,
      }),
    ).toEqual({ ok: true });
  });

  it("reports browser launch failures with an error result", () => {
    const runner = () => ({
      status: 1,
    });

    expect(
      openExternalUrl("http://127.0.0.1:24283/dashboard/index.html", {
        platform: "linux",
        runner,
      }),
    ).toEqual({
      ok: false,
      error: expect.any(Error),
    });
  });
});
