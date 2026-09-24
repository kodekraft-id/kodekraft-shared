// Real unit tests for the D1 write guard (BE-mono-13): `guard.ts`'s SQL classification
// against the real `ownership.json`, and `client.ts`'s `getDb()` Proxy wired over a fake
// (not real D1/Miniflare) binding. See project-docs/12-cross-repo-integration-design.md §5.4.

import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyStatement, OwnershipViolationError } from "../src/guard.js";
import { getDb, type D1DatabaseLike, type D1PreparedStatementLike } from "../src/client.js";

// ---------------------------------------------------------------------------------------
// Fake D1 binding — records every query handed to prepare()/exec(), and returns plausible
// D1-shaped results from batch()/run()/all()/first() without touching a real database.
// ---------------------------------------------------------------------------------------

interface FakeD1 {
  readonly db: D1DatabaseLike;
  readonly preparedQueries: string[];
  readonly execQueries: string[];
}

function makeFakeStatement(sql: string): D1PreparedStatementLike {
  return {
    bind: (..._values: unknown[]) => makeFakeStatement(sql),
    first: async () => null,
    run: async () => ({ success: true }),
    all: async () => ({ results: [] }),
    raw: async () => [],
  };
}

function createFakeD1(): FakeD1 {
  const preparedQueries: string[] = [];
  const execQueries: string[] = [];

  const db: D1DatabaseLike = {
    prepare(query: string) {
      preparedQueries.push(query);
      return makeFakeStatement(query);
    },
    async batch(statements: D1PreparedStatementLike[]) {
      return statements.map(() => ({ success: true }));
    },
    async exec(query: string) {
      execQueries.push(query);
      return { count: splitLines(query).length, duration: 0 };
    },
  };

  return { db, preparedQueries, execQueries };
}

function splitLines(query: string): string[] {
  return query
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------------------
// classifyStatement — the SQL-parsing core, tested in isolation from the ownership matrix.
// ---------------------------------------------------------------------------------------

describe("classifyStatement", () => {
  it("classifies a SELECT as a read", () => {
    expect(classifyStatement(`select "id" from "clients" where "id" = ?`)).toEqual({ kind: "read" });
  });

  it("classifies an INSERT and extracts its table + column list", () => {
    const result = classifyStatement(`insert into "invitations" ("id", "client_id", "title") values (?, ?, ?)`);
    expect(result).toEqual({
      kind: "write",
      target: { verb: "insert", table: "invitations", columns: ["id", "client_id", "title"] },
    });
  });

  it("classifies an UPDATE and extracts its table + SET columns, stopping at WHERE", () => {
    const result = classifyStatement(`update "clients" set "password_hash" = ?, "updated_at" = ? where "id" = ?`);
    expect(result).toEqual({
      kind: "write",
      target: { verb: "update", table: "clients", columns: ["password_hash", "updated_at"] },
    });
  });

  it("classifies a DELETE and extracts its table, with no columns", () => {
    const result = classifyStatement(`delete from "guests" where "id" = ?`);
    expect(result).toEqual({ kind: "write", target: { verb: "delete", table: "guests", columns: [] } });
  });

  it("unions an INSERT's column list with its ON CONFLICT DO UPDATE SET columns", () => {
    const result = classifyStatement(
      `insert into "invitations" ("id", "package_tier") values (?, ?) on conflict ("id") do update set "package_tier" = excluded."package_tier"`,
    );
    expect(result.kind).toBe("write");
    if (result.kind === "write") {
      expect(result.target.columns).toEqual(expect.arrayContaining(["id", "package_tier"]));
    }
  });

  it("does not mistake a comma inside a function call for a SET column boundary", () => {
    const result = classifyStatement(`update "guests" set "opened_at" = strftime('%s','now') where "id" = ?`);
    expect(result).toEqual({
      kind: "write",
      target: { verb: "update", table: "guests", columns: ["opened_at"] },
    });
  });

  it("fails closed (unparseable) on a non-SELECT statement that doesn't match a recognized write shape", () => {
    expect(classifyStatement(`replace into "orders" ("id") values (?)`)).toEqual({ kind: "unparseable" });
    expect(classifyStatement(`pragma foreign_keys = on`)).toEqual({ kind: "unparseable" });
  });
});

// ---------------------------------------------------------------------------------------
// getDb() — the Proxy wrapper, exercised through prepare()/batch()/exec() with a fake D1.
// ---------------------------------------------------------------------------------------

describe("getDb", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lets a write to an owned table/column proceed and reach the real binding", () => {
    const { db, preparedQueries } = createFakeD1();
    const guarded = getDb(db, "worker-landing");

    const sql = `insert into "orders" ("id", "amount") values (?, ?)`;
    expect(() => guarded.prepare(sql)).not.toThrow();
    expect(preparedQueries).toEqual([sql]);
  });

  it("throws OwnershipViolationError (default throw mode) for a write to a table the app doesn't own", () => {
    const { db } = createFakeD1();
    const guarded = getDb(db, "worker-undangan");

    expect(() => guarded.prepare(`insert into "clients" ("id", "name") values (?, ?)`)).toThrow(
      OwnershipViolationError,
    );
  });

  it("in warn mode, logs the same violation via console.error but lets the statement proceed", () => {
    const { db, preparedQueries } = createFakeD1();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const guarded = getDb(db, "worker-undangan", { mode: "warn" });

    const sql = `insert into "clients" ("id", "name") values (?, ?)`;
    expect(() => guarded.prepare(sql)).not.toThrow();
    expect(preparedQueries).toEqual([sql]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "db.ownership.violation", table: "clients", app: "worker-undangan" }),
    );
  });

  // INVERTED 2026-09-24 by BE-mono-33, and the inversion is the point of the entry.
  // This used to assert that worker-user could NOT write activation_token_hash. It
  // could not — and it was doing it anyway, on every activation, because that Worker
  // runs the guard in `warn` mode, which logs the violation and runs the statement.
  // Clearing the token IS the replay defence; without the grant, activation cannot
  // consume its own token. The code was right and the matrix was incomplete.
  it("lets worker-user CLEAR the activation columns — that clear is the replay defence", () => {
    const { db } = createFakeD1();
    const guarded = getDb(db, "worker-user");

    expect(() =>
      guarded.prepare(`update "clients" set "activation_token_hash" = ?, "updated_at" = ? where "id" = ?`),
    ).not.toThrow();
  });

  it("still refuses worker-user on a clients column it genuinely does not own", () => {
    // The pairing matters: a widening is only safe if the guard still bites
    // somewhere on the same table. `deleted_at` is worker-admin's — account deletion
    // is ops-initiated, never self-service.
    const { db } = createFakeD1();
    const guarded = getDb(db, "worker-user");

    expect(() =>
      guarded.prepare(`update "clients" set "deleted_at" = ? where "id" = ?`),
    ).toThrow(OwnershipViolationError);
  });

  it("lets worker-user write clients columns that ARE in its allowlist", () => {
    const { db } = createFakeD1();
    const guarded = getDb(db, "worker-user");

    expect(() =>
      guarded.prepare(`update "clients" set "name" = ?, "updated_at" = ? where "id" = ?`),
    ).not.toThrow();
  });

  it("passes reads through untouched regardless of app or mode", () => {
    const { db: db1 } = createFakeD1();
    const guardedThrowMode = getDb(db1, "worker-undangan", { mode: "throw" });
    expect(() => guardedThrowMode.prepare(`select * from "clients" where "id" = ?`)).not.toThrow();

    const { db: db2 } = createFakeD1();
    const guardedWarnMode = getDb(db2, "worker-undangan", { mode: "warn" });
    expect(() => guardedWarnMode.prepare(`select * from "clients" where "id" = ?`)).not.toThrow();
  });

  it("fails closed on an unparseable write even against a table the app does own", () => {
    const { db } = createFakeD1();
    const guarded = getDb(db, "worker-landing");

    expect(() => guarded.prepare(`replace into "orders" ("id") values (?)`)).toThrow(OwnershipViolationError);
  });

  it("lets a batch() of statements built via this guarded prepare() proceed when all are allowed", async () => {
    const { db } = createFakeD1();
    const guarded = getDb(db, "worker-landing");

    const first = guarded.prepare(`insert into "orders" ("id") values (?)`).bind("order-1");
    const second = guarded.prepare(`insert into "order_status_log" ("id") values (?)`).bind("log-1");
    await expect(guarded.batch([first, second])).resolves.toBeDefined();
  });

  it("in warn mode, a violating statement built via prepare() still only logs when reaching batch()", async () => {
    const { db } = createFakeD1();
    const warnGuarded = getDb(db, "worker-undangan", { mode: "warn" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const violating = warnGuarded.prepare(`insert into "clients" ("id") values (?)`);

    await expect(warnGuarded.batch([violating])).resolves.toBeDefined();
    // Once at prepare()-time and once again is NOT expected here — batch() trusts the
    // per-statement check already done at prepare()-time via the sqlByStatement lookup, it
    // does not re-run guardWrite. One log call, from prepare().
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("fails closed in batch() for a statement not created via this guarded prepare()", () => {
    const { db } = createFakeD1();
    const guarded = getDb(db, "worker-landing");
    const untrackedStatement = makeFakeStatement(`insert into "orders" ("id") values (?)`);

    expect(() => guarded.batch([untrackedStatement])).toThrow(OwnershipViolationError);
  });

  it("guards each line of an exec() call independently", async () => {
    const { db: okDb } = createFakeD1();
    const guardedOk = getDb(okDb, "worker-landing");
    await expect(guardedOk.exec(`insert into "orders" ("id") values (1)\nselect 1`)).resolves.toBeDefined();

    const { db: badDb } = createFakeD1();
    const guardedBad = getDb(badDb, "worker-undangan");
    // guardWrite runs synchronously before exec() ever returns a Promise, so the violation
    // surfaces as a synchronous throw, not a rejected Promise.
    expect(() => guardedBad.exec(`insert into "orders" ("id") values (1)`)).toThrow(OwnershipViolationError);
  });
});
