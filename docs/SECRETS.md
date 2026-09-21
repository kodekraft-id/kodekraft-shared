# Per-Worker secrets and bindings (DOC-mono-02)

Secrets are never in `wrangler.toml` or git. Set each one on the deployed Worker with
`wrangler secret put <NAME>` (run from that Worker's repo), and locally in the gitignored
`.dev.vars`. A Worker deployed with a required secret unset does not fail at deploy time, only
at request time, so check this list on every fresh deploy.

Derived from each repo's `wrangler.toml`, `.dev.vars.example` and `src/**/bindings.ts`
(the `Env` interface). If a binding is added, update this file in the same change.

- [Where secrets live](#where-secrets-live)
- [worker-landing](#worker-landing-kodekraftid)
- [worker-user](#worker-user-dash-invitationkodekraftid)
- [worker-admin](#worker-admin-adm-invitationkodekraftid)
- [worker-undangan](#worker-undangan-invitationkodekraftid)
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
- Secrets are per Worker: setting `INTERNAL_KEY` on landing does nothing for admin. Set it on each.
- Generate random values with:
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- `INTERNAL_KEY` must be **byte-identical** in worker-landing and worker-admin (admin sends it as
  `X-Internal-Key` over the `LANDING` service binding; landing compares it). A mismatch means
  admin's order reprovision / resend-activation calls are rejected.
- `JWT_SECRET` and `REFRESH_TOKEN_SECRET` must differ from each other, and worker-user's pair must
  differ from worker-admin's pair (separate identity tables per app; a shared key would let a token
  from one app be accepted by the other).

## worker-landing (`kodekraft.id`)

| Secret | Required | If unset |
|---|---|---|
| `MIDTRANS_SERVER_KEY` | yes | checkout and webhook signature verification cannot work |
| `INTERNAL_KEY` | yes, for internal routes | internal routes fail closed and reject every request (`middleware/internal-key.ts`); must equal worker-admin's value |
| `RESEND_API_KEY` | optional | activation/notification email is skipped |
| `WA_GATEWAY_TOKEN` | optional | WhatsApp notification is skipped |

Non-secret `[vars]` already in `wrangler.toml`: `WA_NUMBER`, `INVITATION_BASE_URL`,
`BRAND_NAME`, `SITE_BASE_URL`, `DASH_BASE_URL`, `MIDTRANS_IS_PRODUCTION`, `MAIL_FROM`,
`WA_GATEWAY_URL`. Other bindings: D1 `DB`, four rate-limit namespaces declared in `wrangler.toml`
(`CHECKOUT_LIMITER` 5101, `WEBHOOK_LIMITER` 5102, `ORDER_STATUS_LIMITER` 5103, `RESEND_LIMITER`
5104; no secret needed, and optional in code so an absent binding only skips rate limiting).
Note: `MIDTRANS_IS_PRODUCTION` must be flipped to `"true"` deliberately for production; the key
type must match (`SB-Mid-server-...` sandbox vs `Mid-server-...` production).

## worker-user (`dash-invitation.kodekraft.id`)

| Secret | Required | If unset |
|---|---|---|
| `JWT_SECRET` | yes | access-token signing/verification cannot work |
| `REFRESH_TOKEN_SECRET` | yes | refresh-token flow cannot work |

Use different values for `JWT_SECRET` and `REFRESH_TOKEN_SECRET`, and different values from
worker-admin's (see "Where secrets live"). Non-secret `[vars]`: `JWT_EXPIRES_IN_SEC`,
`REFRESH_EXPIRES_IN_SEC`, `PUBLIC_INVITATION_BASE_URL`, `CORS_ALLOWED_ORIGINS` (comma-separated
allowlist, default is the production dashboard origin; the SPA is same-origin so this only matters
for explicit cross-origin callers). Bindings: D1 `DB`, R2 `MEDIA`, and rate-limit namespaces
`LOGIN_LIMITER` (5201) and `FORGOT_LIMITER` (5202), declared in `wrangler.toml` and optional in
code (no secret needed). Rate-limit namespace ids are account-scoped and must stay unique across
Workers.

## worker-admin (`adm-invitation.kodekraft.id`)

| Secret | Required | If unset |
|---|---|---|
| `JWT_SECRET` | yes | as worker-user |
| `REFRESH_TOKEN_SECRET` | yes | as worker-user |
| `INTERNAL_KEY` | yes | calls to worker-landing over the `LANDING` service binding (order reprovision, resend activation) are rejected; must equal landing's value |
| `CF_API_TOKEN` | only for custom domains | domain Verifikasi / Aktifkan / Hapus fail closed with RC 99; everything else works |
| `CF_ANALYTICS_API_TOKEN` | only for usage monitoring | the daily usage-monitoring cron logs `usage_monitoring.skipped` and returns without calling Cloudflare — **you get no free-tier ceiling alerts at all**; nothing else is affected |

`CF_API_TOKEN` is a Cloudflare API token with exactly `Zone:Zone:Read` and
`Zone:Workers Routes:Edit` (see "Getting the Cloudflare-issued values"). Never a Global API Key.

`CF_ANALYTICS_API_TOKEN` is a **separate, least-privilege** token with only
`Account Analytics:Read` — deliberately not the same token as `CF_API_TOKEN` above, which can
edit Workers routes. Pointing both secrets at one token works if you would rather provision
only one; the split is a precaution, not a requirement.

Non-secret `[vars]`: `JWT_EXPIRES_IN_SEC`, `REFRESH_EXPIRES_IN_SEC`, `PUBLIC_INVITATION_BASE_URL`
(unused by admin, kept so shared types compile), `UNDANGAN_WORKER_NAME` (script name that
custom-domain routes point at; `worker-undangan`). Bindings: D1 `DB`, R2 `MEDIA`, service binding
`LANDING` -> `worker-landing` (deploy worker-landing first so the binding can resolve).

worker-admin is the only Worker with `[triggers]`: two daily crons, `0 3 * * *` (media
retention) and `0 23 * * *` (usage monitoring). Two `[vars]` control them, and **both are
deliberately left unset in `wrangler.toml`**, so a fresh deploy starts in the safe state:

| Var | Unset (default) | Set it to |
|---|---|---|
| `CF_ACCOUNT_ID` | usage-monitoring cron skips every run — no usage history, no alerts | your Cloudflare account id. Not a secret (an identifier, not a credential), so it belongs in `wrangler.toml` `[vars]`, not `wrangler secret put`. Needed together with `CF_ANALYTICS_API_TOKEN`; either one missing skips the run |
| `MEDIA_RETENTION_MODE` | media-retention cron runs **dry** — logs the R2 objects it would delete, deletes nothing | `"enabled"`, and only after reading a few nights of dry-run logs and agreeing with what they list. This cron permanently deletes R2 objects; there is no undo |

Leaving both unset is a valid first deploy: the Worker serves traffic normally, one cron is
inert and the other only logs.

## worker-undangan (`invitation.kodekraft.id`)

| Secret | Required | If unset |
|---|---|---|
| `TURNSTILE_SECRET` | yes | **fail closed**: every guest RSVP / wish / gift submission is rejected |

Non-secret var: `TURNSTILE_SITE_KEY` (public, safe to commit). In `wrangler.toml` the `[vars]` block
is currently commented out: uncomment it and fill in the site key before deploying. If it is empty
the widget is not rendered while the backend still demands a token, so guests cannot submit either.
Bindings: D1 `DB`, R2 `MEDIA`. No rate-limit bindings.

Local dev: `.dev.vars.example` holds Cloudflare's public always-pass test keys (site key
`1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`); use those only locally.
Deploy order and smoke test: that repo's `project-docs/09-deployment.md`.

## Shared

All four Workers bind the same D1 database `undangan-db` (id in each `wrangler.toml`, not a
secret). worker-user, worker-admin and worker-undangan share the R2 bucket `undangan-media`.

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

The daily usage cron reads the Cloudflare GraphQL Analytics API to track how close the account is
to the free-tier ceilings (Workers requests, D1 rows read/written, R2 storage) and warns at 70%.

1. **Account id**: Cloudflare dashboard -> any zone's **Overview** -> right-hand sidebar,
   **Account ID**. Copy it into worker-admin's `wrangler.toml` `[vars]` as
   `CF_ACCOUNT_ID = "..."`. It is not a secret.
2. **Token**: **My Profile** -> **API Tokens** -> **Create Token** -> **Create Custom Token**.
3. Permissions, exactly one: **Account > Account Analytics > Read**. Nothing else — this token
   only ever reads numbers.
4. Account Resources: **Include > the Kodekraft account**. No zone resources needed.
5. Create, copy the token (shown once), then run inside `invitation-worker-admin`:
   `wrangler secret put CF_ANALYTICS_API_TOKEN`.

Two caveats worth knowing before you trust the numbers:

- The GraphQL dataset/field names (`workersInvocationsAdaptive`, `d1AnalyticsAdaptiveGroups`,
  `r2StorageAdaptiveGroups`) are **unverified against a real account**. If the first runs log
  `usage_monitoring.analytics_fetch_failed`, the query shape is the first thing to check.
- A token missing `Account Analytics:Read` does **not** produce an HTTP error — Cloudflare
  answers `200` with a top-level `errors` array. worker-admin rejects that as a failed run
  rather than storing a snapshot of zeros, so a mis-scoped token shows up as
  `analytics_fetch_failed` in the logs and an empty usage trend, never as a falsely healthy one.

**Alerts are logged, not delivered.** A 70% breach writes a loud
`usage_monitoring.alert_not_delivered` error to the Workers log and stops there: worker-admin has
no Resend/Fonnte credentials, so no email or WhatsApp is sent to anyone. Until that is wired,
treat the Workers log (or a log-drain alert on that event name) as the alerting channel.

## After every fresh deploy

Run in each Worker's repo unless noted.

- [ ] `wrangler secret list` shows every required secret above for that Worker (names only).
- [ ] worker-landing: `MIDTRANS_SERVER_KEY` set and its type matches `MIDTRANS_IS_PRODUCTION`.
- [ ] `INTERNAL_KEY` set on both worker-landing and worker-admin, same value.
- [ ] `JWT_SECRET` / `REFRESH_TOKEN_SECRET` set on user and admin, all four values different.
- [ ] worker-undangan: `TURNSTILE_SECRET` set, `TURNSTILE_SITE_KEY` uncommented in `[vars]`, and
      the Turnstile widget lists `invitation.kodekraft.id` plus every custom domain.
- [ ] worker-admin: `CF_API_TOKEN` set if custom domains are in use; `LANDING` service binding
      resolves (worker-landing deployed).
- [ ] worker-admin: `CF_ANALYTICS_API_TOKEN` set and `CF_ACCOUNT_ID` filled in `[vars]` if you
      want free-tier usage alerts; otherwise accept that the cron skips silently. Check the next
      day's logs for `usage_monitoring.run_complete` (working) vs `usage_monitoring.skipped`
      (not configured) vs `usage_monitoring.analytics_fetch_failed` (configured but the query or
      token scope is wrong).
- [ ] worker-admin: `MEDIA_RETENTION_MODE` left **unset** on the first deploy. Read the
      `media_retention.dry_run` logs for a few nights before setting it to `"enabled"` — it
      deletes R2 objects permanently.
- [ ] D1 migrations applied (`migrations/` in each repo; shared DB `undangan-db`).
- [ ] Smoke test: storefront loads, admin login works, a guest link opens and an RSVP submits (200).
