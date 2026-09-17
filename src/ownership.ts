// PLACEHOLDER MODULE — scaffolded by OPS-shared-01.
//
// The real implementation lands in BE-mono-12: `ownership.json` (the machine-readable
// table-ownership matrix, source of truth) plus this file's typed view over it
// (`writersOf`, `writableColumns`, `tablesFor`) — see project-docs/12 §5.1 and §5.4.
//
// This stub exists only so the package's exports map (`./ownership`), build pipeline, and
// CI have a real module to compile, bundle, and test end-to-end during v0.1 scaffolding.
// Nothing here should be treated as the real ownership contract.

/** Placeholder shape — replaced by the real matrix type when BE-mono-12 lands. */
export interface OwnershipMatrixStub {
  readonly placeholder: true;
}

/** Placeholder export confirming the `./ownership` module resolves. Replaced by BE-mono-12. */
export const ownershipStub: OwnershipMatrixStub = { placeholder: true };
