# @kodekraft/shared

The shared cross-repo contract package for the `kodekraft-id` invitation platform's four
independent app repos (`invitation-worker-landing`, `invitation-worker-user`,
`invitation-worker-admin`, `invitation-worker-undangan`).

Full design and rationale: `project-docs/12-cross-repo-integration-design.md` §5 in each
consuming repo (this package's own docs land later, via `DOC-shared-01`).

## What this package is

Only artifacts where drift between repos would silently corrupt data in the shared D1
database or silently void a security control:

- **`./ownership`** — the table-ownership matrix (`ownership.json`, source of truth) and
  typed helpers over it (`writersOf`, `writableColumns`, `tablesFor`).
- **`./client`** — `getDb(binding, app)`, a runtime write guard that wraps a D1 binding so
  every write Drizzle emits is checked against the ownership matrix before it runs.
- **`./tier`** — the pricing-tier capability map (`TIER_CAPABILITIES` and pure predicate
  functions), shared because a support incident where worker-admin displays a different
  tier cap than worker-user enforces is worse than the cost of sharing a pure, dependency-
  free module.
- **`bin/check-ownership.mjs`** — the CI/pre-push guard that enforces the matrix at build
  time in each consuming repo.

## What this package deliberately is NOT

Per `project-docs/12-cross-repo-integration-design.md` §5.1, the following stay per-repo
and are **not** part of this package's surface, on purpose:

- The response envelope, RC-code map, and `HttpError` — drift here is cosmetic and
  immediately visible, never corrupting. worker-undangan has no envelope at all and its
  own refactor doesn't add one; forcing this on all four repos creates an unjustified
  lockstep obligation.
- `assertFeature()` — each consuming repo writes its own 3-line wrapper around `./tier`'s
  pure predicates, throwing its own `HttpError`.
- Session/JWT/password helpers — the most security-sensitive code in the system, with
  separate secrets and separate identity tables per app. Independently owned by
  worker-user's and worker-admin's own refactor plans.
- Correlation-id / structured-logging middleware — does not exist in any of the four repos
  today; new functionality per repo, not something to share before it's built.
- The canonical Drizzle schema — each repo keeps its own hand-mirrored, deliberately
  *partial* `schema.ts`. See doc 12 §5.3 for the full reasoning (in short: a canonical
  schema would put `admins`/`orders`/`clients` back within import reach of the public,
  unauthenticated worker-undangan Worker).

## Status (v0.1.0 — initial scaffold)

This is the `OPS-shared-01` scaffolding commit. `src/ownership.ts`, `src/client.ts`,
`src/tier.ts`, and `src/guard.ts` are **placeholder stubs only** — each is clearly marked
with a comment naming the task that fills it in for real:

| Module | Placeholder today | Real implementation lands in |
|---|---|---|
| `src/ownership.ts` | **real (`BE-mono-12`, landed)** | — |
| `src/client.ts` | passthrough stub | `BE-mono-13` |
| `src/guard.ts` | passthrough stub | `BE-mono-13` |
| `src/tier.ts` | typed stub | `BE-mono-10` |
| `bin/check-ownership.mjs` | no-op, always exits 0 | `OPS-mono-14` |
| `ownership.json` | **real (`BE-mono-12`, landed)** | — |
| `OWNERSHIP.md` | does not exist yet — generated render, `OPS-mono-14` | `OPS-mono-14` |
| `migrations.lock.json` | does not exist yet | `OPS-shared-05` (in this repo) |

The package shell, exports map, build pipeline, and CI are real and passing end-to-end
against these stubs, so later tasks can land real content without also having to build
scaffolding.

## Consuming this package

This is a **git-protocol dependency**, never published to npm (`"private": true` in
`package.json` is deliberate — it blocks an accidental `npm publish`).

```bash
pnpm add github:kodekraft-id/kodekraft-shared#v0.1.0
```

This writes an immutable-by-lockfile pin: the tag is the human-readable pointer, and
`pnpm-lock.yaml` resolves it to a commit SHA, so `pnpm install --frozen-lockfile` stays
reproducible even if a tag were force-moved. **Never pin a branch ref (`#main`).**

```ts
import { getDb } from "@kodekraft/shared/client";
import { writersOf, writableColumns, tablesFor } from "@kodekraft/shared/ownership"; // real, BE-mono-12
import { tierStub } from "@kodekraft/shared/tier";            // stub in v0.1.0
```

There is deliberately **no root `.` export** — every import must name exactly what it
pulls in.

### Committed `dist/`

`dist/` (ESM `.js` + `.d.ts`) is committed to this repo, not gitignored, and not built at
consumer install time. A git-protocol dependency has no `prepare` script and no
install-time build step in the consumer, so whatever is in `dist/` at the pinned tag is
what ships. This repo's own CI fails the build if `dist/` is stale relative to `src/`
(`pnpm build && git diff --exit-code -- dist`).

## Versioning

`0.x`, where **minor** = any `ownership.json`/export-surface change, **patch** =
implementation-only. See `project-docs/12-cross-repo-integration-design.md` §5.6 in the
consuming repos for the full widening-vs-narrowing bump rules. No tag has been cut yet for
this initial scaffold — that's `OPS-shared-20`, once real content exists.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # compiles src/ -> dist/ (commit the result)
```
