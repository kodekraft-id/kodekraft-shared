# Per-Worker secrets and bindings (DOC-mono-02)

Secrets are never in `wrangler.toml` or git. Set each one on the deployed Worker with
`wrangler secret put <NAME>` (run from that Worker's repo), and locally in the gitignored
`.dev.vars`. A Worker deployed with a required secret unset does not fail at deploy time, only
at request time, so check this list on every fresh deploy.

Derived from each repo's `wrangler.toml`, `.dev.vars.example` and `src/**/bindings.ts`
(the `Env` interface). If a binding is added, update this file in the same change.

**Re-verified 2026-10-02** against all five repos' `wrangler.toml` and `Env` interfaces and
against `wrangler secret list` on each deployed Worker (names only). The previous version was
from before the staff alerts, media CDN, Desain Custom archive, staff access, the
`*/30` cron and worker-resepsionis existed. It still told you to keep `INTERNAL_KEY` in sync,
which has been retired since 2026-09-24.

- [Where secrets live](#where-secrets-live)
- [worker-landing](#worker-landing-kodekraftid)
- [worker-user](#worker-user-dash-invitationkodekraftid)
- [worker-admin](#worker-admin-adm-invitationkodekraftid)
- [worker-undangan](#worker-undangan-invitationkodekraftid)
- [worker-resepsionis](#worker-resepsionis-resepsionis-invitationkodekraftid)
- [Shared](#shared)
- [Getting the Cloudflare-issued values](#getting-the-cloudflare-issued-values)
- [After every fresh deploy](#after-every-fresh-deploy)

## Where secrets live

| What | Production | Local dev |
|---|---|---|
| Secrets (API keys, signing keys, shared keys) | `wrangler secret put NAME`, run inside **that Worker's repo**. Stored encrypted in Cloudflare, per Worker, and never shown again after you enter them. | Gitignored `.dev.vars`, copied from that repo's `.dev.vars.example` (this stack uses `.dev.vars`, **not** `.env`). |
| Non-secret settings (URLs, site keys, TTLs) | `[vars]` in that repo's `wrangler.toml` (committed). | Same `[vars]`, optionally overridden in `.dev.vars`. |

Rules:

- Never commit a secret and never paste one into chat, an issue, a commit message or a doc. Only
  put obviously fake values or Cloudflare's public test values in `.dev.vars.example`.
- `wrangler secret list` (run in that Worker's repo) shows secret **names only**, never values.
  Use it to check a fresh deploy. To change a value, run `wrangler secret put NAME` again.
- Secrets are per Worker: setting `CF_PURGE_TOKEN` on worker-user does nothing for worker-admin.
  Set it on each Worker that lists it.
- Generate random values with:
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- **`INTERNAL_KEY` is retired** (`OPS-wl-06`, 2026-09-24). worker-admin and worker-user call
  worker-landing as RPC over a service binding, which has no URL and needs no shared secret.
  Nothing reads the key any more, but it still exists on worker-landing and worker-admin. Pram
  deletes it with `wrangler secret delete INTERNAL_KEY` in both repos, and the `INTERNAL_KEY?`
  field comes out of both `bindings.ts` in the same change. Never set it on a new deploy.
- `JWT_SECRET` and `REFRESH_TOKEN_SECRET` must differ from each other, and worker-user's pair must
  differ from worker-admin's pair (separate identity tables per app; a shared key would let a token
  from one app be accepted by the other).

## worker-landing (`kodekraft.id`)

| Secret | Required | If unset |
|---|---|---|
| `MIDTRANS_SERVER_KEY` | yes | checkout and webhook signature verification cannot work |
| `RESEND_API_KEY` | optional | activation/notification email is skipped |
| `WA_GATEWAY_TOKEN` | optional | WhatsApp notification is skipped (buyers and staff alike: the staff alerts below go out through the same Fonnte gateway) |
| `STAFF_ALERT_WA` | optional | staff WhatsApp destinations, `628…`, comma-separated. Used for the instant "paid but not provisioned" alert (`BE-wl-51`), the `*/30` reminder that worker-admin's cron asks worker-landing to send (`BE-admin-37`), and the "⚡ Pesanan Express" alert (`BE-wl-57`). Unset: nothing is sent. The order history records the alert as `not_configured`, and the order still shows in the admin "Butuh tindakan" queue / Express badge. An Express order paid while this is unset is **not** re-alerted later: the alert is once per order, ever |
| `STAFF_ALERT_EMAIL` | optional | as `STAFF_ALERT_WA`, by email through Resend. Only works once the sending domain is verified at Resend |
| `INTERNAL_KEY` | **retired** | nothing reads it; see [Rules](#where-secrets-live). Still present on the live Worker until Pram deletes it |

As of 2026-10-02 the live Worker holds `MIDTRANS_SERVER_KEY`, `RESEND_API_KEY`,
`WA_GATEWAY_TOKEN` and the retired `INTERNAL_KEY`. Neither `STAFF_ALERT_*` secret is set yet
(checklist task "Pasang nomor WA staf").

Non-secret `[vars]` in `wrangler.toml`: `WA_NUMBER` (the storefront's WhatsApp buttons;
**still the placeholder `6281234567890`** until Pram supplies the real business number),
`INVITATION_BASE_URL`, `BRAND_NAME`, `SITE_BASE_URL`, `DASH_BASE_URL`, `ADMIN_BASE_URL` (links
inside staff alerts), `MIDTRANS_IS_PRODUCTION`, `MAIL_FROM`, `WA_GATEWAY_URL`.

Other settings and bindings:

- D1 `DB`, plus four rate-limit namespaces: `CHECKOUT_LIMITER` 5101 (10/min),
  `WEBHOOK_LIMITER` 5102 (300/min), `ORDER_STATUS_LIMITER` 5103 (40/min) and
  `RESEND_LIMITER` 5104 (5/min). They need no secret and are optional in code, so an absent
  binding only skips rate limiting.
- `workers_dev = true`. Midtrans' notification URL points at
  `https://worker-landing.pramesty-jaya.workers.dev/api/webhook/midtrans`, which lies outside the
  `kodekraft.id` zone and so outside Bot Fight Mode, which challenged Midtrans' server-to-server
  POSTs on 2026-09-29. Removing this line breaks the webhook.
- `[observability]` is on, so Workers Logs keeps every request's log for the plan's retention.
- worker-landing exposes RPC methods that worker-admin and worker-user call over their `LANDING`
  service bindings (`src/internal-rpc.ts`). Deploy worker-landing **before** either of them
  whenever that surface changes.

`MIDTRANS_IS_PRODUCTION` must be flipped to `"true"` deliberately for production, and the key
type must match (`SB-Mid-server-...` for sandbox, `Mid-server-...` for production).

## worker-user (`dash-invitation.kodekraft.id`)

| Secret | Required | If unset |
|---|---|---|
| `JWT_SECRET` | yes | access-token signing/verification cannot work, including the 60-minute staff-access tokens (doc 27), which are signed with the same key plus a `sas` claim |
| `REFRESH_TOKEN_SECRET` | yes | refresh-token flow cannot work |
| `CF_PURGE_TOKEN` | optional | when an owner deletes a photo, its copy in the `media-invitation.kodekraft.id` cache is not purged (the skip is logged), so the deleted photo can stay reachable from cache. See [section 4](#4-cf_purge_token-and-cf_zone_id-worker-user-and-worker-admin-media-cache-purge) |

As of 2026-10-02 the live Worker holds all three.

Use different values for `JWT_SECRET` and `REFRESH_TOKEN_SECRET`, and different values from
worker-admin's (see "Where secrets live"). Non-secret `[vars]`: `JWT_EXPIRES_IN_SEC`,
`REFRESH_EXPIRES_IN_SEC`, `PUBLIC_INVITATION_BASE_URL`, `RESEPSIONIS_BASE_URL` (links handed to
check-in staff), `CORS_ALLOWED_ORIGINS` (comma-separated allowlist, default is the production
dashboard origin; the SPA is same-origin so this only matters for explicit cross-origin callers),
`CF_ZONE_ID` (zone id of `kodekraft.id`, an identifier rather than a credential) and
`MEDIA_BASE_URL` (`https://media-invitation.kodekraft.id`, used to build the URLs to purge).

Bindings: D1 `DB`, R2 `MEDIA`, rate-limit namespaces `LOGIN_LIMITER` (5201, 10/min) and
`FORGOT_LIMITER` (5202, 5/min), declared in `wrangler.toml` and optional in code (no secret
needed), and the service binding `LANDING` -> `worker-landing`. That binding is used as RPC for
one thing only: buying an add-on from the dashboard. The money stays with worker-landing, so
this Worker never holds a Midtrans key. Rate-limit namespace ids are account-scoped and must stay
unique across Workers.

worker-user also **exposes** the RPC entrypoint `ResepsionisRpc`, which worker-resepsionis
binds to. Deploy worker-user before worker-resepsionis whenever that surface changes.

## worker-admin (`adm-invitation.kodekraft.id`)

| Secret | Required | If unset |
|---|---|---|
| `JWT_SECRET` | yes | as worker-user |
| `REFRESH_TOKEN_SECRET` | yes | as worker-user |
| `CF_API_TOKEN` | only for custom domains | domain Verifikasi / Aktifkan / Hapus fail closed with RC 99; everything else works |
| `CF_ANALYTICS_API_TOKEN` | for usage monitoring and Statistik Traffic | the daily usage-monitoring cron logs `usage_monitoring.skipped` and returns without calling Cloudflare — **you get no free-tier ceiling alerts at all** — and the Statistik Traffic page shows its Cloudflare part as "belum terhubung" (its D1 numbers still show) |
| `CF_ACCOUNT_ID` | with `CF_ANALYTICS_API_TOKEN` | as `CF_ANALYTICS_API_TOKEN`: either one missing skips the cron. An identifier, not a credential, so `[vars]` is fine too, but production has it as a **secret** (since 2026-09-23). Keep it in exactly one of the two places |
| `CF_PURGE_TOKEN` | optional | objects the media-retention cron deletes from R2 stay in the `media-invitation.kodekraft.id` cache until it expires (the skip is logged as `media_cache.purge_skipped`) |
| `INTERNAL_KEY` | **retired** | nothing reads it; see [Rules](#where-secrets-live). Still present on the live Worker until Pram deletes it |

As of 2026-10-02 the live Worker holds all of the above, including the retired `INTERNAL_KEY`.

`CF_API_TOKEN` is a Cloudflare API token with exactly `Zone:Zone:Read` and
`Zone:Workers Routes:Edit` (see "Getting the Cloudflare-issued values"). Never a Global API Key.

`CF_ANALYTICS_API_TOKEN` is a **separate, least-privilege** token with only
`Account Analytics:Read` — deliberately not the same token as `CF_API_TOKEN` above, which can
edit Workers routes. Pointing both secrets at one token works if you would rather provision
only one; the split is a precaution, not a requirement.

Non-secret `[vars]`: `JWT_EXPIRES_IN_SEC`, `REFRESH_EXPIRES_IN_SEC`, `PUBLIC_INVITATION_BASE_URL`
(unused by admin, kept so shared types compile), `DASHBOARD_BASE_URL` (base of the one-time
staff-access links, doc 27), `UNDANGAN_WORKER_NAME` (script name that custom-domain routes point
at; `worker-undangan`), `CF_ZONE_ID` and `MEDIA_BASE_URL` (as worker-user, for the purge).

Bindings:

- D1 `DB` and R2 `MEDIA` (`undangan-media`).
- R2 `ARSIP` -> `undangan-arsip`, the private Desain Custom PDF archive. The bucket must exist
  **before** a deploy, which fails on a binding to a missing bucket.
- Service binding `LANDING` -> `worker-landing`, used as RPC for order reprovision, resend
  activation and the staff reminder. Deploy worker-landing first so the binding can resolve.

worker-admin is the only Worker with `[triggers]`, three of the account's five free cron
triggers:

- `0 3 * * *`: media retention.
- `0 23 * * *`: usage monitoring.
- `*/30 * * * *`: staff reminder for paid orders stuck more than 10 minutes, one reminder each.
  worker-landing sends it, so its destinations are worker-landing's `STAFF_ALERT_*`.

Two optional `[vars]` are **deliberately left out of `wrangler.toml`**, so a fresh deploy starts
in the safe state:

| Var | Unset (default) | Set it to |
|---|---|---|
| `MEDIA_RETENTION_MODE` | media-retention cron runs **dry** — logs the R2 objects it would delete, deletes nothing | `"enabled"`, and only after reading a few nights of dry-run logs and agreeing with what they list. This cron permanently deletes R2 objects; there is no undo |
| `WORKERS_PLAN` | Statistik Traffic measures against the Workers **Free** limit (100,000 requests/day) | `"paid"` after upgrading to Workers Paid |

Leaving both unset is a valid first deploy: the Worker serves traffic normally, and the
retention cron only logs.

## worker-undangan (`invitation.kodekraft.id`)

**The Turnstile gate is switched off** (`TURNSTILE_ENABLED = "false"` in `[vars]`, Pram's call on
2026-09-25 after a broken widget blocked real guests). With the gate off, neither Turnstile value
is read. The per-IP `GUEST_LIMITER` (7301, 20 guest POSTs/min) is what protects the shared D1
write quota. It is not a bot filter.

| Secret | Required | If unset |
|---|---|---|
| `TURNSTILE_SECRET` | only while the gate is on | gate on: **fail closed**, every guest RSVP / wish / gift submission is rejected |
| `TURNSTILE_SITE_KEY` | only while the gate is on | gate on: the widget is not rendered while the backend still demands a token, so guests cannot submit either. Public, so `[vars]` works too; production has it as a secret. Keep it in exactly one place |

Both are set on the live Worker as of 2026-10-02, so switching the gate back on is a
`[vars]` change plus checking the widget's hostname list (section 1).

Non-secret `[vars]`: `TURNSTILE_ENABLED` (absent means **on**, so turning it off has to be a
written decision), `MEDIA_BASE_URL` (`https://media-invitation.kodekraft.id`: photos and music
load through the R2 custom domain and its cache. Empty, as in local `.dev.vars`, means the
Worker's own `/media/*` route, which stays alive for old links). Bindings: D1 `DB`, R2 `MEDIA`,
rate-limit namespace `GUEST_LIMITER`.

Local dev: `.dev.vars.example` holds Cloudflare's public always-pass test keys (site key
`1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`); use those only locally.
Deploy order and smoke test: that repo's `project-docs/09-deployment.md`.

## worker-resepsionis (`resepsionis-invitation.kodekraft.id`)

No secrets (`wrangler secret list` is empty, by design). The Worker has no D1 or R2 binding:
every read and write goes through the service binding `USER` -> `worker-user`, entrypoint
`ResepsionisRpc`, so the data rules live in one place. Deploy worker-user first. Other bindings:
rate-limit namespace `LOGIN_LIMITER` (5301, 10/min) on `POST /api/login`, and static assets
served as a single-page app.

## Shared

Four of the five Workers bind the same D1 database `undangan-db` (id in each `wrangler.toml`, not
a secret). worker-resepsionis reaches it only through worker-user.

R2 buckets:

- `undangan-media` is shared by worker-user, worker-admin and worker-undangan. Since 2026-10-01
  its R2 custom domain `media-invitation.kodekraft.id` serves photos and music publicly through
  the Cloudflare cache (doc 23). That is why deleting media also purges that cache
  (`CF_PURGE_TOKEN`).
- `undangan-arsip` belongs to worker-admin only. It has **no** public domain, and files leave it
  only through the admin panel.

Service bindings, which set the deploy order when an RPC surface changes:

- worker-admin -> worker-landing
- worker-user -> worker-landing
- worker-resepsionis -> worker-user

Rate-limit namespace ids are unique per account: 5101–5104 (landing), 5201–5202 (user), 5301
(resepsionis), 7301 (undangan).

## Getting the Cloudflare-issued values

Dashboard menu names drift over time; if a label below does not match, look for the equivalent.

### 1. Turnstile (worker-undangan)

1. Cloudflare dashboard -> **Turnstile** -> **Add widget**.
2. Hostnames: add `invitation.kodekraft.id` **and every custom domain** used for guest links
   (for example `example.my.id` and `www.example.my.id`). A hostname missing from the list makes
   token verification fail for guests on that domain. Add each new custom domain here when it
   goes live.
3. Widget mode: **Managed**. Click **Create**.
4. Copy the **Site Key** (public) into worker-undangan `wrangler.toml` `[vars]` as
   `TURNSTILE_SITE_KEY`.
5. Copy the **Secret Key** and run, inside `invitation-worker-undangan`:
   `wrangler secret put TURNSTILE_SECRET`.
   The secret can be viewed or rotated later in the widget's settings, so it is recoverable.

### 2. `CF_API_TOKEN` (worker-admin, custom domains)

1. Cloudflare dashboard -> **My Profile** -> **API Tokens** -> **Create Token** ->
   **Create Custom Token**.
2. Permissions, exactly these two: **Zone > Zone > Read** and **Zone > Workers Routes > Edit**.
3. Zone Resources: **Include > All zones** from the account (customer zones are added over time).
4. Optional expiry (if set, note the renewal date somewhere). No IP restriction.
5. Create. The token is shown **once**: copy it now, then run inside `invitation-worker-admin`:
   `wrangler secret put CF_API_TOKEN`.
   If it is lost, roll or recreate the token and set the secret again.

Caveat: the custom-domain code in worker-admin has only been tested against fakes, never against
real Cloudflare. Try the whole flow on a throwaway zone first (see worker-admin's custom-domain
runbook).

### 3. `CF_ANALYTICS_API_TOKEN` and `CF_ACCOUNT_ID` (worker-admin, usage monitoring)

The daily usage cron and the Statistik Traffic page read the Cloudflare GraphQL Analytics API to
track how close the account is to the free-tier ceilings (Workers requests, D1 rows read/written,
R2 storage). The cron warns at 70%.

1. **Account id**: Cloudflare dashboard -> any zone's **Overview** -> right-hand sidebar,
   **Account ID**. Production stores it as a secret (`wrangler secret put CF_ACCOUNT_ID` inside
   `invitation-worker-admin`). It is not secret, so a `CF_ACCOUNT_ID = "..."` line in `[vars]`
   works as well. Use one place, not both.
2. **Token**: **My Profile** -> **API Tokens** -> **Create Token** -> **Create Custom Token**.
3. Permissions, exactly one: **Account > Account Analytics > Read**. Nothing else — this token
   only ever reads numbers.
4. Account Resources: **Include > the Kodekraft account**. No zone resources needed.
5. Create, copy the token (shown once), then run inside `invitation-worker-admin`:
   `wrangler secret put CF_ANALYTICS_API_TOKEN`.

Two things worth knowing before you trust the numbers:

- The query shape (`workersInvocationsAdaptive` grouped by `scriptName`,
  `d1AnalyticsAdaptiveGroups` filtered by date, `r2StorageAdaptiveGroups`) is **verified against
  the real account**: on the Statistik Traffic page on 2026-10-01, and by the cron's first
  successful snapshot at 23:00 UTC that day. CPU quantiles arrive in **microseconds**, and the
  code divides by 1000. If a run logs `usage_monitoring.analytics_fetch_failed`, check the token
  scope first.
- A token missing `Account Analytics:Read` does **not** produce an HTTP error — Cloudflare
  answers `200` with a top-level `errors` array. worker-admin rejects that as a failed run
  rather than storing a snapshot of zeros, so a mis-scoped token shows up as
  `analytics_fetch_failed` in the logs and an empty usage trend, never as a falsely healthy one.

**Alerts are logged, not delivered.** A 70% breach writes a loud
`usage_monitoring.alert_not_delivered` error to the Workers log and stops there: worker-admin has
no Resend/Fonnte credentials, so no email or WhatsApp is sent to anyone. Until that is wired,
treat the Workers log (or a log-drain alert on that event name) as the alerting channel.

### 4. `CF_PURGE_TOKEN` and `CF_ZONE_ID` (worker-user and worker-admin, media cache purge)

Photos and music are served from `media-invitation.kodekraft.id` through the Cloudflare cache,
with long cache lifetimes. Without a purge, a photo an owner deletes stays reachable from the
edge cache until it expires.
worker-user purges on owner deletes, and worker-admin purges what the media-retention cron
deletes.

1. **Zone id**: the `kodekraft.id` zone's **Overview** -> right-hand sidebar, **Zone ID**. It goes
   in `[vars]` as `CF_ZONE_ID` in both repos (already there). It is an identifier, not a secret.
2. **Token**: **My Profile** -> **API Tokens** -> **Create Token** -> **Create Custom Token**.
3. Permissions, exactly one: **Zone > Cache Purge > Purge**.
4. Zone Resources: **Include > Specific zone > `kodekraft.id`**. Nothing else.
5. Create, copy the token (shown once), then run `wrangler secret put CF_PURGE_TOKEN` inside
   **both** `invitation-worker-user` and `invitation-worker-admin`.

Check: delete a test photo from the dashboard, then request its old
`https://media-invitation.kodekraft.id/inv/...` URL. It must answer `404`, not `200` with
`cf-cache-status: HIT`. Checklist task `QA-media-01` walks through this.

## Seeded demo accounts (NOT Worker secrets - database rows)

Everything else in this document is a Worker secret. This section is about **login
passwords stored as rows in D1**, which is a different kind of exposure and is not
covered by `wrangler secret list`.

`seed.sql` (identical in worker-admin, worker-user and worker-undangan) creates five demo
accounts and **writes their shared password in plaintext in the file**, which is committed.
The same password also appears in `invitation-worker-admin/README.md`,
`invitation-worker-user/README.md`, `invitation-worker-landing/project-docs/13-project-structure-and-local-setup.md`
and about eight test files. On a local D1 that is correct and intentional - a seed nobody
can log into is useless. On a deployed database it means **anyone with repo access is an
administrator**.

**Verified 2026-09-23 against the pre-`0026` production dump:** five of the six accounts on
the production D1 carried a `password_hash` **byte-identical** to one in `seed.sql`. PBKDF2
salts are random per hash, so matching salt AND digest is the seed row itself, not chance.

**Status 2026-09-28: no rotation has been recorded since.** It is the first item on Pram's
checklist ("Tugas Pram KodeKraft"). Treat all five accounts as open until each one refuses the
seed password.

| Account | Table | What it can do | Priority |
|---|---|---|---|
| `superadmin@kodekraft.id` | `admins` | Full admin panel | **Rotate first** |
| `ops@kodekraft.id` | `admins` | Full admin panel (same hash as above - same password) | **Rotate first** |
| `admin@kodekraft.id` | `clients` | Owns **every demo invitation the storefront links to** | **Rotate first** |
| `bali@kodekraft.id` | `clients` | Owns nothing live | Rotate or delete |
| `jaya@kodekraft.id` | `clients` | Owns nothing live | Rotate or delete |

The third row is the one that is easy to underrate: it is not an admin, but it owns all seven
demos, the `preview-*` invitations (the Bali Elegant one was `metatah-anggun` until
2026-09-28; the two added on 2026-09-24 were cloned from `pv_lily_inv`, owner included).
Someone logging in as it can edit the demos every prospective customer clicks from
`kodekraft.id`.

**Do not delete the demo owner** - the storefront gallery links to its invitations and they
would 404. Rotate its password instead.

### Rotating one

Rotate through the apps, not through SQL. The server hashes the new password itself, enforces
the password rules (at least 8 characters with an upper-case letter, a lower-case letter, a
digit and a symbol) and bumps `token_version` in the same write, which revokes every session
already issued for that account. The revocation is the point: the old password was public, so
you cannot know who is already holding a token.

- **Clients** (`admin@`, `bali@`, `jaya@`): sign in at `dash-invitation.kodekraft.id`, open
  **Profil**, fill **Password baru** and save. For `bali@` and `jaya@`, deleting the account in
  the admin panel (**Klien → Hapus**) is an equally good fix: it is a soft delete, and a deleted
  client can neither sign in nor use a token issued earlier.
- **Admins** (`superadmin@`, `ops@`): the admin panel has no password page, although the API
  has `PATCH /api/auth/me`. Sign in at `adm-invitation.kodekraft.id`, open the browser console
  (F12 → Console; Chrome may ask you to type `allow pasting` first) and paste the snippet
  below. It asks for the new password in a prompt and prints `BERHASIL`, or `DITOLAK` with the
  rule that failed. Checked on 2026-09-28 against a local worker-admin: a weak password is
  refused and the old one keeps working; a valid one is accepted, the old password stops
  working, and the session the page was holding is revoked.

```js
(async () => {
  const pw = prompt("Password baru (min. 8 karakter: huruf besar, huruf kecil, angka, simbol)");
  if (!pw) return console.log("Dibatalkan.");
  const rt = localStorage.getItem("kk_admin_refresh");
  if (!rt) return console.log("Belum masuk. Login dulu, lalu jalankan lagi.");
  const s = await fetch("/api/auth/refresh-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: rt }),
  }).then((r) => r.json());
  if (s.responseCode !== "00") return console.log("Sesi tidak valid: " + s.responseMessage + ". Login ulang lalu jalankan lagi.");
  localStorage.setItem("kk_admin_refresh", s.data.refreshToken);
  const res = await fetch("/api/auth/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: "Bearer " + s.data.token },
    body: JSON.stringify({ password: pw }),
  }).then((r) => r.json());
  console.log(res.responseCode === "00"
    ? "BERHASIL. Semua sesi akun ini terputus. Muat ulang halaman dan masuk dengan password baru."
    : "DITOLAK: " + (res.data && res.data.errors ? res.data.errors.map((e) => e.message).join("; ") : res.responseMessage) + ". Password lama masih berlaku.");
})();
```

Afterwards, try the seed password on each of the five accounts. Every attempt must be refused.

#### Fallback, when nobody can sign in to the account: SQL

Only for an account whose current password nobody knows. The one-liner that used to be here
was broken twice over, and both faults are worth knowing before writing another. A literal
line break inside its regex made it a syntax error. And the `UPDATE` then carried the hash
inside a double-quoted shell string, where `pbkdf2$100000$...` is not literal: bash expands
`$1` and PowerShell `$100000` to nothing, so the command would have stored a hash that no
password matches and locked the account for good.

So here the hash never passes through a shell. Save this as `rotate-password-sql.mjs`
**outside any repo** (it only parses as written; the app-level paths above are the tested ones):

```js
// rotate-password-sql.mjs - writes one UPDATE statement that sets a new password.
// Usage: node rotate-password-sql.mjs <admins|clients> <email> <output.sql>
// The password is typed at the prompt, so it never enters shell history, and the
// statement goes straight to a file, so the hash never passes through a shell.
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [table, email, out] = process.argv.slice(2);
if (!["admins", "clients"].includes(table) || !/^[^\s'@]+@[^\s'@]+$/.test(email || "") || !out) {
  console.error("Usage: node rotate-password-sql.mjs <admins|clients> <email> <output.sql>");
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stderr });
rl.question("New password: ", (pw) => {
  rl.close();
  const strong = pw.length >= 8 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^a-zA-Z0-9]/.test(pw);
  if (!strong) {
    console.error("Needs at least 8 characters with an upper-case letter, a lower-case letter, a digit and a symbol.");
    process.exit(1);
  }
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(pw, salt, 100000, 32, "sha256");
  const stored = "pbkdf2$100000$" + salt.toString("base64") + "$" + hash.toString("base64");
  writeFileSync(out, `UPDATE ${table} SET password_hash = '${stored}', token_version = token_version + 1 WHERE email = '${email}';\n`);
  console.error(`Wrote ${out}. Run it with --file, then delete it.`);
});
```

Then, per account (`admins` or `clients`), from any repo folder whose `wrangler.toml` binds
`undangan-db`:

```bash
node <path-to>/rotate-password-sql.mjs admins superadmin@kodekraft.id rotate.sql
npx wrangler d1 execute undangan-db --remote --file rotate.sql
```

Wrangler may ask you to confirm the file import; answer `y`. Delete `rotate.sql` afterwards,
because it holds the new hash.

To confirm no production row still matches a seeded hash, compare the first 26 characters of
each `password_hash` against the ones in `seed.sql`. Matching prefixes mean the salt is shared,
which only happens when the row came from the seed.

### Why not just delete the demo accounts

The two admins can be deleted once a real admin exists. Of the three clients, `bali@` and
`jaya@` can go; `admin@` cannot, because it owns every demo invitation the storefront gallery
links to. Rotate that one.

## After every fresh deploy

Run in each Worker's repo unless noted.

- [ ] `wrangler secret list` shows every required secret above for that Worker (names only).
- [ ] No production row still carries a `seed.sql` password hash (see "Seeded demo accounts").
- [ ] worker-landing: `MIDTRANS_SERVER_KEY` set and its type matches `MIDTRANS_IS_PRODUCTION`;
      `workers_dev = true` still in `wrangler.toml` and Midtrans' notification URL pointing at the
      workers.dev address.
- [ ] worker-landing: `STAFF_ALERT_WA` (and `STAFF_ALERT_EMAIL` if used) set, so stuck-order and
      Express alerts reach staff; `WA_NUMBER` is the real business number, not the placeholder.
- [ ] `INTERNAL_KEY` **not** set anywhere (retired; delete it where it still exists).
- [ ] `JWT_SECRET` / `REFRESH_TOKEN_SECRET` set on user and admin, all four values different.
- [ ] worker-undangan: `TURNSTILE_ENABLED` matches the decision in force (currently `"false"`). If
      the gate is on: `TURNSTILE_SECRET` and `TURNSTILE_SITE_KEY` set, and the Turnstile widget
      lists `invitation.kodekraft.id` plus every custom domain.
- [ ] Deploy order where an RPC surface changed: worker-landing before worker-admin and
      worker-user; worker-user before worker-resepsionis.
- [ ] worker-admin: `CF_API_TOKEN` set if custom domains are in use; the `undangan-arsip` bucket
      exists before the first deploy (the `ARSIP` binding fails otherwise).
- [ ] worker-user and worker-admin: `CF_PURGE_TOKEN` set (section 4), so deleted media also
      leaves the `media-invitation.kodekraft.id` cache.
- [ ] worker-admin: `CF_ANALYTICS_API_TOKEN` and `CF_ACCOUNT_ID` set if you want free-tier usage
      alerts and the Statistik Traffic numbers; otherwise accept that the cron skips silently.
      Check the next day's logs for `usage_monitoring.run_complete` (working) vs
      `usage_monitoring.skipped` (not configured) vs `usage_monitoring.analytics_fetch_failed`
      (configured but the token scope is wrong).
- [ ] worker-admin: `MEDIA_RETENTION_MODE` left **unset** on the first deploy. Read the
      `media_retention.dry_run` logs for a few nights before setting it to `"enabled"` — it
      deletes R2 objects permanently.
- [ ] D1 migrations applied (`migrations/` in each repo; shared DB `undangan-db`).
- [ ] Smoke test: storefront loads, admin login works, a guest link opens and an RSVP submits (200).
