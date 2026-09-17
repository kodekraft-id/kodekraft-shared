// PLACEHOLDER MODULE — scaffolded by OPS-shared-01.
//
// The real implementation lands in BE-mono-13: `createGuard()`, a Proxy over a D1
// binding's `prepare`/`batch`/`exec` that checks each write's target table (and, for
// writeColumns tables, its SET columns) against `ownership.json`, throwing
// `OwnershipViolationError` on a violation. Fails closed on an unparseable write target.
// See project-docs/12 §5.4.
//
// This module is NOT part of the package's narrow exports map (only `./client` is
// exported per doc 12 §5.4) — it is consumed internally by `client.ts`'s real `getDb`
// once BE-mono-13 lands. This stub exists only so the file is present for that task to
// fill in, matching the layout described in doc 12 §5.4.

/** Placeholder for the real `createGuard()` factory (BE-mono-13). Currently a no-op passthrough. */
export function createGuard<TBinding>(binding: TBinding): TBinding {
  return binding;
}
