// Regression fixture for the R4 guarded-receiver fix (OPS-shared-21 part b): a TS
// constructor-parameter-property typed as the composition root's own guarded return type must
// NOT be flagged. Mirrors invitation-worker-admin's real
// src/worker/repositories/invitations.repository.ts:80 shape exactly, including its "DB"
// spelling — obtained here via an "as" import alias of this fixture's "Db" (also exercises the
// aliased-named-import path of the fix, not just a bare import).
import type { Db as DB } from "../db/client";

export class InvitationsRepository {
  constructor(private readonly db: DB) {}

  async insertSections(rows: unknown[]): Promise<void> {
    const stmts = rows.map((row) => this.db.insert(row));
    await this.db.batch(stmts);
  }
}
