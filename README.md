# @kodekraft/shared

The shared cross-repo contract package for the `kodekraft-id` invitation platform's four
independent app repos (`invitation-worker-landing`, `invitation-worker-user`,
`invitation-worker-admin`, `invitation-worker-undangan`).

Full design and rationale: `project-docs/12-cross-repo-integration-design.md` §5 in each
consuming repo. This file plus `RELEASING.md` (release process for *this* package) and
`docs/DEPLOYMENT.md` (rollout procedure for the 4 apps that consume it) are this package's
own docs (`DOC-shared-01`/`DOC-shared-02`).

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

## Status (v0.13.0, tagged and pushed)

Started as the `OPS-shared-01` scaffolding commit. Every module listed under "What this
package is" above has a real implementation, with 502 tests as of `package.json`'s current
`0.13.0`. All four app repos pin `#v0.13.0`. See `RELEASING.md`'s "Version history" for what
shipped in every release since `v0.1.0`; every tag listed there now exists on the remote
(`v0.10.0` deliberately has none — its lock entry shipped inside `v0.11.0`, see that entry):

| Module | Status |
|---|---|
| `src/ownership.ts` | **real (`BE-mono-12`, landed)** |
| `src/client.ts` | **real (`BE-mono-13`, landed)** |
| `src/guard.ts` | **real (`BE-mono-13`, landed)** |
| `src/tier.ts` | **real (`BE-mono-10`, `BE-mono-23`, landed)** — `TIER_CAPABILITIES` (QR check-in and custom domain are `false` at every tier: add-ons only; durations basic 3 / premium 6 / exclusive 12 months), `parsePurchasedAddons`, `getEffectiveCapabilities`, `getEffectivePhotoCap(tier, override?, addons?)` (= `override ?? min(tierCap + 15 x gallery, PHOTO_CEILING=50)`), `hasFeature(tier, feature, addons?)`, `maxUsefulGalleryUnits`, `computeExpiresAt`, expiry helpers (`BE-mono-28`, v0.7.0: `isInvitationExpired`, `isInvitationLocked`, `getInvitationExpiryState`, `isDomainActive`, `parseTimestampMs`, `EXPIRY_GRACE_DAYS`), event-based expiry + check-in window (v0.8.0, product-rule change: `computeExpiresAtFromEvents(events, tier, opts?)`, `isCheckinWindowOpen(events, opts?)`, `CHECKIN_PRE_BUFFER_MINUTES`, types `EventWindow`/`ComputeExpiresAtFromEventsOptions`/`CheckinWindowOptions`), constants `GALLERY_ADDON_PHOTOS`/`PHOTO_CEILING`/`MAX_ADDON_QUANTITY` |
| `bin/check-ownership.mjs` | **real (`OPS-mono-14`, landed)** — R2'/R3/R4/R4-exempt/R5/R7 enforced against a consumer; R1/R6 enforced against this package's own repo. R8 (v0.2, optional) is the only rule still open. |
| `ownership.json` | **real (`BE-mono-12`, landed)** |
| `OWNERSHIP.md` | **real, generated render (`OPS-mono-14`, landed)** — run `node bin/check-ownership.mjs --fix` to regenerate after any `ownership.json` change |
| `migrations.lock.json` | **real, landed** — R7 is fully enforced against consumers now, no more `R7 SKIPPED` warning. |
| `bin/sync-migrations.mjs` | **real (`OPS-shared-07`, landed)** — see "Adding a migration" below. |
| `src/domain-name.ts` | **real (`BE-mono-32`, landed in `v0.12.0`)** — the ONE canonical custom-domain validator (`normalizeDomainName`), exported as `@kodekraft/shared/domain-name`. It exists because worker-landing's checkout and worker-user's dashboard had drifted apart on what a valid `.my.id` name is. |
| `scripts/classify-release.mjs` | **real (`OPS-shared-20`, landed)** — see `RELEASING.md` §4. |

The package shell, exports map, build pipeline, and CI are real and passing end-to-end.
`v0.1.0` was the first tag — see `RELEASING.md`'s version history for every release since.
As of 2026-09-23 there is no local-only backlog: every tag in that history is on the remote,
verified by comparing `git tag -l` against `git ls-remote --tags origin`.

**Watch the lockstep rule when bumping.** A change to `migrations.lock.json` is a MINOR bump,
and the four app repos' pins move with it — `v0.11.0` and `v0.13.0` are both that kind of
release. `RELEASING.md` §3 has the full bump rules.

## Consuming this package

This is a **git-protocol dependency**, never published to npm (`"private": true` in
`package.json` is deliberate — it blocks an accidental `npm publish`).

```bash
pnpm add github:kodekraft-id/kodekraft-shared#v0.13.0
```

This writes an immutable-by-lockfile pin: the tag is the human-readable pointer, and
`pnpm-lock.yaml` resolves it to a commit SHA, so `pnpm install --frozen-lockfile` stays
reproducible even if a tag were force-moved. **Never pin a branch ref (`#main`).**

The tag must already exist on `github.com/kodekraft-id/kodekraft-shared` (pushed, not just
committed locally) before this can resolve — `pnpm add`/`pnpm install` fail outright against
a tag that only exists as a local, unpushed `git tag` in this repo's own working copy. Check
`RELEASING.md`'s "Version history" section (or `git tag --list` in this repo) before pointing
a consumer at a version newer than what's confirmed pushed.

```ts
import { getDb } from "@kodekraft/shared/client";
import { writersOf, writableColumns, tablesFor } from "@kodekraft/shared/ownership";
import { TIER_CAPABILITIES, getEffectiveCapabilities, parsePurchasedAddons } from "@kodekraft/shared/tier";

// Effective entitlements = tier defaults + purchased add-ons (invitations.purchased_addons) + staff override
const caps = getEffectiveCapabilities(tier, parsePurchasedAddons(row.purchased_addons), row.photo_cap_override);
```

There is deliberately **no root `.` export** — every import must name exactly what it
pulls in.

### The `kodekraft` block in the consumer's `package.json`

`check-ownership` reads its configuration from a `kodekraft` block in the consuming repo's
own `package.json` (rule R2' fails if it is missing or names an app not in `ownership.json`),
and each repo exposes the CLI as a script:

```json
{
  "scripts": { "check:ownership": "kodekraft-check-ownership" },
  "dependencies": { "@kodekraft/shared": "github:kodekraft-id/kodekraft-shared#v0.13.0" },
  "kodekraft": {
    "app": "worker-user",
    "dbCompositionRoot": "src/worker/db/client.ts",
    "schemaMirror": "src/worker/db/schema.ts",
    "migrationsDir": "migrations"
  }
}
```

| Key | Meaning |
|---|---|
| `app` | This repo's identity; one of `ownership.json`'s `apps` (`worker-landing`, `worker-user`, `worker-admin`, `worker-undangan`). |
| `dbCompositionRoot` | The one file allowed to touch the raw `env.DB` binding (it calls `getDb(env.DB, app)`). |
| `schemaMirror` | The repo's hand-mirrored Drizzle schema; every `sqliteTable(...)` in it must be a table this app reads or writes. |
| `migrationsDir` | The repo's migrations folder, hashed against `migrations.lock.json`. |

### `check:ownership` rules

Run `pnpm check:ownership` from a consuming repo's root (exit code 1 on any violation, each
printed as `file:line — [Rule] message`). In this package's own repo, the same binary runs
the package-integrity rules instead.

| Rule | Where | Fails when |
|---|---|---|
| R1 | this repo | the exports map has a root `"."` export, or a subpath target is missing on disk |
| R6 | this repo | `OWNERSHIP.md` is missing or not a fresh render of `ownership.json` |
| R2' | consumer | no `kodekraft` block, or `kodekraft.app` is missing / not in `ownership.json` |
| R3 | consumer | any import reaches around the exports map (`@kodekraft/shared/src`, `/dist`, or a relative path into `node_modules`) |
| R4 | consumer | `env.DB`, or a binding-shaped receiver's `.prepare()/.batch()/.exec()`, appears outside `dbCompositionRoot`. Exempt: `bindings.ts`, `test/**`, `*.test.ts`/`*.spec.ts`. Comment text is ignored. A receiver explicitly typed (via an import that traces back to `dbCompositionRoot`) as the composition root's own guarded return type is also exempt (`OPS-shared-21` part b, `v0.9.1`) — e.g. a repository's `constructor(private readonly db: DB)` or a factory's `(db: DB)` parameter is not a second path to the raw binding. A raw `D1Database`-typed receiver, or one whose type doesn't trace back to `dbCompositionRoot`, is still flagged. |
| R5 | consumer | `schemaMirror` defines a table the app neither reads nor writes per `ownership.json` |
| R7 | consumer | a file in `migrationsDir` differs from, is missing from, or is absent in `migrations.lock.json` (sha256 of the file bytes; note that on Windows with `core.autocrlf` a CRLF working copy hashes differently from the LF that CI checks out) |

### The runtime guard: `getDb(binding, app, { mode })`

`getDb` wraps the raw D1 binding in a Proxy that checks every write (`INSERT`/`UPDATE`/
`DELETE`, including `ON CONFLICT DO UPDATE` columns, and each statement in a `batch()` or
`exec()`) against `ownership.json` before it runs. Reads pass through untouched. A write it
cannot parse (e.g. `REPLACE INTO`, DDL, an unrecognized shape) **fails closed** as a violation.

| Mode | On violation |
|---|---|
| `"throw"` (default) | throws `OwnershipViolationError`; the statement never reaches D1 |
| `"warn"` | logs a structured record via `console.error` and lets the statement proceed. Intended for rolling the guard out to a repo before enforcing it. |

### Adding a migration (`sync-migrations`)

Migrations are byte-identical across all 4 app repos and locked in `migrations.lock.json`
(a lockstep DDL obligation, see `RELEASING.md`). Instead of copying by hand:

```bash
node bin/sync-migrations.mjs ../invitation-worker-landing/migrations/0014_something.sql --dry-run
node bin/sync-migrations.mjs ../invitation-worker-landing/migrations/0014_something.sql
```

It expects the 4 app repos as siblings of this package (override with `--root <dir>`),
copies the file into each `migrations/` folder, and rewrites `migrations.lock.json` (sorted,
CRLF-normalized hashes). It refuses (before writing anything) a bad name, a number not above
the locked maximum, an edit to an already-locked migration, a conflicting file already in a
repo, or repos that have diverged. It never commits, bumps, or tags; do that per `RELEASING.md`.

### Bumping a consumer's pin: widening vs. narrowing

Full rules and worked examples are in `RELEASING.md` (doc 12 §5.6). In short:

- **Widening** (new write grant, new column, new table, new export): only the app that needs
  the new capability bumps its pin; the other repos may stay on the old tag.
- **Narrowing** (a revoked write or tightened column list, or a stricter rule that newly
  fails existing code): the narrowed app must bump **and deploy first**; until it has
  deployed, the change is on paper only.
- **`migrations.lock.json` change**: the new file must exist in all 4 repos' `migrations/`
  before any of them bumps past that version (otherwise R7 fails their CI).
- Semver: `0.x`; **minor** = `ownership.json` / export-surface change, **patch** =
  implementation-only. `node scripts/classify-release.mjs` classifies a commit range for you.

To bump a consumer: change the tag in its `package.json` (`#vX.Y.Z`), run `pnpm install` so
`pnpm-lock.yaml` re-resolves it to a commit SHA, run `pnpm check:ownership`, commit both files.

### Per-Worker secrets

See `docs/SECRETS.md` for the secrets each Worker needs set before a deploy.

### Deployment runbook

See `docs/DEPLOYMENT.md` for the actual 4-repo rollout procedure — deploy order and why,
per-repo preconditions (which migrations must be live first), the ownership-guard warn/throw
rollout status per repo, and the rollback plan. `RELEASING.md` (above) is about releasing
*this package*; `docs/DEPLOYMENT.md` is about deploying the 4 apps that consume it.

### The ownership matrix

`OWNERSHIP.md` is a generated, human-readable render of `ownership.json` (the source of
truth). After any `ownership.json` change, regenerate it with
`node bin/check-ownership.mjs --fix`; CI fails (R6) if it is stale.

### Committed `dist/`

`dist/` (ESM `.js` + `.d.ts`) is committed to this repo, not gitignored, and not built at
consumer install time. A git-protocol dependency has no `prepare` script and no
install-time build step in the consumer, so whatever is in `dist/` at the pinned tag is
what ships. This repo's own CI fails the build if `dist/` is stale relative to `src/`
(`pnpm build && git diff --exit-code -- dist`).

## Versioning and releasing

`0.x`, where **minor** = any `ownership.json`/export-surface change, **patch** =
implementation-only. See `RELEASING.md` for the full bump-cycle process (PR → CI → merge →
bump → tag → push), the widening-vs-narrowing adoption-obligation rules, the
`migrations.lock.json` lockstep obligation, and `scripts/classify-release.mjs`, the tool
that classifies a range of commits into those categories automatically. `v0.1.0` is the
first tag, cut via `OPS-shared-20`.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # compiles src/ -> dist/ (commit the result)
```

## CI & local checks

`.github/workflows/ci.yml` runs on every push/PR to `development` and
`development-refactor`: `pnpm typecheck`, `pnpm test`, a `dist/` freshness check and
`check-ownership`. No deploy step and no Cloudflare
credentials are in CI — it is test-only.

To run the same checks locally before every `git push` (OPS-mono-15), install
the committed hook once:

```bash
git config core.hooksPath scripts/hooks
```

This is opt-in — nothing installs it automatically. Uninstall with
`git config --unset core.hooksPath`. Each repo's hook mirrors **its own** CI
steps, which are not identical across the five — see `scripts/hooks/pre-push`
for what this one runs. The `dist/` check matters most here: the four app
repos install this package straight from git with no build step of their own,
so a stale `dist/` ships broken code to all of them.
