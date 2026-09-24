// Real unit tests for the ownership matrix helpers (BE-mono-12), against the
// real ownership.json — not a fixture. See project-docs/12-cross-repo-integration-design.md
// §5.1/§5.4 and project-docs/03-architecture-design.md §1 for the source matrix.

import { describe, expect, it } from "vitest";
import { tablesFor, writableColumns, writersOf } from "../src/ownership.js";

describe("writersOf", () => {
  it("returns only worker-admin for a single-owner table (admins)", () => {
    expect(writersOf("admins")).toEqual(["worker-admin"]);
  });

  it("returns all three writers for a shared-write table (clients)", () => {
    expect(writersOf("clients")).toEqual(
      expect.arrayContaining(["worker-landing", "worker-user", "worker-admin"]),
    );
    expect(writersOf("clients")).toHaveLength(3);
  });

  it("throws for a table with no ownership.json entry (fails closed on an unknown table)", () => {
    expect(() => writersOf("not_a_real_table")).toThrow();
  });
});

describe("writableColumns", () => {
  // INVERTED 2026-09-24 by BE-mono-33. worker-user CLEARS both columns on
  // activation, which is the replay defence; the matrix had never granted them and
  // the violation was being logged and ignored in `warn` mode.
  //
  // **The grant is wider than the need and cannot be narrowed here.** ownership.json
  // is column-scoped: it can say "may write this column", never "may only write
  // NULL". Writing a REAL hash from worker-user would be an account-takeover
  // primitive. That value scope is enforced in the consuming repo instead —
  // `ClientPatch` types both fields as `null` (so a real hash does not compile) and
  // `invitation-worker-user/scripts/check-activation-writes.mjs` is the backstop for
  // raw SQL. This test records that division of responsibility, because a reader
  // finding the grant here should not conclude the column is unprotected.
  it("includes the activation columns in worker-user's clients allowlist", () => {
    const columns = writableColumns("clients", "worker-user");
    expect(columns).not.toBe("*");
    expect(columns).toContain("activation_token_hash");
    expect(columns).toContain("activation_expires_at");
  });

  it("gives worker-user the invitation CREATION columns — a creator that cannot write `id` cannot create", () => {
    const columns = writableColumns("invitations", "worker-user");
    for (const c of ["id", "client_id", "template_id", "slug", "created_at"]) {
      expect(columns, c).toContain(c);
    }
  });

  it("does include activation_token_hash in worker-landing's clients allowlist", () => {
    const columns = writableColumns("clients", "worker-landing");
    expect(columns).toContain("activation_token_hash");
  });

  it("assigns clients.deleted_at to worker-admin, not worker-user (ops-initiated deletion, not self-service)", () => {
    expect(writableColumns("clients", "worker-admin")).toContain("deleted_at");
    expect(writableColumns("clients", "worker-user")).not.toContain("deleted_at");
  });

  it("restricts worker-undangan to opened_at/opened_count only on guests", () => {
    expect(writableColumns("guests", "worker-undangan")).toEqual(["opened_at", "opened_count"]);
  });

  it("returns '*' for an unrestricted single-owner table", () => {
    expect(writableColumns("admins", "worker-admin")).toBe("*");
  });

  it("returns an empty array for an app that is not a writer of the table", () => {
    expect(writableColumns("admins", "worker-undangan")).toEqual([]);
  });
});

describe("tablesFor", () => {
  it("does NOT include clients/orders/admins in worker-undangan's writer tables", () => {
    const writerTables = tablesFor("worker-undangan", "writer");
    expect(writerTables).not.toContain("clients");
    expect(writerTables).not.toContain("orders");
    expect(writerTables).not.toContain("admins");
  });

  it("includes rsvp/wishes/gifts in worker-undangan's writer tables (guest submissions)", () => {
    const writerTables = tablesFor("worker-undangan", "writer");
    expect(writerTables).toEqual(expect.arrayContaining(["rsvp", "wishes", "gifts", "guests"]));
  });

  it("includes invitations and guests in worker-landing's reader tables (demo-slug/demo-guest-token resolution)", () => {
    const readerTables = tablesFor("worker-landing", "reader");
    expect(readerTables).toEqual(expect.arrayContaining(["invitations", "guests"]));
  });

  it("does NOT include worker-undangan as a clients reader (doc 12 §5.3 — removed, not granted)", () => {
    const readerTables = tablesFor("worker-undangan", "reader");
    expect(readerTables).not.toContain("clients");
  });

  it("includes photos in worker-admin's reader tables (media-retention cron, BE-admin-13)", () => {
    const readerTables = tablesFor("worker-admin", "reader");
    expect(readerTables).toContain("photos");
  });
});
