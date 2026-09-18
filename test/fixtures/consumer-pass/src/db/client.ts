// The ONE file in this fixture allowed to name env.DB (kodekraft.dbCompositionRoot).
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function db(env) {
  return drizzle(env.DB, { schema });
}

export function rawQuery(env) {
  return env.DB.prepare("select 1").all();
}
