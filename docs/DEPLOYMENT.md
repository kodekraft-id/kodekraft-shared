# Deployment runbook — the 4 `invitation-worker-*` apps

How to actually ship a release across the 4 independent Cloudflare Workers that consume
this package (`invitation-worker-landing`, `invitation-worker-user`, `invitation-worker-admin`,
`invitation-worker-undangan`). There is **no root `deploy.ps1`** — an earlier monorepo plan had
one, but the 4 repos stay separate permanently (binding decision, 2026-09-17;
`invitation-worker-landing/project-docs/12-cross-repo-integration-design.md`), so a "deploy"
is 4 independent `wrangler deploy`s, run by Pram, in a specific order, against **one shared**
Cloudflare D1 database (`undangan-db`).

This doc is the operational companion to `RELEASING.md` (which covers releasing *this
package*, `@kodekraft/shared`, not the 4 apps that depend on it) and to `docs/SECRETS.md`
(the full per-Worker secret list). Ground truth for the specifics below:
`invitation-worker-landing/project-docs/16-migration-rollout-plan.md` (migrations, sections
1–11) and `15-security-ops-runbook.md` (secrets/WAF/rate-limiting ops).

**Last verified: 2026-10-02.** The "Current rollout status" section (§2) is a point-in-time
snapshot and goes stale the moment a migration is applied or a repo is deployed — re-check it
against the sources cited above before following it blindly on a later date. The live record of
what is applied and deployed is `invitation-worker-landing/project-docs/14-progress-tracker.md`.

What changed since 2026-09-21:

- `INTERNAL_KEY` is retired. worker-admin and worker-user reach worker-landing as RPC over
  service bindings, so §4's ordering is now about RPC providers going first.
- A fifth Worker exists, **worker-resepsionis**. It does not consume this package, has no D1 or R2
  binding, and reaches the data only through worker-user (§4).
- `wrangler deploy` was granted to the main Claude session on 2026-09-24. `wrangler secret put` /
  `delete` and every D1 command with `--remote` stay Pram's alone.
- Workers now keep versions, so `wrangler rollback` gives a one-command code rollback (§8).

## Contents

- [1. Overview](#1-overview)
- [2. Current rollout status (point in time — re-verify before use)](#2-current-rollout-status-point-in-time--re-verify-before-use)
- [3. Step A — apply pending migrations to the shared D1](#3-step-a--apply-pending-migrations-to-the-shared-d1)
- [4. Step B — deploy the 4 Workers, in order](#4-step-b--deploy-the-4-workers-in-order)
- [5. Secrets checklist](#5-secrets-checklist)
- [6. The ownership guard: warn → throw rollout (`QA-shared-16`)](#6-the-ownership-guard-warn--throw-rollout-qa-shared-16)
- [7. `@kodekraft/shared` version bump/adoption (summary — full rules in `RELEASING.md`)](#7-kodekraftshared-version-bumpadoption-summary--full-rules-in-releasingmd)
- [8. Rollback](#8-rollback)
- [9. Post-deploy verification](#9-post-deploy-verification)

## 1. Overview

- **Independent `wrangler deploy`s, one per repo.** Each app repo builds and deploys itself
  (`pnpm run deploy`, typically `vite build && wrangler deploy`, run from inside that repo).
  Nothing here orchestrates them automatically. Every step below is a checklist run by hand, in
  order, by the main Claude session (deploys granted 2026-09-24) or by Pram. Migrations on the
  remote D1 and secrets are Pram's alone.
- **A fifth Worker, worker-resepsionis** (`resepsionis-invitation.kodekraft.id`, the check-in
  desk), deploys the same way but sits outside this package. It has no D1, no R2 and no
  migrations folder; everything goes through worker-user's `ResepsionisRpc` entrypoint.
- **One shared D1**, `undangan-db` (`database_id = 308d6c07-6f37-4a5a-9e8e-f200204fdc5d`),
  bound by the 4 app Workers. A migration is applied **once**, from any one repo (its
  `migrations/` folder is byte-identical across all 4 — enforced by `check:ownership`'s R7
  rule against `migrations.lock.json` in this package) — it is not per-Worker.
- **Two R2 buckets.** `undangan-media` is bound by worker-user, worker-admin and
  worker-undangan (not worker-landing, which doesn't handle media). Since 2026-10-01 it is also
  served publicly through `media-invitation.kodekraft.id` and its cache. `undangan-arsip`, the
  private Desain Custom PDF archive, is bound by worker-admin only.
- **`@kodekraft/shared` is a git-protocol dependency**, not npm-published. Each of the 4 apps
  pins its own tag independently in its own `package.json` — see §7.
- **Migrations are additive-first** (never a destructive `DROP`/rename in the same migration
  that ships the code depending on it), so applying a new migration to remote D1 is always
  safe to do *before* deploying the Worker code that uses the new columns/tables — the
  currently-deployed code lists its columns explicitly and simply ignores ones it doesn't
  know about yet. This is what makes "migrate first, then deploy code" the standing rule
  (§3/§4), not just a preference.

## 2. Current rollout status (point in time — re-verify before use)

**As of 2026-10-02:**

| What | State |
|---|---|
| Remote D1 | `0001`–`0035` applied (Pram applied `0033` and `0034` on 2026-10-01, `0035_staff_access.sql` on 2026-10-02). |
| `kodekraft-shared` | **`v0.24.0`** (2026-10-02, BE-mono-41, landing doc 30): a pure widening — worker-admin may write `clients.token_version` (the staff password reset revokes sessions) and a new `./temp-password` export. `migrations.lock.json` is unchanged at 35 entries (`0001`–`0035`). Tagged and pushed. |
| The 4 apps' pins | worker-landing, worker-user and worker-admin on **`#v0.24.0`** (each uses the new export or grant, deployed 2026-10-02). worker-undangan stays on **`#v0.23.0`**: a widening release needs no lockstep (RELEASING.md §2) and nothing it reads changed, so it moves on its next ordinary bump. worker-resepsionis does not depend on this package. |
| Ownership guard mode | **`throw` in all four** since 2026-10-02: worker-landing from its integration, worker-user since 2026-09-24, worker-admin and worker-undangan since 2026-10-02 (Pram's per-repo decision; §6). |

The rows below are the 2026-09-21–24 snapshot this section used to hold, kept as history:

| What | State |
|---|---|
| Migrations `0013`–`0026` | **APPLIED REMOTELY — corrected 2026-09-24.** This row said "authored and locked locally only" with a confirmed baseline of `0001`–`0012`. Both were stale: `wrangler d1 migrations list undangan-db --remote` returned **"No migrations to apply"** on 2026-09-24 with `0026` the highest file, so the whole `0013`–`0026` range is live. |
| Migrations `0027`–`0028` (`clients.email` NOCASE unique index; twelve enum-guard triggers) | **Authored and locked locally only**, shipped in `kodekraft-shared` **v0.14.0**. Neither changes any repo's `schema.ts` mirror, so — unlike `0026` — there is **no deploy-ordering hazard**: code and migration may land in either order. Both have a **prerequisite query in their own header that must be run first**; `0028`'s especially, because it does NOT fail on pre-existing bad rows. See §3. |
| `kodekraft-shared` itself | `package.json` says **`0.14.0`** (bumped 2026-09-24 for the `0027`/`0028` lock change), and **every tag in `RELEASING.md`'s version history is on the remote** — re-verified 2026-09-23 by comparing `git tag -l` against `git ls-remote --tags origin`. The "several versions not yet tagged and pushed" warning that stood here was true when written and is no longer. Three versions deliberately have no tag of their own (`v0.4.0`, `v0.8.0`, `v0.10.0`); their content shipped inside the next release, and `RELEASING.md` §6 marks each. |
| The 4 apps' `@kodekraft/shared` pin | **All four are on `#v0.14.0`** (moved 2026-09-24; `v0.14.0` is a lockstep release). They are not independent any more and must not be allowed to drift: `v0.14.0` is a lockstep release (it changes `migrations.lock.json`), and §7's rule is that a lock change moves all four pins together. If they ever disagree, the odd repo's `check:ownership` is validating against a different grant matrix than the rest. **Check the pin AND the installed copy** — on 2026-09-22 all four were pinned to `v0.13.0` while still holding 0.11.0/0.12.0 on disk, so re-run `pnpm install` after any pin change. |
| The ownership guard's mode per repo | **Not uniform — read §6 before deploying.** worker-user and worker-undangan wire `getDb(..., { mode: "warn" })` explicitly. worker-landing's `src/db.ts` calls `getDb(env.DB, "worker-landing")` with **no mode argument**, which defaults to `"throw"` — confirmed directly in that file's own code and header comment as of this writing. **Resolved since this was written:** that is the rollout state, not an accident — worker-landing is the one repo already flipped to `throw`, and worker-user, worker-admin and worker-undangan are still in their log-only soak. `QA-shared-16` tracks the per-repo flip and the transition is tested in all four (`warn` logs `db.ownership.violation` and the statement still executes; `throw` refuses the identical write at `prepare()`; the default is `throw`, so `warn` is always an explicit opt-in). |

(History ends here.) As of 2026-10-02, the next release step is Pram applying `0035` (§3). No
Worker has to be redeployed for it: the deployed code already handles both states.

## 3. Step A — apply pending migrations to the shared D1

> **Range check, updated 2026-09-24. Do not trust the numbers in this file's prose — they have
> now gone stale twice.** On 2026-09-23 this section said `0013`–`0023` when the lineage ran to
> `0026`; today it said `0026` when the lineage runs to **`0028`**. Before applying anything,
> run `ls invitation-worker-landing/migrations/` and `wrangler d1 migrations list undangan-db
> --remote`, and take the range from those two, not from here.
>
> **State as of 2026-10-02:** `0001`–`0034` are applied remotely; `0035` is pending. The
> paragraph below about `0027`/`0028` is kept because the lesson generalises: **read every
> pending migration's header before applying it**, since some carry a prerequisite query.
>
> **State as of 2026-09-24 (history):** `0001`–`0026` were applied remotely (`--remote` reported
> "No migrations to apply"). `0027` and `0028` were pending.
>
> **`0027` and `0028` each carry a prerequisite query in their own file header, and they fail
> differently — which matters more than it sounds.** `0027` (unique index on `email COLLATE
> NOCASE`) **fails loudly** if a colliding pair already exists: it writes nothing, but the
> migration stops and the merge is manual. `0028` (enum-guard triggers) **does not fail at
> all** on pre-existing bad rows — a trigger only sees new writes. So skipping `0028`'s six
> `NOT IN (...)` checks leaves a bad row sitting behind a guard that looks like it is holding.
> Run both headers' queries before applying.

**Do this before deploying any Worker whose code reads/writes a column from these
migrations.** Full command list, per-migration rollback SQL, and the "what each migration
unlocks" table are in `invitation-worker-landing/project-docs/16-migration-rollout-plan.md`
— this section is the condensed procedure, not a replacement for it.

1. **Tag and push `kodekraft-shared` first** so its `migrations.lock.json` (35 entries as of
   `v0.23.0`) is resolvable by the 4 apps once they bump their pin — see §7. A repo that
   merges a mirrored migration into its own `migrations/` folder before bumping its
   `@kodekraft/shared` pin will fail `check:ownership`'s R7 rule ("unexpected file — not
   present in migrations.lock.json"). **Already done for `v0.23.0`:** tagged, pushed, and all
   four pins moved on 2026-10-01.
2. **Back up remote D1** (run from any app repo, since the D1 is shared). Use `../`, not
   `..\`, in Git Bash. A backslash there once produced a file name nobody could find:
   ```bash
   npx wrangler d1 export undangan-db --remote --output ../undangan-db-pre-<NNNN>.sql
   ```
   Backups stay on the local machine. They hold customer data, so never upload them to an
   outside service.
3. **List, then apply.** The list must show exactly the files you expect. Stop on anything
   else. `wrangler` applies every not-yet-applied file in `migrations/` in order and skips
   already-applied ones by filename (recorded in `d1_migrations`):
   ```bash
   npx wrangler d1 migrations list undangan-db --remote
   npx wrangler d1 migrations apply undangan-db --remote
   ```
4. **Verify** (see doc 16 §4/§9/§10 for the exact per-batch `SELECT`/`pragma_table_info`
   checks — they confirm the new columns/tables exist and that every existing row reads a
   safe default, e.g. `is_demo = 0`, `checkin_test_mode = 0`, for every pre-existing
   invitation/guest).
5. **Run the one-off backfill scripts that depend on this batch, in this order, only after
   the deploy sequence in §4 reaches the point their own preconditions name:**
   `scripts/backfill-package-tier.mjs` (needs `0014`; dry-run first, then `--apply`;
   worker-landing) and `scripts/backfill-expires-at.mjs` (needs `0014`–`0026` applied **and**
   worker-user already deployed with the event-basis recompute — see doc 16 §11 for why the
   ordering matters and its own known-demo safety check). Neither is a migration; both are
   idempotent, dry-run-by-default, human-run scripts — never run automatically by a deploy.

Migrations are never rolled back as part of a normal deploy (§8 covers the rare case where
one genuinely must be).

## 4. Step B — deploy the 4 Workers, in order

**Standing rules (2026-10-02).** Most releases now touch one or two repos, not all four. Order
them by these rules, then use the table below as the default for a release that touches every
repo:

1. **Migrate first** (§3), whenever the code names a column or table the migration adds.
2. **RPC providers before their consumers**, whenever an RPC surface changes:
   - worker-landing before worker-admin (`LANDING`: order reprovision, resend activation, the
     staff reminder);
   - worker-landing before worker-user (`LANDING`: add-on purchase from the dashboard);
   - worker-user before worker-resepsionis (`USER`, entrypoint `ResepsionisRpc`).

   Each consumer types the provider's methods as a mirrored interface, so a consumer deployed
   ahead of its provider calls a method that is not there yet.
3. **worker-admin's add-on endpoints and their UI ship together** (callout below).
4. **Verify against the live URL after every deploy**, and record the version id and the
   rollback id (§8) in the tracker.

**Default for a full release: worker-user → worker-undangan → worker-landing → worker-admin.** This is a specific
ruling for this rollout, not a fixed law of the architecture — an earlier design doc
(`invitation-worker-landing/project-docs/03-architecture-design.md`, explicitly marked
partially superseded) once proposed `undangan → user → admin → landing` for the abandoned
root-`deploy.ps1` monorepo plan. That row is stale and describes a plan that was rejected;
follow the order below instead. Reasons found/confirmed for each adjacent pair, so a future
change to this order is made deliberately rather than by habit:

| Order | Repo | Why it goes here |
|---|---|---|
| 1 | **worker-user** | Its `schema.ts` mirrors the `0014`–`0026` columns (`package_tier`, `activated_at`, `expires_at`, `photo_cap_override`, `purchased_addons`, `is_demo`, `checkin_test_mode`, `event_label`, …). Every invitation-scoped request selects these columns explicitly, so deploying worker-user against a D1 that doesn't have them yet fails with "no such column" — confirmed by the migration-rollout plan and the progress tracker alike. **This is why §3 must fully complete first.** worker-user is also the *only* app that writes `activated_at`/`expires_at`/the event-based expiry recompute at runtime — deploying it first means every other app immediately sees correct values instead of stale/NULL ones. |
| 2 | **worker-undangan** | worker-undangan's Cache API layer keys its cached guest-facing HTML on `invitations.updated_at`. worker-user bumps that column on every public-page content edit. Deploying worker-user *before* (or together with) worker-undangan means a guest never sees stale content for up to the cache's 24h lifetime — deploying in the other order risks exactly that window. (worker-undangan also needs Turnstile configured before it can accept real guest submissions at all — see §5 — independent of this ordering.) |
| 3 | **worker-landing** | Storefront/checkout. Provisions new `clients`/`invitations`/`sections` rows that worker-user's dashboard and worker-undangan's renderer both immediately need to serve correctly (tier, purchased add-ons, demo flag) — deploying it after those two are already live and schema-complete means a brand-new purchase is servable end-to-end the moment checkout succeeds, with no gap where the buyer's new invitation exists but the app that's supposed to show it doesn't yet understand its columns. Landing's own "Lihat Demo" links point at worker-undangan, so worker-undangan should already be serving correctly before landing sends real traffic there. |
| 4 | **worker-admin** | Two hard dependencies on worker-landing already being live: (a) worker-admin calls worker-landing over a Cloudflare **service binding** (`LANDING`) for order reprovision/resend-activation — the binding only resolves once `worker-landing` is deployed under that exact Worker name; (b) the RPC methods worker-admin calls must already exist on the deployed worker-landing. Before `OPS-wl-06` (2026-09-24) these calls also needed a shared `INTERNAL_KEY`; RPC needs none. Deploying admin last also means its add-on grant/revoke UI (see the callout below) is shipped against a storefront that has already finished writing the columns (`purchased_addons`, etc.) that UI reads and writes. |

**A repo-internal rule, not an inter-repo ordering one, but just as deploy-blocking: worker-admin's add-on endpoints and their UI must ship in the same deploy window.** Concrete precedent already hit twice in this project: a backend change to `PATCH /api/invitations/:id/addons`'s accepted request shape shipped once with its UI update landing in the same commit (`FE-admin-11` alongside `BE-admin-18/22/23`) specifically because the *previous* UI sent a request shape the *new* backend would reject — and again for the domain-registration/refund queues (`FE-admin-12/13` alongside `BE-admin-19/20`). Before deploying worker-admin, diff what the currently-shipped frontend sends for these endpoints against what the currently-shipped backend now expects; if they've diverged, ship both together or hide the affected UI control until they can.

Per-repo preconditions checklist (in addition to the ordering above):

- [ ] **Before worker-user:** §3 fully applied and verified on remote D1. `JWT_SECRET` /
      `REFRESH_TOKEN_SECRET` set (§5).
- [ ] **Before worker-undangan:** `TURNSTILE_ENABLED` matches the decision in force. It is
      `"false"` since 2026-09-25, so Turnstile is not consulted and `GUEST_LIMITER` guards the
      D1 write quota. If the gate is switched back on, `TURNSTILE_SECRET` and
      `TURNSTILE_SITE_KEY` must be set, with the widget covering `invitation.kodekraft.id` and
      every live custom domain. Deployed without them, **every** real guest RSVP/wish/gift
      submission is rejected (fail-closed by design, not a bug to work around).
- [ ] **Before worker-landing:** `MIDTRANS_SERVER_KEY` set (§5), `workers_dev = true` still in
      `wrangler.toml` (Midtrans' notification URL is the workers.dev address, outside Bot Fight
      Mode). **AND every migration its INSERTs name is applied — this one is on the money
      path.** worker-landing's provisioning batch names its columns, so deploying it against a
      D1 missing one makes **every paid order's provisioning batch fail**: the buyer is charged
      and gets nothing. (`0026`/`event_label` was the first case:
      `invitation-worker-landing/project-docs/16-migration-rollout-plan.md` §12.)
- [ ] **Before worker-admin:** worker-landing already deployed (service-binding resolution);
      the `undangan-arsip` bucket exists (the `ARSIP` binding fails the deploy otherwise);
      `CF_API_TOKEN` set if custom domains are in active use; the add-on UI/backend pairing
      above checked.
- [ ] **Before worker-resepsionis:** worker-user already deployed with the `ResepsionisRpc`
      methods the new build calls.

## 5. Secrets checklist

Full list with purpose/required-or-not per Worker: `docs/SECRETS.md` in this repo. **Never
write an actual secret value in any doc, commit message, or chat** — the table below only
names which secret goes where and why it matters for deploy *ordering/coordination*
specifically (the cross-repo ones), not the full per-Worker list:

| Secret | Where | Coordination note |
|---|---|---|
| `INTERNAL_KEY` | **retired** (still present on worker-landing and worker-admin until Pram deletes it) | Nothing reads it since `OPS-wl-06` (2026-09-24). Do not set it on any new deploy. `docs/SECRETS.md` "Rules" has the clean-up. |
| `STAFF_ALERT_WA` / `STAFF_ALERT_EMAIL` | worker-landing only | Also serve worker-admin's `*/30` staff-reminder cron, which asks worker-landing over RPC to send. So the destinations live in one Worker only, never in worker-admin. |
| `CF_PURGE_TOKEN` | worker-user **and** worker-admin | Set in each (one token may serve both). Without it, deleted media stays in the `media-invitation.kodekraft.id` cache. |
| `CF_API_TOKEN` | worker-admin only | Needed only once custom domains are in use (`Zone:Zone:Read` + `Zone:Workers Routes:Edit`, never a Global API Key). Unset → domain verify/activate/remove fail closed with RC 99; everything else in worker-admin still works. |
| `TURNSTILE_SECRET` | worker-undangan only | Only read while the gate is on (`TURNSTILE_ENABLED` is `"false"` since 2026-09-25). Gate on and secret unset: **fail-closed**, every guest RSVP/wish/gift submission is rejected, not silently allowed. Take the secret and site key from the *same* Turnstile widget (`docs/SECRETS.md` §"Getting the Cloudflare-issued values"). |
| `TURNSTILE_SITE_KEY` | worker-undangan only | Public, not a secret. Production currently stores it as a secret, and a `[vars]` entry works equally well; keep it in one place. Must come from the same widget as `TURNSTILE_SECRET` above. |
| `MIDTRANS_SERVER_KEY` | worker-landing only | Governs both Snap API calls and webhook signature verification. Sandbox keys start `SB-Mid-server-...`, production keys `Mid-server-...` — the key type must match `MIDTRANS_IS_PRODUCTION`'s `[vars]` setting, or payments silently run against the wrong environment. |
| `JWT_SECRET` / `REFRESH_TOKEN_SECRET` | worker-user **and** worker-admin, separately | Each app has its own pair — **do not reuse worker-user's pair for worker-admin or vice versa** (separate identity tables; a shared key would let a token from one app authenticate against the other). |

## 6. The ownership guard: warn → throw rollout (`QA-shared-16`)

Every one of the 4 apps' D1 composition root calls `@kodekraft/shared`'s `getDb(binding, app,
{ mode })` (see this package's own `README.md` for what the guard does). The intended rollout,
per `QA-shared-16` in `invitation-worker-landing/project-docs/05-task-breakdown.md`: every
repo ships the guard in `"warn"` mode (logs a `db.ownership.violation` event, never blocks the
request) for one full deploy cycle, so real production traffic can be observed for violations
`check:ownership`'s static analysis can't see, **before** anyone flips that repo's mode to
`"throw"` (blocks the write). `QA-shared-16` itself — the task that formally signs off on that
flip, per repo — is ticked. On 2026-09-24 it forced `throw` across every warn repo: worker-user
failed 30 tests (real out-of-matrix writes, fixed, then flipped), while worker-admin and
worker-undangan came out clean and stayed on `warn` by choice. A clean suite does not prove
that the paths no test covers obey the matrix, so flipping each was a per-repo decision. **Pram
took it on 2026-10-02** (`invitation-worker-landing/project-docs/12-cross-repo-integration-design.md`
§10 item 2): both suites passed under a forced `throw` a second time, a 16-minute production
tail showed no `db.ownership.violation`, and both were flipped and deployed the same morning.

**Confirmed current mode per repo, 2026-10-02 (verify directly in each repo's composition root
before relying on this table — it will go stale):**

| Repo | Composition root | Mode |
|---|---|---|
| worker-landing | `src/db.ts` | **`"throw"`** (the default; no `mode` option is passed). Deliberate, per that file's header. |
| worker-user | `src/worker/db/client.ts` | **`"throw"`**, explicit, since 2026-09-24. That file's header records what the flip found. |
| worker-admin | `src/worker/db/client.ts` | **`"throw"`**, explicit, since 2026-10-02 (`BE-admin-44`, deployed as version `6d8a7d9d`). |
| worker-undangan | `src/db/client.ts` | **`"throw"`**, explicit, since 2026-10-02 (`BE-undangan-21`, deployed as version `89bdb5d6`). |

Each repo has a test, `qa-shared-16-guard-modes.test.ts`, that pins its shipped mode through
the repo's own `getDb`. A revert to `warn` fails it, and whoever reverts has to say why there.
worker-admin and worker-undangan have no `[observability]` block, so a refused write leaves no
searchable trail. It surfaces as a failed request (RC 99) and in a live `wrangler tail`. If a
legitimate path ever trips the guard, the fix is a reviewed `ownership.json` change or a code
fix, never a quiet switch back to `warn`.

**After deploying a repo in `"warn"` mode:** watch its logs for a soak period (several days,
covering at least one real order → provision → edit cycle):

```bash
wrangler tail <worker-name> --format json | grep db.ownership.violation
```

Zero events over the soak period is the acceptance bar for flipping that repo's `getDb` call
to `{ mode: "throw" }` (or removing the option, since `"throw"` is the default) and
redeploying. Any event found is a real gap between the deployed code and `ownership.json` —
fix the code or widen the matrix (a real, reviewed decision — see §7) before flipping, not
after.

## 7. `@kodekraft/shared` version bump/adoption (summary — full rules in `RELEASING.md`)

Full rules, worked examples, and the version history of what shipped in each release are in
this package's own `RELEASING.md`. Summary relevant to a deploy:

- **Widening** (new write grant, new column/table, new export): only the app that needs it
  bumps its pin. The other 3 can stay on an older tag indefinitely.
- **Narrowing** (a revoked write, a tightened column list, a stricter static rule): the
  narrowed app must bump **and deploy** before the change is anything more than paper — the
  matrix isn't "enforced" for that app until its new code is actually live.
- **A `migrations.lock.json` change is a lockstep DDL obligation regardless of
  widening/narrowing**: the new migration file must exist, byte-identical, in **all 4** app
  repos' `migrations/` folders before *any* of them bumps past the version whose lock includes
  it — otherwise `check:ownership`'s R7 rule fails that repo's CI with "unexpected file."
- A tag must be **pushed** to `github.com/kodekraft-id/kodekraft-shared`, not just committed
  locally, before any consumer's `pnpm add`/`pnpm install` can resolve it (§2's table above
  lists what's pushed vs. local-only as of this writing).

## 8. Rollback

- **This package (`@kodekraft/shared`) itself**: revert a consumer to the previous tag —
  `pnpm add github:kodekraft-id/kodekraft-shared#v<previous>`, commit the
  `package.json`/`pnpm-lock.yaml` diff. No rebuild/republish step exists since there's no npm
  registry in this flow (`RELEASING.md` §5).
- **Worker code**: Workers keep versions, so the fast path is
  `npx wrangler rollback <version-id>`, run inside that Worker's repo. Every deploy entry in the
  progress tracker records the version it replaced as "rollback `<id>`" for exactly this.
  `npx wrangler deployments list` shows recent versions if the tracker lacks one. The slow
  path is re-running `pnpm run deploy` from the previously-released commit
  (`git checkout <previous-tag-or-commit> && pnpm install && pnpm run deploy`). Either way,
  verify the live URL afterwards. Never roll back Worker code to a version older than the D1 schema
  it now runs against without also considering the migration rollback below — a rolled-back
  Worker that predates a column the *current* schema requires can still run fine (migrations
  are additive; old code just ignores new columns), but a Worker rolled back to before a
  column it *used to* rely on was dropped will break.
- **Migrations**: the default rollback for every migration in `0013`–`0035` is "leave it in
  place". `0013`–`0028` are purely additive (new nullable/defaulted columns or new tables), and
  `0029`–`0035` contain no `DROP`, rename, table rebuild or `DELETE` (re-checked 2026-10-02).
  Some do add triggers, so read a migration's own header before assuming it is inert. An
  unused column/table is harmless even if the code that would populate it is rolled back. A true rollback (accepting data loss in the new columns/tables) is documented
  per-migration, newest-first, as literal `ALTER TABLE ... DROP COLUMN` / `DROP TABLE` SQL in
  `invitation-worker-landing/project-docs/16-migration-rollout-plan.md` §5/§9/§10 — run it
  manually via `wrangler d1 execute --remote`, and **always roll the Worker code back first**,
  never the schema first (a live Worker still reading/writing a column you just dropped will
  start erroring on every request that touches it). Restoring from the pre-migration
  `wrangler d1 export` backup (§3 step 2) is the last resort — it also reverts any real data
  written since the export, not just the migration's own columns.

## 9. Post-deploy verification

- [ ] `wrangler d1 migrations list undangan-db --remote` shows every migration through the
      one you intended applied, and nothing pending beyond it.
- [ ] Each app's own test suite passed on the commit that was deployed (exact current counts
      are in `invitation-worker-landing/project-docs/14-progress-tracker.md`, and each repo's
      GitHub CI runs typecheck, tests and build on every push — check it is green).
      worker-landing has no formal smoke-test-against-prod script beyond
      `scripts/pay-smoke.mjs`, which targets a dev server, not production.
- [ ] Live checks after each deploy: `GET /health` (worker-landing) or `GET /api/health`
      (worker-admin) answers 200; the deployed page loads its current asset bundle; an
      unauthenticated `GET` of a protected API answers 401; the storefront webhook answers 403
      to a forged signature (from the worker, not a Cloudflare challenge).
- [ ] End-to-end when a flow changed: storefront loads (`kodekraft.id`), a sandbox checkout
      completes and provisions an account, the buyer can sign in on worker-user, a guest link
      opens on worker-undangan and an RSVP submits successfully, worker-admin's login and
      invitation list work, and (for worker-resepsionis) the check-in desk signs in with link +
      PIN.
- [ ] `wrangler secret list` (run in each Worker's own repo) confirms every required secret
      from §5/`docs/SECRETS.md` is set — names only, never values.
- [ ] Per §6, start the `wrangler tail ... | grep db.ownership.violation` watch for any repo
      newly deployed or newly flipped to `"warn"` mode.
