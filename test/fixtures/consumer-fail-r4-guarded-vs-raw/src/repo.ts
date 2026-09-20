// Proves the R4 guarded-receiver fix (OPS-shared-21 part b) does not over-widen: a file that
// legitimately uses the composition root's guarded "DB" type in one function must still have a
// genuinely raw, differently-typed receiver flagged in a DIFFERENT function in the SAME file —
// using the guarded type elsewhere in a file must not blanket-suppress every "db"-shaped call in
// it. See also consumer-fail-r4-local-type-collision for the import-provenance half of this same
// proof.
import type { DB } from "./db/client";

export function safe(db: DB) {
  return db.batch([]);
}

export function dangerous(rawDb: D1Database) {
  return rawDb.prepare("select 1").run();
}
