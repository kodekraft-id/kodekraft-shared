// QA-mono-15: tests for the enforcement layer itself (runtime guard + check-ownership.mjs),
// filling the gaps the per-module suites (guard.test.ts, check-ownership.test.ts) leave for the
// three acceptance scenarios: (a) matrix-specific guard verdicts for worker-undangan,
// (b) fail-closed on unparseable targets, (c) tamper/stale detection and the R4 test/** exemption.

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getDb, type D1DatabaseLike, type D1PreparedStatementLike } from "../src/client.js";
import { OwnershipViolationError } from "../src/guard.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PACKAGE_ROOT, "bin", "check-ownership.mjs");

function fakeBinding(): { db: D1DatabaseLike; prepared: string[] } {
  const prepared: string[] = [];
  const statement = (): D1PreparedStatementLike => ({
    bind: () => statement(),
    first: async () => null,
    run: async () => ({ success: true }),
    all: async () => ({ results: [] }),
    raw: async () => [],
  });
  const db: D1DatabaseLike = {
    prepare(query: string) {
      prepared.push(query);
      return statement();
    },
    async batch(statements: D1PreparedStatementLike[]) {
      return statements.map(() => ({ success: true }));
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
  };
  return { db, prepared };
}

describe("QA-mono-15(a): runtime guard verdicts for worker-undangan", () => {
  it("rejects a write to clients", () => {
    const { db, prepared } = fakeBinding();
    const guarded = getDb(db, "worker-undangan");
    expect(() => guarded.prepare(`update "clients" set "name" = ? where "id" = ?`)).toThrow(OwnershipViolationError);
    expect(prepared).toEqual([]);
  });

  it("rejects a write to guests.name (a column worker-undangan does not own)", () => {
    const { db, prepared } = fakeBinding();
    const guarded = getDb(db, "worker-undangan");
    expect(() => guarded.prepare(`update "guests" set "name" = ? where "id" = ?`)).toThrow(OwnershipViolationError);
    expect(prepared).toEqual([]);
  });

  it("rejects a mixed update touching one owned and one unowned guests column", () => {
    const { db } = fakeBinding();
    const guarded = getDb(db, "worker-undangan");
    expect(() =>
      guarded.prepare(`update "guests" set "opened_count" = "opened_count" + 1, "name" = ? where "id" = ?`),
    ).toThrow(OwnershipViolationError);
  });

  it("allows a write to guests.opened_count and reaches the binding", () => {
    const { db, prepared } = fakeBinding();
    const guarded = getDb(db, "worker-undangan");
    const sql = `update "guests" set "opened_count" = "opened_count" + 1, "opened_at" = ? where "id" = ?`;
    expect(() => guarded.prepare(sql)).not.toThrow();
    expect(prepared).toEqual([sql]);
  });
});

describe("QA-mono-15(b): runtime guard fails closed on an unparseable write target", () => {
  it.each([
    ["REPLACE INTO", `replace into "guests" ("id") values (?)`],
    ["a statement with no recognizable target", `update set "opened_count" = 1`],
    ["a DDL statement", `drop table "guests"`],
  ])("throws for %s", (_label, sql) => {
    const { db, prepared } = fakeBinding();
    const guarded = getDb(db, "worker-undangan");
    expect(() => guarded.prepare(sql)).toThrow(OwnershipViolationError);
    expect(prepared).toEqual([]);
  });
});

describe("QA-mono-15(c): check-ownership.mjs tamper and exemption detection", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function run(cwd: string, script: string, args: string[] = [], env: Record<string, string> = {}) {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    return { status: result.status ?? 1, output: (result.stdout ?? "") + (result.stderr ?? "") };
  }

  /** Own-repo copy (script root === cwd), with a freshly generated OWNERSHIP.md. */
  function buildFreshOwnRepo() {
    dir = mkdtempSync(join(tmpdir(), "qa-mono-15-own-"));
    mkdirSync(join(dir, "bin"));
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "bin", "check-ownership.mjs"), readFileSync(BIN, "utf8"));
    writeFileSync(join(dir, "ownership.json"), readFileSync(join(PACKAGE_ROOT, "ownership.json"), "utf8"));
    writeFileSync(join(dir, "dist", "ownership.js"), "export {};\n");
    writeFileSync(join(dir, "dist", "ownership.d.ts"), "export {};\n");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "@kodekraft/shared",
        exports: { "./ownership": { types: "./dist/ownership.d.ts", import: "./dist/ownership.js" } },
      }),
    );
    const script = join(dir, "bin", "check-ownership.mjs");
    expect(run(dir, script, ["--fix"]).status).toBe(0);
    expect(run(dir, script).status).toBe(0);
    return { own: dir, script };
  }

  /** Minimal consumer fixture for worker-undangan; returns its root. */
  function buildConsumer(prefix: string) {
    const root = mkdtempSync(join(tmpdir(), prefix));
    mkdirSync(join(root, "src", "db"), { recursive: true });
    writeFileSync(join(root, "src", "db", "client.ts"), "export const raw = (env) => env.DB;\n");
    writeFileSync(join(root, "src", "db", "schema.ts"), "// no tables\n");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "fixture",
        kodekraft: {
          app: "worker-undangan",
          dbCompositionRoot: "src/db/client.ts",
          schemaMirror: "src/db/schema.ts",
          migrationsDir: "migrations",
        },
      }),
    );
    return root;
  }

  it("R6 fails when ownership.json is hand-edited after OWNERSHIP.md was generated", () => {
    const { own, script } = buildFreshOwnRepo();
    const matrix = JSON.parse(readFileSync(join(own, "ownership.json"), "utf8"));
    matrix.tables.guests.writers["worker-undangan"].push("name"); // the widening this layer must catch
    writeFileSync(join(own, "ownership.json"), JSON.stringify(matrix, null, 2));

    const result = run(own, script);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/OWNERSHIP\.md:1 — \[R6\] is stale/);
  });

  it("R6 fails when OWNERSHIP.md is hand-edited away from ownership.json", () => {
    const { own, script } = buildFreshOwnRepo();
    const mdPath = join(own, "OWNERSHIP.md");
    writeFileSync(mdPath, readFileSync(mdPath, "utf8").replace("opened_count", "opened_count, name"));

    const result = run(own, script);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/\[R6\]/);
  });

  it("R7 fails on a deliberately tampered migration file, and passes again once restored", () => {
    dir = buildConsumer("qa-mono-15-r7-");
    const original = "CREATE TABLE t (id TEXT PRIMARY KEY);\n";
    mkdirSync(join(dir, "migrations"));
    writeFileSync(join(dir, "migrations", "0001_t.sql"), original);
    const lockPath = join(dir, "lock.json");
    writeFileSync(lockPath, JSON.stringify({ "0001_t.sql": createHash("sha256").update(original).digest("hex") }));
    const env = { KODEKRAFT_SHARED_TEST_LOCK_PATH: lockPath };

    expect(run(dir, BIN, [], env).status).toBe(0);
    writeFileSync(join(dir, "migrations", "0001_t.sql"), original + "-- tampered\n");
    const tampered = run(dir, BIN, [], env);
    expect(tampered.status).toBe(1);
    expect(tampered.output).toMatch(/0001_t\.sql:1 — \[R7\] sha256 mismatch/);
    writeFileSync(join(dir, "migrations", "0001_t.sql"), original);
    expect(run(dir, BIN, [], env).status).toBe(0);
  });

  it("R4 exempts a test/** spy on env.DB.prepare() but still flags the same code under src/", () => {
    dir = buildConsumer("qa-mono-15-r4-");
    mkdirSync(join(dir, "test"));
    const spy = "const spy = vi.spyOn(env.DB, 'prepare');\nenv.DB.prepare('select 1');\n";
    writeFileSync(join(dir, "test", "gate-ordering.test.ts"), spy);
    const env = { KODEKRAFT_SHARED_TEST_LOCK_PATH: join(dir, "absent-lock.json") };

    expect(run(dir, BIN, [], env).status).toBe(0);

    writeFileSync(join(dir, "src", "leak.ts"), spy);
    const leaked = run(dir, BIN, [], env);
    expect(leaked.status).toBe(1);
    expect(leaked.output).toContain("src/leak.ts:");
    expect(leaked.output).not.toContain("gate-ordering.test.ts");
  });
});

describe("BE-mono-22: worker-admin provisioning writes", () => {
  const admin = () => {
    const { db, prepared } = fakeBinding();
    return { guarded: getDb(db, "worker-admin"), prepared };
  };

  it("allows the clients INSERT of POST /api/clients", () => {
    const { guarded } = admin();
    expect(() =>
      guarded.prepare(`insert into "clients" ("id", "name", "email", "phone", "password_hash", "created_at") values (?, ?, ?, ?, ?, ?)`),
    ).not.toThrow();
  });

  it("allows the invitations INSERT of POST /api/invitations", () => {
    const { guarded } = admin();
    expect(() =>
      guarded.prepare(
        `insert into "invitations" ("id", "client_id", "template_id", "slug", "event_type", "title", "status", "created_at", "updated_at") values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
    ).not.toThrow();
  });

  it("allows the sections seed INSERT and the addons settings UPDATE", () => {
    const { guarded } = admin();
    expect(() => guarded.prepare(`insert into "sections" ("id", "invitation_id", "type", "sort_order") values (?, ?, ?, ?)`)).not.toThrow();
    expect(() => guarded.prepare(`update "invitations" set "settings" = ?, "updated_at" = ? where "id" = ?`)).not.toThrow();
  });

  it("still rejects clients.token_version / activation_token_hash and invitation content columns", () => {
    const { guarded, prepared } = admin();
    expect(() => guarded.prepare(`update "clients" set "token_version" = ? where "id" = ?`)).toThrow(OwnershipViolationError);
    expect(() => guarded.prepare(`update "clients" set "activation_token_hash" = ? where "id" = ?`)).toThrow(OwnershipViolationError);
    expect(() => guarded.prepare(`update "invitations" set "story" = ? where "id" = ?`)).toThrow(OwnershipViolationError);
    expect(prepared).toEqual([]);
  });

  it("still rejects writes to other apps' tables", () => {
    const { guarded } = admin();
    expect(() => guarded.prepare(`update "orders" set "status" = ? where "id" = ?`)).toThrow(OwnershipViolationError);
    expect(() => guarded.prepare(`insert into "guests" ("id") values (?)`)).toThrow(OwnershipViolationError);
  });
});
