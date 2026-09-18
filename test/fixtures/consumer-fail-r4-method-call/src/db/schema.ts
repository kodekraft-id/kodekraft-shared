import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const guests = sqliteTable("guests", {
  id: text("id").primaryKey(),
});
