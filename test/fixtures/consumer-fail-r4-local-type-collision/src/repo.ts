// Proves the R4 guarded-receiver fix (OPS-shared-21 part b) resolves an import back to the
// declared composition root FILE, not just a same-spelled type name — otherwise the whole rule
// would be trivially defeated by any local "type DB" alias. This "DB" is declared locally, NOT
// imported from ./db/client, so it must still be flagged exactly like any other raw-shaped call.
type DB = { prepare: (sql: string) => unknown };

export function stillRaw(db: DB) {
  return db.prepare("select 1");
}
