import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// worker-undangan is a partial writer of "guests" (opened_at/opened_count only) and a
// reader of "invitations" per ownership.json — both are legitimate for this app.
export const guests = sqliteTable("guests", {
  id: text("id").primaryKey(),
  openedAt: integer("opened_at"),
});

export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
});
