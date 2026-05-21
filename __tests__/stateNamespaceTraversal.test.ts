import { afterEach, describe, expect, it } from "vitest";

import { getStateNamespace } from "../common.mjs";

const originalNs = process.env.LATTICE_STATE_NAMESPACE;

afterEach(() => {
  if (originalNs === undefined) {
    delete process.env.LATTICE_STATE_NAMESPACE;
  } else {
    process.env.LATTICE_STATE_NAMESPACE = originalNs;
  }
});

describe("getStateNamespace — LATTICE_STATE_NAMESPACE traversal (B4)", () => {
  it("falls back to repoRoot basename when env var is unset", () => {
    delete process.env.LATTICE_STATE_NAMESPACE;
    expect(getStateNamespace("/var/repo/myproject")).toBe("myproject");
  });

  it("accepts a plain alphanumeric namespace verbatim", () => {
    process.env.LATTICE_STATE_NAMESPACE = "my-app_v2";
    expect(getStateNamespace("/var/repo/x")).toBe("my-app_v2");
  });

  it("rejects forward-slash path separators", () => {
    process.env.LATTICE_STATE_NAMESPACE = "../../etc";
    expect(() => getStateNamespace("/var/repo/x")).toThrow(/path separators or null bytes/);
  });

  it("rejects backslash path separators", () => {
    process.env.LATTICE_STATE_NAMESPACE = "foo\\bar";
    expect(() => getStateNamespace("/var/repo/x")).toThrow(/path separators or null bytes/);
  });

  // Note: Node.js strips null bytes from process.env values at the OS
  // boundary (they delimit C strings), so a null byte cannot reach
  // getStateNamespace through the env in practice. The runtime check
  // remains as defense-in-depth for any caller that might pass a value
  // by another route, but is not testable via process.env.

  it("rejects '.' and '..' exact values", () => {
    process.env.LATTICE_STATE_NAMESPACE = ".";
    expect(() => getStateNamespace("/var/repo/x")).toThrow(/'.' or '..'/);

    process.env.LATTICE_STATE_NAMESPACE = "..";
    expect(() => getStateNamespace("/var/repo/x")).toThrow(/'.' or '..'/);
  });

  it("rejects absolute-path-shaped namespaces (contains /)", () => {
    process.env.LATTICE_STATE_NAMESPACE = "/abs/path";
    expect(() => getStateNamespace("/var/repo/x")).toThrow(/path separators or null bytes/);
  });

  it("sanitizes unsafe characters to underscore", () => {
    process.env.LATTICE_STATE_NAMESPACE = "my app:v1";
    expect(getStateNamespace("/var/repo/x")).toBe("my_app_v1");
  });

  it("trims surrounding whitespace before validation", () => {
    process.env.LATTICE_STATE_NAMESPACE = "  myapp  ";
    expect(getStateNamespace("/var/repo/x")).toBe("myapp");
  });

  it("falls back to repoRoot basename when env var is empty/whitespace", () => {
    process.env.LATTICE_STATE_NAMESPACE = "   ";
    expect(getStateNamespace("/var/repo/myproject")).toBe("myproject");
  });
});
