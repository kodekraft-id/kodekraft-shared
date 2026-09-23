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

**Tag status, re-verified 2026-09-23** by comparing `git tag -l` against
`git ls-remote --tags origin`: **there is no local-only backlog — every tag below exists on
the remote, and every remote tag now has an entry below.** Four versions have no tag of their
own — `v0.2.0` (written up inside `v0.3.0`'s entry) and `v0.4.0`, `v0.8.0`, `v0.10.0` (each
marked as such) — because their content shipped inside the next tagged release. A version
bump without its own tag is normal here and is not a missing step; the thing that WOULD be a
bug is a pin in an app repo pointing at a tag that does not exist, and all four repos
currently pin `#v0.13.0`, which does.

`v0.1.2` and `v0.3.0` were tagged and pushed but had no entry here at all until this pass —
the history jumped straight from `v0.1.1` to `v0.4.0`. Both are reconstructed from git and
marked as such.

- **`v0.13.0`** (minor, LOCKSTEP) - `migrations.lock.json` gains `0026_event_label_rename.sql`, and
  `invitations.event_label` is granted to the same three writers `event_type` already had (worker-landing,
  worker-user, worker-admin). Bump rule applied: **minor**, per section 2's `migrations.lock.json` clause - a lock
  change is a lockstep DDL obligation regardless of the DDL itself being purely additive, so all 4 app pins move
  with it. The migration is `BE-wl-04`, authored as `0026` because the `0019` its task text names was taken by
  `0019_activation_observability.sql` long ago (landing doc 16 section 12 records the renumbering). It adds
  `invitations.event_label` and `wa_templates.tag` as free TEXT and backfills both 1:1 from `event_type`; the old
  columns are NOT dropped - that is `BE-wl-06`, gated on a production burn-in. `wa_templates.tag` needed no grant
  change (worker-admin already holds unrestricted write there). Both grants are INERT until `BE-wl-05` ships the
  first code that writes them, matching the `checkin_test_mode` precedent: the ownership grant lands at authoring
  time, the app `schema.ts` mirror does NOT - an early mirror is what would break a production select(), not an
  early grant.

- **`v0.12.0`** (minor, tagged) - NEW EXPORT `@kodekraft/shared/domain-name` (`BE-mono-32`): the custom-domain
  name rules that worker-landing (checkout) and worker-user (dashboard) each had their own copy of. Bump rule
  applied: **minor**, per §3 - a new export is a widening, so only the apps that need it bump their pin and the
  other two can stay on `v0.11.0` indefinitely. `ownership.json` and `migrations.lock.json` are byte-identical.
  The two copies had diverged TWICE: (1) found 2026-09-20, worker-user had neither the reserved-label list nor
  the 3-character minimum, so the dashboard could register a name checkout refused; (2) found 2026-09-21 while
  writing this module, the hand-patch for (1) aligned only the list and the minimum, not the algorithm - checkout
  strips a scheme/`www.`/path before validating while the dashboard split the name into DNS labels and demanded
  exactly three, so `www.budi.my.id` was accepted by one and rejected by the other. worker-landing's algorithm is
  canonical here: it is the shipped money path, its own header already called it authoritative, and it is the more
  permissive of the two - so adopting it can only make the dashboard accept MORE of what checkout already accepts,
  never less, which is the only safe direction (the opposite could create a paid-but-unregisterable name).
  13 tests, including one that pins each divergence so neither can silently return.

- **`v0.11.0`** (minor, tagged) - `migrations.lock.json` gains `0025_template_section_bg_all.sql`. Pram ruled
  (2026-09-21) that every section on every template must accept an uploaded background, so worker-undangan's seven
  renderers were changed to honour `sections.bg_r2_key` everywhere and this migration sets all seven manifests to the
  full 12 keys. Bump rule applied: **minor**, same lockstep-DDL rule as `v0.10.0` - a lock change is a minor bump
  regardless of what else did or did not widen. `ownership.json` and the `exports` map are byte-identical; `src/` is
  untouched. **This tag contains `v0.10.0`'s lock entry as well, so tag `v0.11.0` ONLY** - `v0.10.0` was never
  tagged and does not need its own tag.

- **`v0.10.0`** (minor, NO TAG OF ITS OWN — see the note under this heading) - `migrations.lock.json` gains `0024_template_section_bg_keys.sql` (`BE-undangan-08`:
  a per-section, per-template background-image manifest replacing the coarse `templates.supports_section_bg` boolean).
  Bump rule applied: **minor**, per §3's lockstep-DDL rule - a `migrations.lock.json` change is a minor bump
  regardless of whether anything else widened, because all 4 app repos must hold the new file byte-identically before
  any of them bumps past this tag or R7 fails their CI with "unexpected file". `ownership.json` is byte-identical:
  the new column sits on `templates`, a table every app already reads and none writes at runtime (it is seeded by
  migration only), so no grant changed and no app gained a write. `src/` and the `exports` map are untouched - this
  release carries the lock entry and nothing else.

- **`v0.9.1`** (patch, tagged) — `bin/check-ownership.mjs` R4 precision fix (`OPS-shared-21` part b). Bump rule
  applied: **patch**, per §3's own explicit example ("a `check-ownership.mjs` rule getting a false-positive fix") —
  `ownership.json` and the `exports` map are byte-identical (`pnpm classify-release` reports no changes to either, nor
  to `migrations.lock.json`), confirming this is implementation-only. R4 previously couldn't resolve a receiver's
  static type, so a `.prepare()`/`.batch()`/`.exec()` call on an ALREADY-GUARDED Drizzle instance (received via
  dependency injection, typed as `kodekraft.dbCompositionRoot`'s own exported return type) fired identically to a real
  raw-binding call. Fixed by tracing, per scanned file: (1) which type alias(es) the composition root exports as
  `ReturnType<...>` (name-agnostic — matches `DB` in worker-user/-admin/-landing and `Db` in worker-undangan), (2)
  whether a receiver's own parameter/constructor-parameter-property/field/variable is explicitly annotated with that
  alias via an import that resolves (by path, not by name) back to the composition root file, scoped per top-level
  function/class (not blanket per file — an earlier draft of this fix tracked one flat per-file set and was proven,
  by deliberately planting the counter-example during this same change, to let one legitimately-guarded `db: DB`
  parameter in one function shield an unrelated, genuinely-raw same-named parameter in a different function in the
  same file; `splitIntoTopLevelChunks` closes that gap). Chose this narrower text-based trace over the TypeScript
  compiler API as disproportionate for a "dependency-free, sub-second" static check that would otherwise need every
  consuming repo's tsconfig to resolve. Verified empirically against all 4 consuming repos (before -> after, this
  change only): worker-user 35 R4 -> 0 R4, worker-admin 1 R4 -> 0 R4, worker-landing 0 R4 -> 0 R4, worker-undangan 0
  R4 -> 0 R4; each repo's only remaining violations are the pre-existing, unrelated 13 `[R7]` CRLF-checkout artifacts
  (see below) — zero new violations anywhere, and every repo's git working tree was confirmed untouched after
  verification. No-false-negative proof: planted a real raw-binding violation (a `D1Database`-typed parameter calling
  `.prepare()`, a literal `env.DB.prepare()`, and an unannotated binding-shaped parameter calling `.batch()`, plus a
  correctly-guarded `db: DB` sibling function in the SAME file) in a temp file inside `invitation-worker-user`,
  confirmed the fixed checker still caught exactly the 3 genuine violations and left the guarded one alone, then
  deleted the file (`git status` confirmed clean before and after, nothing committed there). Added regression tests
  covering both directions in `test/check-ownership.test.ts` plus 4 new fixtures: guarded receiver not flagged
  (factory-function parameter and constructor-parameter-property, including an aliased import and a non-`DB` alias
  spelling), a raw/differently-typed receiver still flagged in a file that also legitimately uses the guarded type,
  a same-named-but-not-imported-from-the-composition-root local type still flagged (import-provenance, not name
  matching), and the cross-function-leakage false negative found and fixed during this same change. Also improves
  R7's sha256-mismatch message (diagnostic text only, never changes pass/fail): when a mismatched file's content
  matches the locked hash once CRLF is normalized to LF, the message now says so and points at comparing against the
  committed blob — this does NOT fix the 13 CRLF-checkout-artifact violations `[R7]` currently reports in each of the
  4 consuming repos (confirmed real: this message's own CRLF-normalization check matches for all 13 in each repo),
  which remain open and out of scope for this release; do not "fix" them by renormalizing working-tree files.
- **`v0.9.0`** (minor, tagged) - `migrations.lock.json` gains `0023_checkin_test_mode.sql` (doc 17 FR-22, ruling 40:
  owner-side check-in test mode). Two purely additive columns on existing tables: `invitations.checkin_test_mode` and
  `guests.checked_in_is_test`, both `INTEGER NOT NULL DEFAULT 0 CHECK (col IN (0,1))` — same proven pattern as
  `is_demo` (0022). `ownership.json` also changes (this is what makes the release minor, not just the lock):
  `invitations.checkin_test_mode` is writable by worker-user (the owner-only toggle endpoint, FR-22.1) **and**
  worker-admin (so the pre-existing add-on-revoke endpoint, which already writes `purchased_addons`, can flip test
  mode back to 0 in the same request when staff revoke the `qrcheckin` add-on — ruling 40 point (e) / OQ-35 "revoke
  turns test mode off"); `guests.checked_in_is_test` is writable by worker-user only (FR-22.3, alongside the
  `checked_in_at` column it already owns). **Not a pure-widening release despite both schema changes being additive:**
  `pnpm classify-release` reports `[LOCKSTEP]` for the `migrations.lock.json` change (per §2, the file must exist in
  all 4 repos' `migrations/` before any of them bumps past this tag) alongside `[WIDENING]` for the two new column
  grants — zero `[NARROWING]`. Minor per §3 for two independent reasons: any `ownership.json` change is minor, and a
  `migrations.lock.json` change is its own lockstep DDL obligation regardless of widening/narrowing (the `v0.3.0`/
  `v0.5.0` precedent). `src/`, `dist/` and the `exports` map are byte-identical (rebuild produced no diff) —
  `ownership.json` is read from disk at runtime by `ownership.ts` (`import ownershipData from "../ownership.json"`),
  not inlined at build time, so this particular change needed no `dist` rebuild. **Deliberately NOT granted:**
  worker-admin gets no write or read access to `guests` in this release. Erasing the outstanding TEST check-ins that
  should accompany an admin-triggered add-on revoke (FR-22.4/FR-22.6, OQ-34's full-erase reading) therefore still
  needs a worker-user-owned write path (e.g. a sweep the next time worker-user touches that invitation's guests),
  since worker-admin has no presence in `guests` ownership today and gaining one is a bigger widening than one column
  on a table it already writes; flagged for architecture-analyst/Pram in `ownership.json`'s `invitations`/`guests`
  notes rather than decided here. No `expires_at_locked` column was added (OQ-30 is explicitly out of scope for this
  release; Pram ruled `expires_at` stays system-managed only, no staff manual override).
- **`v0.8.0`** (minor, NO TAG OF ITS OWN — see the note under this heading) - `tier.ts` gains event-based expiry + a check-in pre-window, a direct product-rule change
  from Pram (2026-09-20), additive on top of `v0.7.0`'s expiry section: `computeExpiresAtFromEvents(events, tier, opts?)` (basis =
  the LATEST effective end across `events`, where one event's effective end is `end_at` when present else 23:59:59.999 WIB on
  `start_at`'s WIB calendar day; falls back to `opts.activatedAt` when no event is usable, `null` when neither is; reuses
  `computeExpiresAt`'s exact month arithmetic via a new internal `addTierPeriodMonths` helper so the two can never diverge;
  `is_demo` is NOT handled here, matching `computeExpiresAt`'s own convention), `isCheckinWindowOpen(events, opts?)` and
  `CHECKIN_PRE_BUFFER_MINUTES` (60) for a QR check-in scanner's pre-event window (`now` in `[start_at - bufferMinutes, effective
  end]` of any event, inclusive; `testMode: true` always open; an invalid `bufferMinutes` falls back to the 60-minute default),
  and the new `EventWindow`/`ComputeExpiresAtFromEventsOptions`/`CheckinWindowOptions` exported types. Pure widening (new exports
  on the existing `./tier` entry); no `ownership.json` or `migrations.lock.json` change. One product-rule ambiguity was flagged
  back to Pram rather than guessed: an event with an `end_at` but no `start_at` never opens the check-in window (conservative
  choice — there is no principled way to place the pre-buffer without a start time); see this function's own doc comment in
  `src/tier.ts` and the implementing session's handoff report.
- **`v0.7.0`** (minor, tagged) - `tier.ts` gains the expiry helpers (BE-mono-28, doc 17 section 16): `isInvitationExpired`,
  `isInvitationLocked`, `getInvitationExpiryState`, `isDomainActive`, `parseTimestampMs`, `EXPIRY_GRACE_DAYS` (30). Demos (`is_demo === 1`)
  never expire; NULL `expires_at` = not expired; accepts UTC `Z`, `+07:00` offsets and zone-less SQLite datetimes (read as UTC). Pure
  widening (new exports on the existing `./tier` entry); no `ownership.json` or `migrations.lock.json` change.

- **`v0.6.0`** (minor, tagged) - `ownership.json` only. `events` gains `worker-admin` as a reader (eventAt countdown; pure widening,
  only worker-admin needs to bump). `invitations.is_demo` (migration 0022) is documented in the table note: it is in no app's writer
  allowlist (ops SQL only) and readable by all four apps via existing table-level access. Minor per section 3 (any `ownership.json` change).
- **`v0.5.0`** (minor, tagged) - `migrations.lock.json` gains `0020_invitation_purchased_addons` (BE-wl-27),
  `0021_domain_lifecycle_and_refunds` (BE-wl-34) and `0022_invitation_is_demo` (BE-wl-41), all purely additive. Minor, following the
  0.3.0 precedent (doc 16 section 6): a lock change is a lockstep DDL obligation (section 2), so a repo that merges the mirrored files
  must pin this version in the same change. `ownership.json`, `src/` and `dist/` are unchanged. `0020` (not the earmarked slot for
  BE-wl-03) is used contiguously because sync-migrations forbids gaps below the locked maximum. `v0.4.0` is still untagged.
- **`v0.4.0`** (minor, NO TAG OF ITS OWN — see the note under this heading) — tier x add-on model (BE-mono-23/24/25/26). `tier.ts` gains the
  effective-capability API (`parsePurchasedAddons`, `getEffectiveCapabilities`, `maxUsefulGalleryUnits`,
  `PHOTO_CEILING`, optional trailing `addons` param on `hasFeature`/`getEffectivePhotoCap`). **VALUE CHANGE
  (called out per doc 17 FR-1):** `TIER_CAPABILITIES.*.qrCheckin`/`customDomain` are now `false` at every tier
  (add-ons only; Premium/Exclusive previously `true`), `premium.durationMonths` 12 -> 6, `exclusive.durationMonths`
  null -> 12. Why minor and not major: §3 defines this package's minor as any `ownership.json`/export-surface change
  and the package is on `0.x` (no stability guarantee yet); no consumer has shipped gating on the changed values
  (BE-user-07/13/15 unbuilt) so nothing regresses, and consumers only see the new values when they choose to bump.
  `ownership.json` widenings, all pure widening (classify-release: 4 widening / 0 narrowing / 0 lockstep):
  `invitations.purchased_addons` (landing + admin write), `invitation_domains` (landing gets a column-scoped
  creation grant), new table `order_refunds` (admin write, landing read). No `migrations.lock.json` change: the
  migrations that create these columns/tables (BE-wl-27, BE-wl-34) will lock separately.
- **`v0.3.0`** (minor, tagged) — **entry reconstructed from git 2026-09-23; this release and
  `v0.1.2` were tagged and pushed but never written up here, which is why the history below
  jumped from `v0.1.1` to `v0.4.0`.** Rolls up `v0.2.0` (`BE-mono-22`: widened worker-admin's
  write grants — `clients`/`invitations` provisioning columns and `sections` — which is why
  `v0.2.0` has no tag of its own) plus: `migrations.lock.json` gains `0014`–`0019`;
  `bin/sync-migrations.mjs` and its tests (`OPS-shared-07`); `docs/SECRETS.md`, the per-Worker
  secrets list derived from `wrangler.toml`/`bindings.ts` (`DOC-mono-02`, extended with
  Turnstile / `CF_API_TOKEN` / `INTERNAL_KEY`); the README consumer guide (`DOC-shared-01`);
  the enforcement-layer test suite (`QA-mono-15`); and `.gitattributes` (`eol=lf`, which is
  what makes R7's migration hashing reproducible across Windows and Linux checkouts). Bump
  rule: **minor** on both counts — an `ownership.json` widening and a `migrations.lock.json`
  change, either one of which forces it under §3.

- **`v0.1.2`** (patch, tagged) — **entry reconstructed from git 2026-09-23, see `v0.3.0`.**
  A second `bin/check-ownership.mjs` R4 false-positive fix (`OPS-shared-21a`), the sibling of
  `v0.1.1`'s: R4 was matching `.prepare()`/`.batch()`/`.exec()` inside **doc-comment prose**,
  so a comment explaining the rule could trip the rule. Comment text is now ignored — the
  behaviour the R4 row in the README's rule table states. Also adds this repo's `CLAUDE.md`.
  Implementation-only (`ownership.json` and the `exports` map unchanged), hence patch per §3.

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
