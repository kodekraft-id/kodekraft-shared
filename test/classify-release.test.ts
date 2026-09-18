// Fixture-based proof that scripts/classify-release.mjs correctly classifies widening vs.
// narrowing changes (OPS-shared-20). Follows the same real-subprocess, real-fixture pattern
// as test/check-ownership.test.ts: the classifier is a standalone CLI that shells out to
// `git show <ref>:<path>`, so the only faithful way to test it is against a real git repo
// with real commits — not by importing its internals.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, "..");
const SCRIPT = join(PACKAGE_ROOT, "scripts", "classify-release.mjs");

function run(cwd: string, args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

/** Minimal base ownership.json matrix, mirroring the real file's shape closely enough to diff. */
function baseMatrix() {
  return {
    apps: ["worker-landing", "worker-user", "worker-undangan", "worker-admin"],
    tables: {
      clients: {
        module: "schema/clients.ts",
        writers: {
          "worker-landing": ["id", "name", "email"],
          "worker-admin": ["deleted_at", "updated_at"],
        },
        readers: [],
      },
      testimonials: {
        module: "schema/catalog.ts",
        writers: { "worker-admin": "*" },
        readers: ["worker-landing", "worker-user"],
      },
    },
  };
}

/** Sets up a throwaway git repo with an initial commit of `ownership.json` (+ optional package.json/migrations.lock.json). */
function initRepo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "classify-release-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "initial"]);
  const firstSha = git(dir, ["rev-parse", "HEAD"]);
  return { dir, firstSha };
}

function commit(dir: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "next"]);
  return git(dir, ["rev-parse", "HEAD"]);
}

describe("scripts/classify-release.mjs", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  // Each test shells out to `git init`/`git commit` plus this script as a real subprocess.
  // The first git invocation of a run can be slow on Windows (cold filesystem cache), so this
  // suite gets a higher-than-default per-test timeout rather than a globally raised one.
  const GIT_SUBPROCESS_TIMEOUT_MS = 20_000;

  it("classifies a new writer grant and a new table as WIDENING, needing no lockstep", () => {
    const before = baseMatrix();
    const { dir: repoDir, firstSha } = initRepo({ "ownership.json": JSON.stringify(before) });
    dir = repoDir;

    const after = baseMatrix();
    // worker-user gains a write grant on testimonials it didn't have before.
    (after.tables.testimonials.writers as Record<string, unknown>)["worker-user"] = "*";
    // A brand-new table appears with a single writer.
    (after.tables as Record<string, unknown>).order_status_log = {
      module: "schema/orders.ts",
      writers: { "worker-landing": "*" },
      readers: ["worker-admin"],
    };
    const secondSha = commit(dir, { "ownership.json": JSON.stringify(after) });

    const result = run(dir, [firstSha, secondSha]);
    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/\[WIDENING\].*table "testimonials": app "worker-user" gained write access/);
    expect(output).toMatch(/\[WIDENING\].*table "order_status_log" added/);
    expect(output).not.toContain("[NARROWING]");
    expect(output).toContain("Pure widening release. No lockstep required");
  }, GIT_SUBPROCESS_TIMEOUT_MS);

  it("classifies a revoked write grant and a tightened column allowlist as NARROWING, needing lockstep coordination", () => {
    const before = baseMatrix();
    const { dir: repoDir, firstSha } = initRepo({ "ownership.json": JSON.stringify(before) });
    dir = repoDir;

    const after = baseMatrix();
    // worker-admin loses its write grant on clients entirely.
    delete (after.tables.clients.writers as Record<string, unknown>)["worker-admin"];
    // worker-landing's clients allowlist shrinks (loses "email").
    (after.tables.clients.writers as Record<string, string[]>)["worker-landing"] = ["id", "name"];
    const secondSha = commit(dir, { "ownership.json": JSON.stringify(after) });

    const result = run(dir, [firstSha, secondSha]);
    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/\[NARROWING\].*table "clients": app "worker-admin" lost write access entirely/);
    expect(output).toMatch(/\[NARROWING\].*table "clients": app "worker-landing".*tightened.*lost column\(s\): email/);
    expect(output).toContain("THIS RELEASE NEEDS LOCKSTEP COORDINATION");
    expect(output).toContain("narrowed app(s) must bump and deploy FIRST");
  }, GIT_SUBPROCESS_TIMEOUT_MS);

  it("flags a migrations.lock.json change as LOCKSTEP even with no ownership.json change", () => {
    const matrix = baseMatrix();
    const lockBefore = { "0001_init.sql": "aaa" };
    const { dir: repoDir, firstSha } = initRepo({
      "ownership.json": JSON.stringify(matrix),
      "migrations.lock.json": JSON.stringify(lockBefore),
    });
    dir = repoDir;

    const lockAfter = { "0001_init.sql": "aaa", "0013_new_table.sql": "bbb" };
    const secondSha = commit(dir, { "migrations.lock.json": JSON.stringify(lockAfter) });

    const result = run(dir, [firstSha, secondSha]);
    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/\[LOCKSTEP\].*migrations\.lock\.json.*0013_new_table\.sql \(added\)/);
    expect(output).toContain("THIS RELEASE NEEDS LOCKSTEP COORDINATION");
  }, GIT_SUBPROCESS_TIMEOUT_MS);

  it("classifies a new package.json export as WIDENING and a removed export as NARROWING", () => {
    const matrix = baseMatrix();
    const { dir: repoDir, firstSha } = initRepo({
      "ownership.json": JSON.stringify(matrix),
      "package.json": JSON.stringify({ exports: { "./ownership": "./dist/ownership.js", "./client": "./dist/client.js" } }),
    });
    dir = repoDir;

    const secondSha = commit(dir, {
      "package.json": JSON.stringify({ exports: { "./ownership": "./dist/ownership.js", "./tier": "./dist/tier.js" } }),
    });

    const result = run(dir, [firstSha, secondSha]);
    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('[WIDENING] (exports) new export added: "./tier"');
    expect(output).toContain('[NARROWING] (exports) export removed: "./client"');
  }, GIT_SUBPROCESS_TIMEOUT_MS);

  it("reports no changes when the two refs are identical", () => {
    const matrix = baseMatrix();
    const { dir: repoDir, firstSha } = initRepo({ "ownership.json": JSON.stringify(matrix) });
    dir = repoDir;

    const result = run(dir, [firstSha, firstSha]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No changes detected");
  }, GIT_SUBPROCESS_TIMEOUT_MS);

  it("exits 1 with a usage error when not given exactly 2 arguments", () => {
    const matrix = baseMatrix();
    const { dir: repoDir } = initRepo({ "ownership.json": JSON.stringify(matrix) });
    dir = repoDir;

    const result = run(dir, ["only-one-ref"]);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("expected exactly 2 arguments");
  }, GIT_SUBPROCESS_TIMEOUT_MS);
});
