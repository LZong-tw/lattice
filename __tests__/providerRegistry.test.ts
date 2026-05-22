import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PROVIDER_NAMES,
  bootstrapProviders,
  parseProviderList,
  providerRegistry,
  resolveSelectedProviders,
} from "../provider-registry.mjs";

const packageRoot = process.cwd();

function createRegistry(bootstraps: Record<string, ReturnType<typeof vi.fn>>) {
  return Object.fromEntries(
    Object.entries(bootstraps).map(([name, bootstrap]) => [
      name,
      { bootstrap: bootstrap as unknown as (client: string) => Promise<number> | number },
    ]),
  );
}

describe("parseProviderList", () => {
  it("normalizes, deduplicates, and preserves order", () => {
    expect(parseProviderList(" Serena, serena , MCP-LOCAL-RAG ")).toEqual([
      "serena",
      "mcp-local-rag",
    ]);
  });

  it("returns an empty list when only disable tokens are present", () => {
    expect(parseProviderList(" none, OFF , false ")).toEqual([]);
  });

  it("ignores disable tokens when real providers are also listed", () => {
    expect(parseProviderList("none,serena,off")).toEqual(["serena"]);
  });
});

describe("resolveSelectedProviders", () => {
  it("defaults to Serena when no provider env vars are set", () => {
    const selection = resolveSelectedProviders({ env: {} });

    expect(selection.source).toBe("default");
    expect(selection.strict).toBe(false);
    expect(selection.requestedNames).toEqual(DEFAULT_PROVIDER_NAMES);
    expect(selection.providers.map((provider) => provider.name)).toEqual(["serena"]);
    expect(selection.unknownNames).toEqual([]);
  });

  it("accepts case-insensitive LATTICE_PROVIDER values", () => {
    const selection = resolveSelectedProviders({
      env: { LATTICE_PROVIDER: " SeReNa " },
    });

    expect(selection.source).toBe("LATTICE_PROVIDER");
    expect(selection.strict).toBe(true);
    expect(selection.providers.map((provider) => provider.name)).toEqual(["serena"]);
  });

  it("lets LATTICE_PROVIDERS override LATTICE_PROVIDER and preserve order", () => {
    const selection = resolveSelectedProviders({
      env: {
        LATTICE_PROVIDER: "serena",
        LATTICE_PROVIDERS: "mcp-local-rag,serena,serena",
      },
      registry: createRegistry({
        "mcp-local-rag": vi.fn().mockResolvedValue(0),
        serena: vi.fn().mockResolvedValue(0),
      }),
    });

    expect(selection.source).toBe("LATTICE_PROVIDERS");
    expect(selection.providers.map((provider) => provider.name)).toEqual([
      "mcp-local-rag",
      "serena",
    ]);
  });

  it("tracks unknown providers for explicit selections", () => {
    const selection = resolveSelectedProviders({
      env: { LATTICE_PROVIDERS: "serena,ghost" },
    });

    expect(selection.strict).toBe(true);
    expect(selection.providers.map((provider) => provider.name)).toEqual(["serena"]);
    expect(selection.unknownNames).toEqual(["ghost"]);
  });

  it("returns no providers when explicit disable tokens are used", () => {
    const selection = resolveSelectedProviders({
      env: { LATTICE_PROVIDER: "off" },
    });

    expect(selection.strict).toBe(true);
    expect(selection.providers).toEqual([]);
    expect(selection.requestedNames).toEqual([]);
  });
});

describe("bootstrapProviders", () => {
  it("fails fast on unknown explicit providers", async () => {
    const onError = vi.fn();
    const serena = vi.fn().mockResolvedValue(0);

    const code = await bootstrapProviders("claude-code", {
      env: { LATTICE_PROVIDER: "ghost" },
      registry: createRegistry({ serena }),
      onError,
    });

    expect(code).toBe(1);
    expect(serena).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("unknown provider in LATTICE_PROVIDER: ghost"),
    );
  });

  it("keeps the default Serena path permissive when bootstrap throws", async () => {
    const onError = vi.fn();

    const code = await bootstrapProviders("copilot", {
      env: {},
      registry: createRegistry({
        serena: vi.fn().mockRejectedValue(new Error("missing bootstrap module")),
      }),
      onError,
    });

    expect(code).toBe(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it("surfaces explicit provider bootstrap failures", async () => {
    const onError = vi.fn();

    const code = await bootstrapProviders("claude-code", {
      env: { LATTICE_PROVIDER: "serena" },
      registry: createRegistry({
        serena: vi.fn().mockRejectedValue(new Error("boom")),
      }),
      onError,
    });

    expect(code).toBe(1);
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('provider "serena" bootstrap failed: boom'),
    );
  });

  it("runs providers in order and stops on the first non-zero exit code", async () => {
    const callOrder: string[] = [];
    const first = vi.fn().mockImplementation(async () => {
      callOrder.push("mcp-local-rag");
      return 7;
    });
    const second = vi.fn().mockImplementation(async () => {
      callOrder.push("serena");
      return 0;
    });

    const code = await bootstrapProviders("copilot", {
      env: { LATTICE_PROVIDERS: "mcp-local-rag,serena" },
      registry: createRegistry({
        "mcp-local-rag": first,
        serena: second,
      }),
      onError: vi.fn(),
    });

    expect(code).toBe(7);
    expect(callOrder).toEqual(["mcp-local-rag"]);
    expect(second).not.toHaveBeenCalled();
  });
});

describe("provider-registry module contract", () => {
  it("keeps the registry file at the package root", () => {
    expect(existsSync(resolve(packageRoot, "provider-registry.mjs"))).toBe(true);
  });

  it("ships Serena in the default registry", () => {
    expect(providerRegistry).toHaveProperty("serena");
    expect(typeof providerRegistry.serena.bootstrap).toBe("function");
  });

  it("exports ./provider-registry in package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
    expect(pkg.exports["./provider-registry"]).toBe("./provider-registry.mjs");
  });
});
