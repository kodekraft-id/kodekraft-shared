// Regression fixture for the R4 false-positive fix (OPS-shared-21, v0.1.2): a doc comment that
// merely MENTIONS env.DB / .batch() / .prepare() / .exec() in prose must not register as a real
// call outside kodekraft.dbCompositionRoot. Reproduces the exact shape found in worker-landing's
// src/lib/provision.ts: "dalam SATU db.batch (atomik)" and "breaking the atomicity of that
// db.prepare() batch" inside header/JSDoc-style comments, with no real D1 access anywhere below.
/**
 * Also covers a block comment mentioning env.DB directly and ctx.dbBinding.exec(...) in prose,
 * to prove both comment styles (line and block) are stripped before matching.
 */
export function doesNothingWithD1(value: number): number {
  return value * 2;
}
