// The ONE file in this fixture allowed to name env.DB (kodekraft.dbCompositionRoot).
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function db(env) {
  return drizzle(env.DB, { schema });
}

export function rawQuery(env) {
  return env.DB.prepare("select 1").all();
}

// Guarded return-type alias (OPS-shared-21 part b fixture) — deliberately spelled "Db", not
// "DB", to prove the guarded-receiver detection is name-agnostic (matches
// invitation-worker-undangan's real naming convention, which this fixture's
// kodekraft.app: "worker-undangan" mirrors; invitation-worker-user/-admin/-landing all spell it
// "DB" — see src/repositories/invitations.repository.ts for that spelling via an "as" alias).
export type Db = ReturnType<typeof db>;
