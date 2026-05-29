import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { validateRequiredSerenaMcpConfig } from "../serena/mcp-config-guard.mjs";

function createTempRoot() {
  const root = mkdtempSync(join(tmpdir(), "lattice-serena-pin-"));
  mkdirSync(join(root, ".codex"), { recursive: true });
  return root;
}

function serenaArgsWith(fromArg: string, context: string, root: string) {
  return [
    "--from",
    fromArg,
    "serena",
    "start-mcp-server",
    "--context",
    context,
    "--project",
    root,
  ];
}

function writeClaudeConfig(root: string, args: string[]) {
  writeFileSync(
    join(root, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        serena: {
          command: "uvx",
          args,
        },
      },
    }),
    "utf8",
  );
}

function writeClaudeHttpConfig(root: string, url = "http://127.0.0.1:9127/mcp") {
  writeFileSync(
    join(root, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        serena: {
          type: "http",
          url,
        },
      },
    }),
    "utf8",
  );
}

describe("Serena MCP config guard — upstream pinning (H4)", () => {
  it("accepts a loopback HTTP singleton", () => {
    const root = createTempRoot();
    writeClaudeHttpConfig(root);

    expect(validateRequiredSerenaMcpConfig("claude", { root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it("rejects non-loopback HTTP Serena endpoints", () => {
    const root = createTempRoot();
    writeClaudeHttpConfig(root, "https://example.com/mcp");

    const result = validateRequiredSerenaMcpConfig("claude", { root });
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("must point at a loopback HTTP endpoint");
  });

  it("accepts the bare upstream URL (current behavior)", () => {
    const root = createTempRoot();
    writeClaudeConfig(
      root,
      serenaArgsWith("git+https://github.com/oraios/serena", "claude-code", root),
    );

    expect(validateRequiredSerenaMcpConfig("claude", { root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it("accepts a @<tag> pin", () => {
    const root = createTempRoot();
    writeClaudeConfig(
      root,
      serenaArgsWith("git+https://github.com/oraios/serena@v0.1.4", "claude-code", root),
    );

    expect(validateRequiredSerenaMcpConfig("claude", { root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it("accepts a @<branch> pin", () => {
    const root = createTempRoot();
    writeClaudeConfig(
      root,
      serenaArgsWith("git+https://github.com/oraios/serena@main", "claude-code", root),
    );

    expect(validateRequiredSerenaMcpConfig("claude", { root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it("accepts a #<sha> pin", () => {
    const root = createTempRoot();
    writeClaudeConfig(
      root,
      serenaArgsWith(
        "git+https://github.com/oraios/serena#abcdef1234567890abcdef1234567890abcdef12",
        "claude-code",
        root,
      ),
    );

    expect(validateRequiredSerenaMcpConfig("claude", { root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it("accepts a #<ref> pin", () => {
    const root = createTempRoot();
    writeClaudeConfig(
      root,
      serenaArgsWith("git+https://github.com/oraios/serena#release-v1", "claude-code", root),
    );

    expect(validateRequiredSerenaMcpConfig("claude", { root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it("rejects a wrong upstream URL", () => {
    const root = createTempRoot();
    writeClaudeConfig(
      root,
      serenaArgsWith("git+https://github.com/attacker/serena-fork", "claude-code", root),
    );

    const result = validateRequiredSerenaMcpConfig("claude", { root });
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("must pin Serena");
  });

  it("rejects pin shapes that drop everything after @/# (empty pin token)", () => {
    const root = createTempRoot();
    writeClaudeConfig(
      root,
      serenaArgsWith("git+https://github.com/oraios/serena@", "claude-code", root),
    );

    const result = validateRequiredSerenaMcpConfig("claude", { root });
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("must pin Serena");
  });
});
