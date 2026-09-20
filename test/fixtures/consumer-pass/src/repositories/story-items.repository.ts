// Regression fixture for the R4 guarded-receiver fix (OPS-shared-21 part b): a repository
// factory function whose parameter is typed as the composition root's own guarded return type
// ("Db", imported from ../db/client) must NOT be flagged, even though `db.batch(...)` matches
// the binding-shaped-word check on its own. Mirrors invitation-worker-user's real
// src/worker/modules/story-items/story-items.repository.ts:66 shape (that repo spells its alias
// "DB"; this fixture intentionally uses undangan's "Db" spelling to prove the check is
// name-agnostic).
import type { Db } from "../db/client";

export function createStoryItemsRepository(db: Db) {
  return {
    async create(value: string) {
      const [created] = await db.batch([db.insert(value)]);
      return created;
    },
  };
}
