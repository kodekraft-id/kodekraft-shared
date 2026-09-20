// Regression fixture for a real false negative found (and fixed) while building the R4
// guarded-receiver fix itself (OPS-shared-21 part b): an early version of the fix tracked
// guarded receiver names per FILE rather than per top-level function/class, so a legitimately
// guarded "db: DB" parameter in ONE function silently shielded an unrelated, genuinely-raw,
// same-named "db" parameter with NO type annotation in a DIFFERENT function in this same file.
// `untypedBatch` below must be flagged; `guarded` must not be — proving the fix is scoped
// per-declaration, not blanket per-file.
import type { DB } from "./db/client";

export function untypedBatch(db) {
  return db.batch([]);
}

export function guarded(db: DB) {
  return db.batch([]);
}
