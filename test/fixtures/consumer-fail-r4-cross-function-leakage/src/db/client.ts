// The ONE file in this fixture allowed to name env.DB (kodekraft.dbCompositionRoot).
export function getDb(env) {
  return env.DB;
}
export type DB = ReturnType<typeof getDb>;
