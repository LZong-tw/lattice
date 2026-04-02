import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  getDashboardOpenPlan,
  extractDashboardUrl,
  getDashboardPlatformStrategy,
  getRuntimeRoot,
  openExternalUrl,
  pickMostRecentActiveClient,
  readDashboardUrlFile,
} from "../serena/dashboard-state.mjs";

const originalStateHome = process.env.XDG_STATE_HOME;
const testStateRoot = resolve(process.cwd(), ".test-state", "serenaDashboardState");
let tempStateHome: string | null = null;

function createStateHome(prefix: string) {
  const stateHome = resolve(testStateRoot, `${prefix}-${process.pid}-${randomUUID()}`);
  mkdirSync(stateHome, { recursive: true });
  return stateHome;
}

afterEach(() => {
  if (tempStateHome) {
    rmSync(tempStateHome, { recursive: true, force: true });
    tempStateHome = null;
  }

  rmSync(testStateRoot, { recursive: true, force: true });

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
    tempStateHome = createStateHome("state");
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
    tempStateHome = createStateHome("url");
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

  it("uses the expected browser opener for each supported platform", () => {
    const dashboardUrl = "http://127.0.0.1:24283/dashboard/index.html";
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = (command: string, args: string[]) => {
      calls.push({ command, args });
      return { status: 0 };
    };

    expect(openExternalUrl(dashboardUrl, { platform: "darwin", runner })).toEqual({ ok: true });
    expect(openExternalUrl(dashboardUrl, { platform: "linux", runner })).toEqual({ ok: true });
    expect(openExternalUrl(dashboardUrl, { platform: "win32", runner })).toEqual({ ok: true });

    expect(calls).toEqual([
      { command: "open", args: [dashboardUrl] },
      { command: "xdg-open", args: [dashboardUrl] },
      { command: "cmd", args: ["/c", "start", "", dashboardUrl] },
    ]);
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

describe("getDashboardPlatformStrategy", () => {
  it("returns 'tray' on Windows", () => {
    expect(getDashboardPlatformStrategy("win32")).toBe("tray");
  });

  it("returns 'browser' on macOS (native tray disabled upstream)", () => {
    expect(getDashboardPlatformStrategy("darwin")).toBe("browser");
  });

  it("returns 'browser' on Linux", () => {
    expect(getDashboardPlatformStrategy("linux")).toBe("browser");
  });

  it("returns 'browser' for unknown platforms", () => {
    expect(getDashboardPlatformStrategy("freebsd")).toBe("browser");
  });
});

describe("getDashboardOpenPlan", () => {
  it("keeps Windows on the tray workflow by default", () => {
    expect(getDashboardOpenPlan({ platform: "win32" })).toEqual({
      strategy: "tray",
      openInBrowser: false,
    });
  });

  it("lets Windows users opt into the browser explicitly", () => {
    expect(getDashboardOpenPlan({ platform: "win32", forceBrowser: true })).toEqual({
      strategy: "tray",
      openInBrowser: true,
    });
  });

  it("opens in the browser by default on macOS and Linux", () => {
    expect(getDashboardOpenPlan({ platform: "darwin" })).toEqual({
      strategy: "browser",
      openInBrowser: true,
    });
    expect(getDashboardOpenPlan({ platform: "linux" })).toEqual({
      strategy: "browser",
      openInBrowser: true,
    });
  });
});
