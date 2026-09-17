// PLACEHOLDER MODULE — scaffolded by OPS-shared-01.
//
// The real implementation lands in BE-mono-10: doc 11 (`11-tier-capability-design.md`)
// §1's tier capability map (`TIER_CAPABILITIES`, `getEffectivePhotoCap`, `hasFeature`,
// `computeExpiresAt`) — pure values and predicates only. `assertFeature` is deliberately
// NOT exported from this package (project-docs/12 §5.2): each consuming repo writes its
// own 3-liner throwing its own `HttpError`, since the response envelope stays per-repo.
//
// This stub exists only so the package's exports map (`./tier`), build pipeline, and CI
// have a real module to compile, bundle, and test end-to-end during v0.1 scaffolding.
/** Placeholder export confirming the `./tier` module resolves. Replaced by BE-mono-10. */
export const tierStub = ["basic", "premium", "exclusive"];
