# Releasing `@kodekraft/shared`

This document is the release-process reference for this package. It is the operational
companion to `project-docs/12-cross-repo-integration-design.md` §5.6 in each of the 4
consuming repos (`invitation-worker-landing`, `invitation-worker-user`,
`invitation-worker-admin`, `invitation-worker-undangan`) — that doc explains *why* the
process is shaped this way; this doc is the concrete *how*, written against this package's
actual `package.json`, `ownership.json`, and CI as they exist today.

This is a **git-protocol dependency**, never published to npm. There is no npm registry
step anywhere in this process — "release" means "cut an annotated git tag that a consumer's
`package.json` can pin to."

## 1. The bump cycle

1. **PR against `kodekraft-shared`.** Its own CI (`.github/workflows/ci.yml`) runs, in order:
   `tsc --noEmit` (typecheck), `vitest run` (unit + fixture tests), a `dist/`-freshness check
   (`pnpm build && git diff --exit-code -- dist` — fails if `src/` changed but the committed
   `dist/` wasn't rebuilt), and `OWNERSHIP.md` render-match (`check-ownership.mjs`'s own-repo
   mode, R1 exports-map-intact + R6 `OWNERSHIP.md`-is-a-fresh-render-of-`ownership.json`).
2. **Merge to `main`.**
3. **Bump `version` in `package.json`** per the semver policy below.
4. **`git tag -a vX.Y.Z -m "..."`** — an annotated tag, on the merge commit, with a message
   summarizing what's actually in the release (not just "bump version").
5. **`git push origin main && git push origin vX.Y.Z`** — push the branch, then the tag.
6. **In each consuming repo that needs the new version:**
   `pnpm add github:kodekraft-id/kodekraft-shared#vX.Y.Z`, then
   `pnpm check:ownership && pnpm exec tsc --noEmit && pnpm test` (where a test suite exists),
   then commit `package.json` + `pnpm-lock.yaml` in that repo. **Not every consuming repo
   does step 6 for every release** — see §2.

Before tagging, it is worth running `pnpm classify-release <previous-tag> HEAD` (or
`main`) — see §4 — to get the widening/narrowing/lockstep classification in writing, and to
sanity-check that the version bump you're about to make (§3) matches what the tool sees.

## 2. Two adoption-obligation classes

The core rule that keeps 4 independently-pinned consumers safe: **not every version bump of
`@kodekraft/shared` obligates every consumer.** Which obligation applies depends on what
kind of change shipped.

### Widening — no lockstep

A **widening** change grants a new capability that didn't exist before, without touching
anything that already worked:

- A table/app gains a new write grant it didn't have (e.g. `worker-user` becomes a writer of
  `testimonials`, which today only `worker-admin` writes).
- A table/app's writable-column allowlist grows (e.g. `worker-landing`'s `clients` allowlist
  gains a new column it's now allowed to write, because a new column was added to the table).
- A brand-new table is added to `ownership.json` (e.g. `testimonials` or
  `invitation_domains` landing per `12-cross-repo-integration-design.md` §6.2's `0013+`
  migration plan).
- A new export is added (e.g. `./id` or `./tier` landing on top of `./ownership`/`./client`).

**Rule: only the app that needs the new capability has to bump.** The other 3 repos stay
pinned to the old tag indefinitely — their guard (`getDb(binding, app)`) still enforces
*their own* matrix row, and that row is unchanged. There is nothing for them to react to.
Concretely: if `worker-admin` is granted a new write column on `invitations`, `worker-user`
does not need to bump `@kodekraft/shared` just because a new tag exists.

### Narrowing — the narrowed app must bump and deploy *first*

A **narrowing** change revokes something that used to work:

- A write permission is revoked (e.g. `worker-admin` loses its `deleted_at`/`updated_at`
  write grant on `clients` — per the current matrix, this is exactly the shape of grant that
  exists and could be revoked).
- A column allowlist is tightened (e.g. `worker-landing`'s `clients` writer entry drops a
  column it used to be allowed to write, such as `phone`).
- A rule change that newly fails code that previously passed (e.g. a stricter R4/R5 pattern
  in `check-ownership.mjs` that a consumer's existing file layout now trips).

**Rule: the narrowed app must bump and deploy *first*, and the bump is not "done" until it
has deployed.** Concretely: if a decision is made to revoke `worker-admin`'s write access to
`clients` (tightening it to read-only, say), the sequence is:

1. `worker-admin` bumps to the new tag, removes/reworks the code path that wrote those
   columns, and **deploys**.
2. Only after that deploy is live does the narrowing "take effect" in practice — the
   permission being revoked in `ownership.json` is a **paper change** until the one app that
   relied on it has stopped relying on it in production.
3. The other 3 repos were never writers of `clients.deleted_at`/`updated_at` in the first
   place, so this narrowing has zero effect on them; they don't need to bump at all.

If a narrowing bump is merged and tagged in `kodekraft-shared` but the narrowed app has
**not yet redeployed**, that app's production code is still calling a write path the matrix
no longer sanctions — the app is running against a stale mental model of its own
permissions, not against a stale package version (since it hasn't bumped yet). This is why
"bump and deploy first" is one obligation, not two: bumping without deploying doesn't
protect anything.

### `migrations.lock.json` change — a lockstep DDL obligation

A new migration file (`0013_*.sql` and beyond, per `12-cross-repo-integration-design.md`
§6.2's numbering plan) is, from the ownership-matrix's point of view, a **widening** change
(new tables/columns become writable by *someone*). But structurally it is different from an
`ownership.json`-only widening change, because of how D1 migrations are applied: **a
migration file must physically exist, byte-identical, in a repo's `migrations/` folder
before that repo's own `wrangler d1 migrations apply` can run it** — there is no way for one
repo's migration file to "cover" another repo's D1 schema.

Concretely, the rule is:

> When a new migration file lands in `migrations.lock.json` (its sha256 hash is added), that
> exact file **must be copied into all 4 consuming repos' `migrations/` folders** — this is
> the existing convention (`0001`–`0012` are already byte-identical across all 4 repos,
> independently verified via `diff -rq`) — **before any of them can bump their
> `@kodekraft/shared` pin past the version whose `migrations.lock.json` includes that file.**

Why "before any of them," not just the one repo that needs the new table: `check-ownership`'s
**R7** rule (`bin/check-ownership.mjs`) checks the *entire* `kodekraft.migrationsDir` of the
consuming repo against the *entire* `migrations.lock.json` it ships with — not just the
tables that repo happens to use. So the instant a repo bumps to a tag whose
`migrations.lock.json` includes a new file, R7 will fail that repo's CI (a
"missing — present in migrations.lock.json but not found in migrationsDir" violation) unless
the file is already sitting in its `migrations/` folder. This is deliberate — see
`12-cross-repo-integration-design.md` §5.3: it is precisely the mechanism that replaces a
canonical shared-schema package with an *enforced* drift check on hand-mirrored schemas.

**In practice:** landing a new migration is a 5-repo operation in careful order — author the
migration once, copy it into all 4 app repos' `migrations/` folders (and apply it to the
live shared D1, per each repo's own migration-apply process), update
`kodekraft-shared`'s own `migrations.lock.json` with the new file's hash, then tag. Only
*after* the file exists in all 4 repos is it safe for `check-ownership` R7 to be checking for
it in any of them.

## 3. Semver policy

This package stays on `0.x` for a while on purpose (see below for the `1.0.0` bar). Within
`0.x`:

- **Minor** (`0.1.0` → `0.2.0`) — any change to `ownership.json` (a table/app/column
  grant added, removed, or tightened; a table added or removed) **or** any change to the
  package's export surface (`package.json`'s `exports` map gains or loses a subpath, e.g.
  `./id` or `./tier` landing). This covers both widening and narrowing changes from §2 — the
  minor/patch split is about *what kind of artifact* changed, not about whether the change is
  widening or narrowing.
- **Patch** (`0.1.0` → `0.1.1`) — implementation-only changes: a bug fix in `guard.ts`'s
  Proxy logic, a `check-ownership.mjs` rule getting a false-positive fix, a `dist/` rebuild
  after a tooling change, a docs-only change — anything where `ownership.json`'s content and
  the `exports` map are byte-identical before and after.

**Do not cut `1.0.0` until the matrix has been stable — no widening or narrowing
`ownership.json` change — across one full feature cycle in all 4 repos.** A "feature cycle"
here means: all 4 repos have shipped at least one real feature against the current matrix
shape without needing a matrix change. Cutting `1.0.0` early would claim a stability
guarantee ("the matrix is done") that the matrix's actual, ongoing churn (see §6.2's `0013+`
migration plan, which touches a dozen tables) does not yet support.

## 4. `scripts/classify-release.mjs` — mechanising the widening/narrowing call

Reading `ownership.json`'s diff by eye and correctly classifying every changed line is
error-prone once the matrix has more than a couple of tables. `scripts/classify-release.mjs`
automates the first pass:

```bash
pnpm classify-release <from-ref> <to-ref>
# e.g.
pnpm classify-release v0.1.0 HEAD
pnpm classify-release <previous-commit-sha> <new-commit-sha>
```

It diffs `ownership.json`, `package.json`'s `exports` map, and `migrations.lock.json`
between the two refs (via `git show <ref>:<path>`, so it works against any two commits, tags,
or branches in this repo's own history) and prints, per change:

- `[WIDENING]` — a table/app gained a write or read grant, an allowlist grew, a new table
  appeared, or a new export was added.
- `[NARROWING]` — a table/app lost a write or read grant, an allowlist shrank, or an export
  was removed.
- `[LOCKSTEP]` — `migrations.lock.json` changed at all (added, removed, or re-hashed file).

...and a summary line: **"THIS RELEASE NEEDS LOCKSTEP COORDINATION"** if any `[NARROWING]`
or `[LOCKSTEP]` finding is present, or **"Pure widening release — no lockstep required"**
otherwise. This mirrors §2's rules exactly; it is advisory (exit code `0` either way, aside
from a usage/git error) — it does not block a merge or a tag by itself, it just makes the
classification call visible and checkable in a PR description before a human commits to it.

It is a pragmatic, JSON-diff-based tool in the same style as `bin/check-ownership.mjs` and
`invitation-worker-landing/scripts/check-site-literals.mjs` — not an exhaustive semantic
analyzer. It does not (yet) understand things like "a column was renamed" (it will report
that as one narrowing removal + one widening addition, which is directionally correct but
not as clean as a dedicated rename detector) or JSDoc/comment-only changes to `ownership.json`
(none exist today — every field it reads is structural).

## 5. Rollback

Because `dist/` is committed and consumers resolve through `pnpm-lock.yaml`'s SHA pin (not a
live tag lookup at install time), rolling a consuming repo back is a one-line revert:

```bash
pnpm add github:kodekraft-id/kodekraft-shared#v<previous-version>
```

...followed by committing the resulting `package.json` + `pnpm-lock.yaml` diff. No rebuild,
no republish step, because there is no npm registry in this flow at all.

## 6. Version history

- **`v0.1.1`** (patch) — `bin/check-ownership.mjs`'s R4 rule false-positive fix. The bare
  `.(?:prepare|batch|exec)\s*\(` method-name match fired on any receiver, not just a D1
  binding — found during `BE-undangan-07` (the first real consumer integration), where it
  incorrectly flagged `RegExp.prototype.exec()` calls (a regex literal's own `.exec()`, and a
  module-level `const OPEN = /.../; OPEN.exec(...)` variable) as R4 violations. R4 now only
  flags a `.prepare()`/`.batch()`/`.exec()` call when the identifier chain immediately before
  it looks binding-shaped (contains `db`/`database`/`binding` as a whole, camelCase-aware word
  segment), and excludes matches directly preceded by a regex-literal closing slash (`/`).
  `ownership.json` and the `exports` map are unchanged — implementation-only, hence patch per
  §3.
- **`v0.1.0`** — initial release: ownership matrix, `guard.ts` runtime D1 write guard, `tier.ts`
  capability map, `check-ownership.mjs` static rule engine (R1-R7).
