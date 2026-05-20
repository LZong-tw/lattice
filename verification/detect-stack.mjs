#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const CONFIG_FILES = [
  "tsconfig.json",
  "package.json",
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "composer.json",
];

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function executablePath(filePath) {
  try {
    return statSync(filePath).isFile() ? filePath : null;
  } catch {
    return null;
  }
}

function localBin(root, name) {
  const suffixes = process.platform === "win32" ? [".cmd", ".bat", ""] : [""];
  for (const suffix of suffixes) {
    const candidate = executablePath(join(root, "node_modules", ".bin", `${name}${suffix}`));
    if (candidate) return candidate;
  }

  return null;
}

function vendorBin(root, name) {
  const suffixes = process.platform === "win32" ? [".cmd", ".bat", ""] : [""];
  for (const suffix of suffixes) {
    const candidate = executablePath(join(root, "vendor", "bin", `${name}${suffix}`));
    if (candidate) return candidate;
  }

  return null;
}

export function findBinary(name) {
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, [name], { encoding: "utf8", timeout: 3000 });
  if (result.status !== 0) return null;

  return result.stdout.trim().split(/\r?\n/)[0] || null;
}

function commandIf(name, args, root) {
  const command = localBin(root, name) ?? findBinary(name);
  return command ? { cmd: command, args } : null;
}

function packageManager(root) {
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun";
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "package-lock.json"))) return "npm";
  return findBinary("pnpm") ? "pnpm" : findBinary("npm") ? "npm" : null;
}

function packageScriptCommand(pkgManager, scriptName) {
  if (!pkgManager || !findBinary(pkgManager)) return null;
  if (pkgManager === "yarn") return { cmd: pkgManager, args: [scriptName] };
  if (pkgManager === "bun") return { cmd: pkgManager, args: ["run", scriptName] };
  return { cmd: pkgManager, args: ["run", scriptName] };
}

function hasAny(root, names) {
  return names.some((name) => existsSync(join(root, name)));
}

export function walkUpFind(startDir, fileNames = CONFIG_FILES) {
  let dir = resolve(startDir);
  const root = parse(dir).root;

  while (true) {
    for (const fileName of fileNames) {
      if (existsSync(join(dir, fileName))) {
        return { dir, fileName };
      }
    }

    const parent = dirname(dir);
    if (parent === dir || dir === root) return null;
    dir = parent;
  }
}

export function detectProjectStack(startDir = process.cwd()) {
  const found = walkUpFind(startDir);
  const result = {
    projectRoot: found?.dir ?? resolve(startDir),
    typecheck: null,
    lint: null,
    lintFile: null,
    format: null,
    test: null,
    packageManager: null,
    lockfiles: [],
    sourceExtensions: [],
  };

  if (!found) return result;

  const root = found.dir;
  result.projectRoot = root;

  if (existsSync(join(root, "package.json"))) {
    const pkg = readJson(join(root, "package.json")) ?? {};
    const scripts = typeof pkg.scripts === "object" && pkg.scripts !== null ? pkg.scripts : {};
    result.packageManager = packageManager(root);

    if (existsSync(join(root, "bun.lockb"))) result.lockfiles.push("bun.lockb");
    if (existsSync(join(root, "bun.lock"))) result.lockfiles.push("bun.lock");
    if (existsSync(join(root, "pnpm-lock.yaml"))) result.lockfiles.push("pnpm-lock.yaml");
    if (existsSync(join(root, "yarn.lock"))) result.lockfiles.push("yarn.lock");
    if (existsSync(join(root, "package-lock.json"))) result.lockfiles.push("package-lock.json");

    if (scripts.typecheck) {
      result.typecheck = packageScriptCommand(result.packageManager, "typecheck");
    } else if (existsSync(join(root, "tsconfig.json"))) {
      const tsconfig = readJson(join(root, "tsconfig.json")) ?? {};
      result.typecheck = commandIf("tsc", tsconfig.references ? ["--build", "--noEmit"] : ["--noEmit"], root);
    }

    if (scripts.lint) {
      result.lint = packageScriptCommand(result.packageManager, "lint");
    }
    result.lintFile = commandIf("eslint", ["--max-warnings", "0"], root);
    result.lint ??= result.lintFile;

    if (scripts.test) {
      result.test = packageScriptCommand(result.packageManager, "test");
    }

    if (hasAny(root, [".prettierrc", ".prettierrc.json", ".prettierrc.js", "prettier.config.js", "prettier.config.mjs", "prettier.config.cjs"])) {
      result.format = commandIf("prettier", ["--write"], root);
    }

    result.sourceExtensions = existsSync(join(root, "tsconfig.json"))
      ? [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"]
      : [".js", ".jsx", ".mjs", ".cjs"];
  }

  if (existsSync(join(root, "go.mod"))) {
    result.typecheck = commandIf("go", ["build", "./..."], root);
    result.lint = commandIf("go", ["vet", "./..."], root);
    result.lintFile = commandIf("go", ["vet"], root);
    result.format = commandIf("gofmt", ["-w"], root);
    result.test = commandIf("go", ["test", "./..."], root);
    result.lockfiles.push("go.sum");
    result.sourceExtensions = [".go"];
  }

  if (existsSync(join(root, "Cargo.toml"))) {
    result.typecheck = commandIf("cargo", ["check"], root);
    result.lint = commandIf("cargo", ["clippy", "--", "-D", "warnings"], root);
    result.format = commandIf("cargo", ["fmt", "--"], root);
    result.test = commandIf("cargo", ["test"], root);
    result.lockfiles.push("Cargo.lock");
    result.sourceExtensions = [".rs"];
  }

  if (hasAny(root, ["pyproject.toml", "setup.py", "setup.cfg"])) {
    result.typecheck = commandIf("mypy", ["."], root) ?? commandIf("pyright", [], root);
    result.lint = commandIf("ruff", ["check", "."], root) ?? commandIf("flake8", ["."], root);
    result.lintFile = commandIf("ruff", ["check"], root) ?? commandIf("flake8", [], root);
    result.format = commandIf("ruff", ["format"], root) ?? commandIf("black", [], root);
    result.test = commandIf("pytest", [], root);
    result.sourceExtensions = [".py", ".pyx"];
  }

  if (existsSync(join(root, "composer.json"))) {
    const phpstan = vendorBin(root, "phpstan");
    const pint = vendorBin(root, "pint");
    const fixer = vendorBin(root, "php-cs-fixer");
    const phpunit = vendorBin(root, "phpunit");

    if (phpstan) result.typecheck = { cmd: phpstan, args: ["analyse"] };
    if (pint) {
      result.lint = { cmd: pint, args: ["--test"] };
      result.lintFile = { cmd: pint, args: ["--test"] };
      result.format = { cmd: pint, args: [] };
    } else if (fixer) {
      result.lint = { cmd: fixer, args: ["fix", "--dry-run", "--diff"] };
      result.lintFile = { cmd: fixer, args: ["fix", "--dry-run", "--diff"] };
      result.format = { cmd: fixer, args: ["fix"] };
    }
    if (phpunit) result.test = { cmd: phpunit, args: [] };
    result.lockfiles.push("composer.lock");
    result.sourceExtensions = [".php"];
  }

  return result;
}
