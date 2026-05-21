import { describe, expect, it } from "vitest";

import { isValidNpmSpecifier } from "../register-builtins.mjs";

describe("isValidNpmSpecifier — accepts npm-shaped names", () => {
  it("accepts bare package names", () => {
    expect(isValidNpmSpecifier("foo")).toBe(true);
    expect(isValidNpmSpecifier("foo-bar")).toBe(true);
    expect(isValidNpmSpecifier("foo.bar")).toBe(true);
    expect(isValidNpmSpecifier("foo_bar")).toBe(true);
    expect(isValidNpmSpecifier("foo123")).toBe(true);
    expect(isValidNpmSpecifier("0to1")).toBe(true);
  });

  it("accepts scoped package names", () => {
    expect(isValidNpmSpecifier("@scope/pkg")).toBe(true);
    expect(isValidNpmSpecifier("@my-org/my-pkg")).toBe(true);
    expect(isValidNpmSpecifier("@lattice/clawback")).toBe(true);
  });

  it("accepts npm names with /subpath suffix", () => {
    expect(isValidNpmSpecifier("foo/sub")).toBe(true);
    expect(isValidNpmSpecifier("foo/sub/deep")).toBe(true);
    expect(isValidNpmSpecifier("@scope/pkg/sub")).toBe(true);
    expect(isValidNpmSpecifier("@scope/pkg/sub/deep")).toBe(true);
  });
});

describe("isValidNpmSpecifier — rejects ACE vectors", () => {
  it("rejects empty / non-string", () => {
    expect(isValidNpmSpecifier("")).toBe(false);
    expect(isValidNpmSpecifier(undefined as unknown as string)).toBe(false);
    expect(isValidNpmSpecifier(123 as unknown as string)).toBe(false);
  });

  it("rejects URL-shaped specifiers", () => {
    expect(isValidNpmSpecifier("file:///tmp/evil.mjs")).toBe(false);
    expect(isValidNpmSpecifier("file:./evil.mjs")).toBe(false);
    expect(isValidNpmSpecifier("data:text/javascript;base64,Zm9v")).toBe(false);
    expect(isValidNpmSpecifier("http://evil.example/x.js")).toBe(false);
    expect(isValidNpmSpecifier("https://evil.example/x.js")).toBe(false);
    expect(isValidNpmSpecifier("node:fs")).toBe(false);
    expect(isValidNpmSpecifier("npm:foo")).toBe(false);
  });

  it("rejects absolute and relative paths", () => {
    expect(isValidNpmSpecifier("/etc/passwd")).toBe(false);
    expect(isValidNpmSpecifier("/tmp/evil.mjs")).toBe(false);
    expect(isValidNpmSpecifier("./evil.mjs")).toBe(false);
    expect(isValidNpmSpecifier("../evil.mjs")).toBe(false);
    expect(isValidNpmSpecifier("../../etc/passwd")).toBe(false);
  });

  it("rejects backslashes (Windows paths)", () => {
    expect(isValidNpmSpecifier("C:\\Users\\evil")).toBe(false);
    expect(isValidNpmSpecifier("foo\\bar")).toBe(false);
  });

  it("rejects whitespace and control characters", () => {
    expect(isValidNpmSpecifier("foo bar")).toBe(false);
    expect(isValidNpmSpecifier("foo\nbar")).toBe(false);
    expect(isValidNpmSpecifier("foo\tbar")).toBe(false);
    expect(isValidNpmSpecifier("foo\x00bar")).toBe(false);
  });

  it("rejects uppercase (npm names are lowercase)", () => {
    expect(isValidNpmSpecifier("Foo")).toBe(false);
    expect(isValidNpmSpecifier("@Scope/pkg")).toBe(false);
    expect(isValidNpmSpecifier("foo/Sub")).toBe(true);
    // Note: npm subpaths inside packages are case-sensitive on disk; we
    // do not restrict subpath case. Only the package-name portion is
    // forced lowercase to match npm's canonical name shape.
  });

  it("rejects scoped specifiers missing the /pkg portion", () => {
    expect(isValidNpmSpecifier("@scope")).toBe(false);
    expect(isValidNpmSpecifier("@scope/")).toBe(false);
    expect(isValidNpmSpecifier("@")).toBe(false);
  });

  it("rejects names starting with . or /", () => {
    expect(isValidNpmSpecifier(".foo")).toBe(false);
    expect(isValidNpmSpecifier("/foo")).toBe(false);
  });

  it("rejects .. segments in subpaths", () => {
    expect(isValidNpmSpecifier("foo/..")).toBe(false);
    expect(isValidNpmSpecifier("foo/../etc")).toBe(false);
    expect(isValidNpmSpecifier("@scope/pkg/..")).toBe(false);
    expect(isValidNpmSpecifier("@scope/pkg/../etc")).toBe(false);
  });

  it("rejects empty subpath segments (double slash)", () => {
    expect(isValidNpmSpecifier("foo//bar")).toBe(false);
    expect(isValidNpmSpecifier("foo/")).toBe(false);
  });
});
