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

describe("BE-mono-24: invitations.purchased_addons ownership", () => {
  const as = (app: "worker-landing" | "worker-user" | "worker-admin" | "worker-undangan") => {
    const { db, prepared } = fakeBinding();
    return { guarded: getDb(db, app), prepared };
  };
  const setAddons = `update "invitations" set "purchased_addons" = ?, "updated_at" = ? where "id" = ?`;

  it("allows worker-landing to insert an invitation with purchased_addons (provisioning)", () => {
    const { guarded } = as("worker-landing");
    expect(() =>
      guarded.prepare(`insert into "invitations" ("id", "client_id", "package_tier", "purchased_addons") values (?, ?, ?, ?)`),
    ).not.toThrow();
  });

  it("allows worker-admin to update purchased_addons (PATCH /invitations/:id/addons)", () => {
    const { guarded } = as("worker-admin");
    expect(() => guarded.prepare(setAddons)).not.toThrow();
  });

  it("rejects worker-user writing purchased_addons (read-only for it), failing closed before the binding", () => {
    const { guarded, prepared } = as("worker-user");
    expect(() => guarded.prepare(setAddons)).toThrow(OwnershipViolationError);
    expect(() =>
      guarded.prepare(`insert into "invitations" ("id", "purchased_addons") values (?, ?)`),
    ).toThrow(OwnershipViolationError);
    expect(prepared).toEqual([]);
  });

  it("rejects worker-undangan writing purchased_addons", () => {
    const { guarded, prepared } = as("worker-undangan");
    expect(() => guarded.prepare(setAddons)).toThrow(OwnershipViolationError);
    expect(prepared).toEqual([]);
  });

  it("does not widen anything else: admin still cannot write content columns alongside purchased_addons", () => {
    const { guarded } = as("worker-admin");
    expect(() =>
      guarded.prepare(`update "invitations" set "purchased_addons" = ?, "story" = ? where "id" = ?`),
    ).toThrow(OwnershipViolationError);
  });

  it("matrix: exactly landing and admin gained the column; user does not have it", async () => {
    const { writableColumns } = await import("../src/ownership.js");
    expect(writableColumns("invitations", "worker-landing")).toContain("purchased_addons");
    expect(writableColumns("invitations", "worker-admin")).toContain("purchased_addons");
    expect(writableColumns("invitations", "worker-user")).not.toContain("purchased_addons");
    expect(writableColumns("invitations", "worker-undangan")).toEqual([]);
  });
});

describe("BE-mono-25: invitation_domains grants", () => {
  const as = (app: "worker-landing" | "worker-user" | "worker-admin" | "worker-undangan") => {
    const { db, prepared } = fakeBinding();
    return { guarded: getDb(db, app), prepared };
  };

  it("allows worker-landing's provisioning INSERT ... ON CONFLICT(domain) DO NOTHING", () => {
    const { guarded } = as("worker-landing");
    expect(() =>
      guarded.prepare(
        `insert into "invitation_domains" ("id", "invitation_id", "domain", "kind", "status", "requested_at", "order_id", "price_idr", "term_months") values (?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict ("domain") do nothing`,
      ),
    ).not.toThrow();
  });

  it("rejects worker-landing writing staff/lifecycle columns (provider_ref, verified_at, registered_at, expires_at, removed_reason)", () => {
    const { guarded, prepared } = as("worker-landing");
    for (const column of ["provider_ref", "verification_details", "verified_at", "registered_at", "expires_at", "removed_reason"]) {
      expect(() => guarded.prepare(`update "invitation_domains" set "${column}" = ? where "id" = ?`)).toThrow(OwnershipViolationError);
    }
    expect(() =>
      guarded.prepare(`insert into "invitation_domains" ("id", "domain", "provider_ref") values (?, ?, ?)`),
    ).toThrow(OwnershipViolationError);
    expect(prepared).toEqual([]);
  });

  it("allows worker-admin to UPDATE the domain column (staff renames to an agreed alternative) and the new lifecycle columns", () => {
    const { guarded } = as("worker-admin");
    expect(() => guarded.prepare(`update "invitation_domains" set "domain" = ?, "updated_at" = ? where "id" = ?`)).not.toThrow();
    expect(() =>
      guarded.prepare(`update "invitation_domains" set "registered_at" = ?, "expires_at" = ?, "removed_reason" = ? where "id" = ?`),
    ).not.toThrow();
  });

  it("keeps worker-user's insert/request access and rejects worker-undangan (read-only)", () => {
    expect(() => as("worker-user").guarded.prepare(`insert into "invitation_domains" ("id", "invitation_id", "domain") values (?, ?, ?)`)).not.toThrow();
    const { guarded, prepared } = as("worker-undangan");
    expect(() => guarded.prepare(`update "invitation_domains" set "status" = ? where "id" = ?`)).toThrow(OwnershipViolationError);
    expect(() => guarded.prepare(`insert into "invitation_domains" ("id") values (?)`)).toThrow(OwnershipViolationError);
    expect(prepared).toEqual([]);
  });
});

describe("BE-mono-26: order_refunds grants", () => {
  const as = (app: "worker-landing" | "worker-user" | "worker-admin" | "worker-undangan") => {
    const { db, prepared } = fakeBinding();
    return { guarded: getDb(db, app), prepared };
  };

  it("allows worker-admin INSERT and UPDATE on any order_refunds column", () => {
    const { guarded } = as("worker-admin");
    expect(() =>
      guarded.prepare(`insert into "order_refunds" ("id", "order_id", "status", "reason", "method", "due_at") values (?, ?, ?, ?, ?, ?)`),
    ).not.toThrow();
    expect(() =>
      guarded.prepare(`update "order_refunds" set "status" = ?, "buyer_confirmed_at" = ?, "completed_at" = ? where "id" = ?`),
    ).not.toThrow();
  });

  it("rejects every write from worker-landing, worker-user and worker-undangan (fail closed, nothing reaches the binding)", () => {
    for (const app of ["worker-landing", "worker-user", "worker-undangan"] as const) {
      const { guarded, prepared } = as(app);
      expect(() => guarded.prepare(`insert into "order_refunds" ("id", "order_id") values (?, ?)`)).toThrow(OwnershipViolationError);
      expect(() => guarded.prepare(`update "order_refunds" set "status" = ? where "id" = ?`)).toThrow(OwnershipViolationError);
      expect(() => guarded.prepare(`delete from "order_refunds" where "id" = ?`)).toThrow(OwnershipViolationError);
      expect(prepared).toEqual([]);
    }
  });

  it("allows worker-landing to READ order_refunds (SELECT passes; matrix reader ceiling) but not other apps", async () => {
    const { guarded } = as("worker-landing");
    expect(() => guarded.prepare(`select * from "order_refunds" where "order_id" = ?`)).not.toThrow();
    const { tablesFor, writersOf } = await import("../src/ownership.js");
    expect(tablesFor("worker-landing", "reader")).toContain("order_refunds");
    expect(tablesFor("worker-user", "reader")).not.toContain("order_refunds");
    expect(tablesFor("worker-undangan", "reader")).not.toContain("order_refunds");
    expect(writersOf("order_refunds")).toEqual(["worker-admin"]);
  });
});

describe("0.6.0: invitations.is_demo and events read grant", () => {
  const apps = ["worker-landing", "worker-user", "worker-admin", "worker-undangan"] as const;

  it("no app may write invitations.is_demo (ops SQL only)", async () => {
    const { writableColumns } = await import("../src/ownership.js");
    for (const app of apps) expect(writableColumns("invitations", app)).not.toContain("is_demo");
    for (const app of apps) {
      const { db } = fakeBinding();
      expect(() => getDb(db, app).prepare(`update "invitations" set "is_demo" = ? where "id" = ?`)).toThrow(OwnershipViolationError);
    }
  });

  it("all four apps can read invitations", async () => {
    const { ownershipMatrix: ownership } = await import("../src/ownership.js");
    const inv = ownership.tables.invitations;
    for (const app of apps) {
      expect(app in inv.writers || inv.readers.includes(app)).toBe(true);
    }
  });

  it("worker-admin can read events but not write it", async () => {
    const { ownershipMatrix: ownership, writableColumns } = await import("../src/ownership.js");
    expect(ownership.tables.events.readers).toContain("worker-admin");
    expect(writableColumns("events", "worker-admin")).toEqual([]);
    const { db } = fakeBinding();
    expect(() => getDb(db, "worker-admin").prepare(`update "events" set "title" = ? where "id" = ?`)).toThrow(OwnershipViolationError);
  });
});
