// R4 violation via the METHOD-CALL branch specifically: a binding-shaped receiver ("db",
// "ctx.dbBinding") calling .batch()/.prepare() outside kodekraft.dbCompositionRoot, without the
// line literally containing the substring "env.DB" (which the R4_BINDING_ACCESS_RE branch would
// already catch on its own). Proves the receiver-chain word check still catches real violations
// after the false-positive fix, not just the exact "env.DB" shape.
export async function handleSync(db, statements) {
  return db.batch(statements);
}

export function directPrepare(ctx) {
  return ctx.dbBinding.prepare("select 1").run();
}
