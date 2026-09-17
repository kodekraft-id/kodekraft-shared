#!/usr/bin/env node
// PLACEHOLDER CLI — scaffolded by OPS-shared-01.
//
// The real R1-R8 rule engine (exports-map integrity, app-identity declaration, no
// deep-import escapes, raw-binding containment, schema/matrix conformance, matrix<->doc
// sync, migrations lock, schema<->migrations drift) lands in OPS-mono-14. See
// project-docs/12-cross-repo-integration-design.md §5.5 for the full rule set.
//
// This stub exists only so package.json's "bin" entry (`kodekraft-check-ownership`) and
// the `./bin/check-ownership.mjs` path referenced by consumer repos' `check:ownership`
// script point at a real, executable file during v0.1 scaffolding. It is intentionally a
// no-op and must NOT be treated as an enforced check by any consuming repo's CI yet.
//
// Dependency-free plain .mjs by design (never compiled) — matches worker-landing's
// existing scripts/check-site-literals.mjs precedent (doc 12 §5.4).

console.log(
  "[kodekraft-check-ownership] placeholder (OPS-shared-01 scaffold) - " +
    "no ownership rules are implemented yet. See OPS-mono-14. This is a no-op and always exits 0."
);

process.exit(0);
