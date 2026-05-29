import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  discoverCodexPluginHookFiles,
  normalizeCodexPluginHookCommand,
  repairCodexPluginHookFile,
  repairCodexPluginHooks,
} from "../codex-plugin-hooks-repair.mjs";
import { parseRepairArgs } from "../init.mjs";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-codex-plugin-hooks-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function writeHooksJson(relativePluginRoot: string, hooks: unknown) {
  const pluginRoot = path.join(tempDir, ".codex", "plugins", "cache", relativePluginRoot);
  const hooksDir = path.join(pluginRoot, "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  const hooksFile = path.join(hooksDir, "hooks.json");
  fs.writeFileSync(hooksFile, JSON.stringify(hooks, null, 2), "utf8");
  return { pluginRoot, hooksFile };
}

describe("normalizeCodexPluginHookCommand", () => {
  it("replaces CLAUDE_PLUGIN_ROOT placeholders with the concrete plugin root", () => {
    const result = normalizeCodexPluginHookCommand(
      'node "${CLAUDE_PLUGIN_ROOT}/hooks/session_start.js"',
      "C:\\Users\\LZong\\.codex\\plugins\\cache\\vercel\\0.43.0",
      { platform: "win32" },
    );

    expect(result.command).toBe(
      'node "C:/Users/LZong/.codex/plugins/cache/vercel/0.43.0/hooks/session_start.js"',
    );
    expect(result.fixes).toContain("expanded CLAUDE_PLUGIN_ROOT");
  });

  it("uses Git Bash for shell hooks on Windows instead of bare bash", () => {
    const result = normalizeCodexPluginHookCommand(
      'bash "${CLAUDE_PLUGIN_ROOT}/hooks/stop-hook.sh"',
      "C:\\Users\\LZong\\.codex\\plugins\\cache\\ralph-loop\\1.0.0",
      {
        platform: "win32",
        gitBashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
      },
    );

    expect(result.command).toBe(
      '"C:/Program Files/Git/bin/bash.exe" "C:/Users/LZong/.codex/plugins/cache/ralph-loop/1.0.0/hooks/stop-hook.sh"',
    );
    expect(result.fixes).toEqual([
      "expanded CLAUDE_PLUGIN_ROOT",
      "replaced bare bash with Git Bash",
    ]);
  });

  it("leaves non-hook bash commands alone", () => {
    const result = normalizeCodexPluginHookCommand('bash -lc "echo ok"', "C:\\plugin", {
      platform: "win32",
      gitBashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
    });

    expect(result.command).toBe('bash -lc "echo ok"');
    expect(result.changed).toBe(false);
  });

  it("suppresses noisy Codex companion Node warnings without hiding hook stderr", () => {
    const result = normalizeCodexPluginHookCommand(
      'node "${CLAUDE_PLUGIN_ROOT}/scripts/session-lifecycle-hook.mjs"',
      "C:\\Users\\LZong\\.codex\\plugins\\cache\\openai-codex\\codex\\1.0.4",
      { platform: "win32" },
    );

    expect(result.command).toBe(
      'node --no-warnings "C:/Users/LZong/.codex/plugins/cache/openai-codex/codex/1.0.4/scripts/session-lifecycle-hook.mjs"',
    );
    expect(result.fixes).toEqual([
      "expanded CLAUDE_PLUGIN_ROOT",
      "added node --no-warnings for Codex companion hook",
    ]);
  });
});

describe("repairCodexPluginHookFile", () => {
  it("reports dry-run repairs without changing the manifest", () => {
    const { hooksFile } = writeHooksJson("vendor/plugin/1.0.0", {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh"' }] }],
      },
    });
    const before = fs.readFileSync(hooksFile, "utf8");

    const result = repairCodexPluginHookFile(hooksFile, {
      platform: "win32",
      gitBashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
      write: false,
    });

    expect(result.changed).toBe(true);
    expect(result.fixes.map((fix: { reason: string }) => fix.reason)).toEqual([
      "expanded CLAUDE_PLUGIN_ROOT; replaced bare bash with Git Bash",
    ]);
    expect(fs.readFileSync(hooksFile, "utf8")).toBe(before);
  });

  it("writes repaired manifests when requested", () => {
    const { hooksFile } = writeHooksJson("vendor/plugin/1.0.0", {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js"',
              },
            ],
          },
        ],
      },
    });

    const result = repairCodexPluginHookFile(hooksFile, {
      platform: "win32",
      write: true,
    });

    expect(result.changed).toBe(true);
    expect(fs.readFileSync(hooksFile, "utf8")).toContain(
      "vendor/plugin/1.0.0/hooks/session-start.js",
    );
  });
});

describe("repairCodexPluginHooks", () => {
  it("discovers plugin hook manifests under the Codex cache", () => {
    const first = writeHooksJson("vendor/one/1.0.0", { hooks: {} });
    const second = writeHooksJson("vendor/two/2.0.0", { hooks: {} });

    expect(discoverCodexPluginHookFiles({ codexHome: path.join(tempDir, ".codex") }).sort()).toEqual(
      [first.hooksFile, second.hooksFile].sort(),
    );
  });

  it("repairs every discovered manifest", () => {
    writeHooksJson("vendor/one/1.0.0", {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/x.js"' }] }],
      },
    });
    writeHooksJson("vendor/two/2.0.0", {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: 'bash "${CLAUDE_PLUGIN_ROOT}/x.sh"' }] }],
      },
    });

    const result = repairCodexPluginHooks({
      codexHome: path.join(tempDir, ".codex"),
      platform: "win32",
      gitBashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
      write: false,
    });

    expect(result.checked).toBe(2);
    expect(result.changed).toBe(2);
    expect(
      result.files
        .flatMap((file: { fixes: Array<{ reason: string }> }) => file.fixes)
        .map((fix: { reason: string }) => fix.reason),
    ).toEqual([
      "expanded CLAUDE_PLUGIN_ROOT",
      "expanded CLAUDE_PLUGIN_ROOT; replaced bare bash with Git Bash",
    ]);
  });
});

describe("parseRepairArgs", () => {
  it("defaults Codex plugin hook repair to dry-run", () => {
    expect(parseRepairArgs(["repair", "codex-plugin-hooks"])).toEqual({
      write: false,
      format: "markdown",
    });
  });

  it("supports write mode and explicit paths", () => {
    const parsed = parseRepairArgs([
      "repair",
      "codex-plugin-hooks",
      "--write",
      "--codex-home",
      tempDir,
      "--git-bash",
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "--json",
    ]);

    expect(parsed).toEqual({
      write: true,
      format: "json",
      codexHome: path.resolve(tempDir),
      gitBashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
    });
  });
});
