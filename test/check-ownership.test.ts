// Fixture-based proof that bin/check-ownership.mjs's rules actually fire (OPS-mono-14).
// No app repo depends on @kodekraft/shared yet, so this is the only verification available
// before a real integration task (BE-undangan-07) runs the CLI for real. The script is
// invoked as a real subprocess (matches how a consumer's `pnpm exec kodekraft-check-ownership`
// would run it), never imported — it's a standalone CLI by design (doc 12 §5.4).

import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, "..");
const BIN = join(PACKAGE_ROOT, "bin", "check-ownership.mjs");
const FIXTURES = join(HERE, "fixtures");

/**
 * Runs the real CLI (this package's bin/check-ownership.mjs) as a subprocess against `cwd`.
 * Uses spawnSync (not execFileSync) so stdout+stderr are both captured on every exit code,
 * not just on failure.
 */
function run(cwd: string, args: string[] = [], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * Same as `run`, but invokes the COPY of the script living inside `dir` (dir/bin/check-ownership.mjs)
 * instead of this package's real bin script. Needed for the "own repo" mode tests: own-repo
 * detection compares process.cwd() against the invoked script's own package root, so exercising
 * that mode requires actually running a script instance whose package root IS the fixture dir.
 */
function runOwn(dir: string, args: string[] = [], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [join(dir, "bin", "check-ownership.mjs"), ...args], {
    cwd: dir,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

describe("check-ownership.mjs — consumer mode", () => {
  it("passes cleanly on a fixture consumer with no violations (R2'/R3/R4/R5 all satisfied, R4-exempt paths present)", () => {
    // R7 is tested in isolation below with a dynamically-built, real-hash fixture — this
    // fixture's migrations/0001_init.sql is fixture content, not byte-identical to the real
    // migration, so it's deliberately decoupled from the real package-root migrations.lock.json
    // (same override the "R7 SKIPPED" test below uses) to keep this test about R2'/R3/R4/R5 only.
    const result = run(join(FIXTURES, "consumer-pass"), [], {
      KODEKRAFT_SHARED_TEST_LOCK_PATH: join(tmpdir(), "does-not-exist-lock.json"),
    });
    expect(result.stdout + result.stderr).toContain("no violations found");
    expect(result.status).toBe(0);
  });

  it("R2' fails when package.json has no kodekraft block at all", () => {
    const result = run(join(FIXTURES, "consumer-fail-r2"));
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/package\.json:\d+ — \[R2'\]/);
    expect(result.stdout + result.stderr).toContain('missing required "kodekraft" block');
  });

  it("R2' fails when kodekraft.app is not in ownership.json's apps array", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-ownership-r2-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "fixture", kodekraft: { app: "worker-does-not-exist" } }),
      );
      const result = run(dir);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain("is not present in ownership.json's");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R3 fails on a deep import that reaches around the exports map into @kodekraft/shared/src", () => {
    const result = run(join(FIXTURES, "consumer-fail-r3"));
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/bad-import\.ts:\d+ — \[R3\]/);
    expect(result.stdout + result.stderr).toContain("deep-import escape");
  });

  it("R4 fails on raw env.DB access outside kodekraft.dbCompositionRoot", () => {
    const result = run(join(FIXTURES, "consumer-fail-r4"));
    expect(result.status).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/routes[\\/]open\.ts:\d+ — \[R4\]/);
    expect(output).toContain("raw D1 binding access");
  });

  it("R4 does NOT fire on the composition root, bindings.ts's type declaration, or test/**", () => {
    const result = run(join(FIXTURES, "consumer-pass"));
    const output = result.stdout + result.stderr;
    expect(output).not.toContain("client.ts");
    expect(output).not.toContain("bindings.ts");
    expect(output).not.toContain("gate-ordering.test.ts");
  });

  it("R4 does NOT fire on a regex literal's .exec(), or a variable holding a RegExp's .exec() — regression for the v0.1.1 false-positive fix", () => {
    const result = run(join(FIXTURES, "consumer-pass"), [], {
      KODEKRAFT_SHARED_TEST_LOCK_PATH: join(tmpdir(), "does-not-exist-lock.json"),
    });
    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).not.toContain("regex-safe.ts");
    expect(output).toContain("no violations found");
  });

  it("R4 still fails on a binding-shaped receiver (\"db\", \"ctx.dbBinding\") calling .batch()/.prepare() outside the composition root, even without the literal substring \"env.DB\"", () => {
    const result = run(join(FIXTURES, "consumer-fail-r4-method-call"));
    expect(result.status).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/routes[\\/]sync\.ts:\d+ — \[R4\]/);
    expect(output).toContain(".prepare()/.batch()/.exec() call outside kodekraft.dbCompositionRoot");
  });

  it("R4 does NOT fire on a doc comment (line or block) that merely mentions env.DB/.batch()/.prepare()/.exec() in prose — regression for the v0.1.2 false-positive fix (OPS-shared-21)", () => {
    const result = run(join(FIXTURES, "consumer-pass"), [], {
      KODEKRAFT_SHARED_TEST_LOCK_PATH: join(tmpdir(), "does-not-exist-lock.json"),
    });
    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).not.toContain("doc-comment-mentions.ts");
    expect(output).toContain("no violations found");
  });

  it('R4 does NOT fire on a receiver whose declared type is the composition root\'s own guarded return type ("db: Db" factory-function parameter, or "this.db" via a TS constructor-parameter-property) — fix for OPS-shared-21 part b', () => {
    const result = run(join(FIXTURES, "consumer-pass"), [], {
      KODEKRAFT_SHARED_TEST_LOCK_PATH: join(tmpdir(), "does-not-exist-lock.json"),
    });
    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).not.toContain("story-items.repository.ts");
    expect(output).not.toContain("invitations.repository.ts");
    expect(output).toContain("no violations found");
  });

  it("R4 still fails on a genuinely raw/differently-typed receiver even in a file that also legitimately uses the guarded DB type elsewhere — proves the part-b fix doesn't over-widen to the whole file", () => {
    const result = run(join(FIXTURES, "consumer-fail-r4-guarded-vs-raw"), [], {
      KODEKRAFT_SHARED_TEST_LOCK_PATH: join(tmpdir(), "does-not-exist-lock.json"),
    });
    expect(result.status).toBe(1);
    const output = result.stdout + result.stderr;
    const matches = [...output.matchAll(/repo\.ts:(\d+) — \[R4\]/g)];
    expect(matches).toHaveLength(1);
    const repoSource = readFileSync(join(FIXTURES, "consumer-fail-r4-guarded-vs-raw", "src", "repo.ts"), "utf8").split("\n");
    const flaggedLine = repoSource[Number(matches[0][1]) - 1];
    expect(flaggedLine).toContain("rawDb.prepare");
  });

  it("R4 still fails on a receiver typed with a LOCAL type alias that merely shares the composition root's type name (\"DB\") without being imported from it — proves the fix resolves import provenance, not just the name", () => {
    const result = run(join(FIXTURES, "consumer-fail-r4-local-type-collision"), [], {
      KODEKRAFT_SHARED_TEST_LOCK_PATH: join(tmpdir(), "does-not-exist-lock.json"),
    });
    expect(result.status).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/repo\.ts:\d+ — \[R4\]/);
  });

  it("R4 does NOT let a legitimately-guarded \"db: DB\" parameter in one function shield an unrelated, unannotated \"db\" parameter in a DIFFERENT function in the same file — regression for a real false negative found while building the part-b fix (per-declaration scoping, not per-file)", () => {
    const result = run(join(FIXTURES, "consumer-fail-r4-cross-function-leakage"), [], {
      KODEKRAFT_SHARED_TEST_LOCK_PATH: join(tmpdir(), "does-not-exist-lock.json"),
    });
    expect(result.status).toBe(1);
    const output = result.stdout + result.stderr;
    const matches = [...output.matchAll(/repo\.ts:(\d+) — \[R4\]/g)];
    expect(matches).toHaveLength(1);
    const repoSource = readFileSync(join(FIXTURES, "consumer-fail-r4-cross-function-leakage", "src", "repo.ts"), "utf8").split("\n");
    const flaggedLine = repoSource[Number(matches[0][1]) - 1];
    expect(flaggedLine).toContain("db.batch([])");
    // Specifically must be inside untypedBatch, not guarded — assert it's the FIRST occurrence.
    const untypedBatchLine = repoSource.findIndex((l) => l.includes("db.batch([])"));
    expect(Number(matches[0][1]) - 1).toBe(untypedBatchLine);
  });

  it("R5 fails when the schema mirror defines a table this app is neither a writer nor a reader of", () => {
    const result = run(join(FIXTURES, "consumer-fail-r5"));
    expect(result.status).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/schema\.ts:\d+ — \[R5\]/);
    expect(output).toContain('neither a writer nor a reader of "admins"');
  });
});

describe("check-ownership.mjs — R7 (migrations lock), dynamically built fixture", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function buildFixture() {
    dir = mkdtempSync(join(tmpdir(), "check-ownership-r7-"));
    mkdirSync(join(dir, "migrations"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "fixture-r7",
        kodekraft: {
          app: "worker-undangan",
          dbCompositionRoot: "src/db/client.ts",
          schemaMirror: "src/db/schema.ts",
          migrationsDir: "migrations",
        },
      }),
    );
    mkdirSync(join(dir, "src", "db"), { recursive: true });
    writeFileSync(join(dir, "src", "db", "client.ts"), "export const db = (env) => env.DB;\n");
    writeFileSync(join(dir, "src", "db", "schema.ts"), "// no tables\n");

    const migrationA = "CREATE TABLE a (id TEXT PRIMARY KEY);\n";
    const migrationB = "CREATE TABLE b (id TEXT PRIMARY KEY);\n";
    writeFileSync(join(dir, "migrations", "0001_a.sql"), migrationA);
    writeFileSync(join(dir, "migrations", "0002_b.sql"), migrationB);

    const lockPath = join(dir, "migrations.lock.json");
    writeFileSync(
      lockPath,
      JSON.stringify({
        "0001_a.sql": sha256(migrationA),
        "0002_b.sql": sha256(migrationB),
      }),
    );
    return { dir, lockPath, migrationA, migrationB };
  }

  it("passes when every migration file's sha256 matches migrations.lock.json", () => {
    const { dir: fixtureDir, lockPath } = buildFixture();
    const result = run(fixtureDir, [], { KODEKRAFT_SHARED_TEST_LOCK_PATH: lockPath });
    expect(result.status).toBe(0);
  });

  it("fails when a migration file's content drifts from its locked hash", () => {
    const { dir: fixtureDir, lockPath } = buildFixture();
    writeFileSync(join(fixtureDir, "migrations", "0001_a.sql"), "CREATE TABLE a (id TEXT PRIMARY KEY, extra TEXT);\n");
    const result = run(fixtureDir, [], { KODEKRAFT_SHARED_TEST_LOCK_PATH: lockPath });
    expect(result.status).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("sha256 mismatch");
    // Genuine content drift (not a line-ending artifact) must NOT get the CRLF hint below.
    expect(output).not.toContain("CRLF");
  });

  it("R7's mismatch message adds a CRLF-working-tree-artifact hint when the ONLY difference from the locked hash is CRLF vs. LF line endings — message-only, never changes pass/fail (OPS-shared-21 note on R7, not itself in scope for a behavior fix)", () => {
    const { dir: fixtureDir, lockPath, migrationA } = buildFixture();
    writeFileSync(join(fixtureDir, "migrations", "0001_a.sql"), migrationA.replace(/\n/g, "\r\n"));
    const result = run(fixtureDir, [], { KODEKRAFT_SHARED_TEST_LOCK_PATH: lockPath });
    expect(result.status).toBe(1); // still a violation — this is a message improvement only
    const output = result.stdout + result.stderr;
    expect(output).toContain("sha256 mismatch");
    expect(output).toContain("CRLF");
    expect(output).toContain("git show HEAD:<path>");
  });

  it("fails when a locked migration file is missing from migrationsDir", () => {
    const { dir: fixtureDir, lockPath } = buildFixture();
    rmSync(join(fixtureDir, "migrations", "0002_b.sql"));
    const result = run(fixtureDir, [], { KODEKRAFT_SHARED_TEST_LOCK_PATH: lockPath });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("missing — present in migrations.lock.json");
  });

  it("fails when a new migration file exists but isn't in migrations.lock.json", () => {
    const { dir: fixtureDir, lockPath } = buildFixture();
    writeFileSync(join(fixtureDir, "migrations", "0003_new.sql"), "CREATE TABLE c (id TEXT PRIMARY KEY);\n");
    const result = run(fixtureDir, [], { KODEKRAFT_SHARED_TEST_LOCK_PATH: lockPath });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("unexpected file — not present in migrations.lock.json");
  });

  it("SKIPS R7 (does not fail) when migrations.lock.json can't be resolved at all", () => {
    const result = run(join(FIXTURES, "consumer-pass"), [], { KODEKRAFT_SHARED_TEST_LOCK_PATH: join(tmpdir(), "does-not-exist-lock.json") });
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain("R7 SKIPPED");
  });
});

describe("check-ownership.mjs — own-repo mode (R1 exports map, R6 OWNERSHIP.md sync)", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** A minimal standalone copy of the package shape, so packageRoot === cwd triggers own-repo mode. */
  function buildOwnRepoCopy() {
    dir = mkdtempSync(join(tmpdir(), "check-ownership-own-"));
    mkdirSync(join(dir, "bin"), { recursive: true });
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "bin", "check-ownership.mjs"), readFileSync(BIN, "utf8"));
    writeFileSync(join(dir, "ownership.json"), readFileSync(join(PACKAGE_ROOT, "ownership.json"), "utf8"));
    writeFileSync(join(dir, "dist", "ownership.js"), "export {};\n");
    writeFileSync(join(dir, "dist", "ownership.d.ts"), "export {};\n");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "@kodekraft/shared",
        exports: {
          "./ownership": { types: "./dist/ownership.d.ts", import: "./dist/ownership.js" },
        },
      }),
    );
    return dir;
  }

  it("--fix generates OWNERSHIP.md, then a plain run passes cleanly", () => {
    const own = buildOwnRepoCopy();
    const fixResult = runOwn(own, ["--fix"]);
    expect(fixResult.status).toBe(0);
    expect(fixResult.stdout).toContain("regenerated OWNERSHIP.md");

    const checkResult = runOwn(own, []);
    expect(checkResult.status).toBe(0);
    expect(checkResult.stdout).toContain("no violations found");
  });

  it("R6 fails when OWNERSHIP.md is missing or stale relative to ownership.json", () => {
    const own = buildOwnRepoCopy();
    const result = runOwn(own, []);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/OWNERSHIP\.md:1 — \[R6\]/);
  });

  it("R1 fails when the exports map declares a root \".\" export", () => {
    const own = buildOwnRepoCopy();
    runOwn(own, ["--fix"]);
    writeFileSync(
      join(own, "package.json"),
      JSON.stringify({
        name: "@kodekraft/shared",
        exports: {
          ".": { types: "./dist/ownership.d.ts", import: "./dist/ownership.js" },
          "./ownership": { types: "./dist/ownership.d.ts", import: "./dist/ownership.js" },
        },
      }),
    );
    const result = runOwn(own, []);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/package\.json:\d+ — \[R1\]/);
    expect(result.stdout + result.stderr).toContain('declares a root "." export');
  });

  it("R1 fails when an exports target does not exist on disk", () => {
    const own = buildOwnRepoCopy();
    runOwn(own, ["--fix"]);
    writeFileSync(
      join(own, "package.json"),
      JSON.stringify({
        name: "@kodekraft/shared",
        exports: {
          "./ownership": { types: "./dist/ownership.d.ts", import: "./dist/ownership.js" },
          "./client": { types: "./dist/client.d.ts", import: "./dist/client.js" },
        },
      }),
    );
    const result = runOwn(own, []);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('exports["./client"] points at "./dist/client.js", which does not exist');
  });

  it("the real kodekraft-shared repo itself passes cleanly (proves OWNERSHIP.md is committed and up to date)", () => {
    const result = run(PACKAGE_ROOT, []);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no violations found");
  });
});
