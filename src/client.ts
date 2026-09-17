// PLACEHOLDER MODULE — scaffolded by OPS-shared-01.
//
// The real implementation lands in BE-mono-13: `getDb(binding, app)` wraps the D1
// binding in `guard.ts`'s `createGuard()` so every statement Drizzle emits over the
// returned handle is checked against `ownership.json` at write time. Reads pass through
// untouched; writes to a table/column this app doesn't own throw
// `OwnershipViolationError`. See project-docs/12 §5.4.
//
// This stub exists only so the package's exports map (`./client`), build pipeline, and
// CI have a real module to compile, bundle, and test end-to-end during v0.1 scaffolding.
// It currently does NOT enforce anything — do not wire this into a real Worker yet.

/** Placeholder stand-in for the real D1 binding type until BE-mono-13 lands. */
export type PlaceholderD1Binding = unknown;

/**
 * Placeholder stub for the real `getDb(binding, app)` guard wrapper (BE-mono-13).
 * Currently just returns the binding unchanged — this is NOT a real ownership guard.
 */
export function getDb(binding: PlaceholderD1Binding, _app: string): PlaceholderD1Binding {
  return binding;
}
