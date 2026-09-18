import { sqliteTable, text } from "drizzle-orm/sqlite-core";

// R5 violation: worker-undangan is neither a writer nor a reader of "admins" per
// ownership.json (doc 12 §5.3's exact "must not define admins at all" scenario).
export const admins = sqliteTable("admins", {
  id: text("id").primaryKey(),
});
