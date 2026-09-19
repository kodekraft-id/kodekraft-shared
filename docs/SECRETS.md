# Per-Worker secrets and bindings (DOC-mono-02)

Secrets are never in `wrangler.toml` or git. Set each one on the deployed Worker with
`wrangler secret put <NAME>` (run from that Worker's repo), and locally in the gitignored
`.dev.vars`. A Worker deployed with a required secret unset does not fail at deploy time, only
at request time, so check this list on every fresh deploy.

Derived from each repo's `wrangler.toml`, `.dev.vars.example` and `src/**/bindings.ts`
(the `Env` interface). If a binding is added, update this file in the same change.

## worker-landing (`kodekraft.id`)

| Secret | Required | If unset |
|---|---|---|
| `MIDTRANS_SERVER_KEY` | yes | checkout and webhook signature verification cannot work |
| `INTERNAL_KEY` | yes, for internal routes | internal routes fail closed and reject every request (`middleware/internal-key.ts`) |
| `RESEND_API_KEY` | optional | activation/notification email is skipped |
| `WA_GATEWAY_TOKEN` | optional | WhatsApp notification is skipped |

Non-secret `[vars]` already in `wrangler.toml`: `WA_NUMBER`, `INVITATION_BASE_URL`,
`BRAND_NAME`, `SITE_BASE_URL`, `DASH_BASE_URL`, `MIDTRANS_IS_PRODUCTION`, `MAIL_FROM`,
`WA_GATEWAY_URL`. Other bindings: D1 `DB`, four rate-limit namespaces (`CHECKOUT_LIMITER`,
`WEBHOOK_LIMITER`, `ORDER_STATUS_LIMITER`, `RESEND_LIMITER`). Note: `MIDTRANS_IS_PRODUCTION`
must be flipped to `"true"` deliberately for production; the key type must match
(`SB-Mid-server-...` sandbox vs `Mid-server-...` production).

## worker-user (`dash-invitation.kodekraft.id`)

| Secret | Required | If unset |
|---|---|---|
| `JWT_SECRET` | yes | access-token signing/verification cannot work |
| `REFRESH_TOKEN_SECRET` | yes | refresh-token flow cannot work |

Generate each with a long random string, for example
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
Use different values for `JWT_SECRET` and `REFRESH_TOKEN_SECRET`, and different values from
worker-admin's (separate identity tables per app). Non-secret `[vars]`: `JWT_EXPIRES_IN_SEC`,
`REFRESH_EXPIRES_IN_SEC`, `PUBLIC_INVITATION_BASE_URL`. Bindings: D1 `DB`, R2 `MEDIA`.

## worker-admin (`adm-invitation.kodekraft.id`)

| Secret | Required | If unset |
|---|---|---|
| `JWT_SECRET` | yes | as worker-user |
| `REFRESH_TOKEN_SECRET` | yes | as worker-user |

Same shape as worker-user: `[vars]` `JWT_EXPIRES_IN_SEC`, `REFRESH_EXPIRES_IN_SEC`,
`PUBLIC_INVITATION_BASE_URL` (unused by admin, kept so shared types compile). Bindings: D1
`DB`, R2 `MEDIA`.

## worker-undangan (`invitation.kodekraft.id`)

No secrets. Bindings only: D1 `DB`, R2 `MEDIA`.

## Shared

All four Workers bind the same D1 database `undangan-db` (id in each `wrangler.toml`, not a
secret). worker-user, worker-admin and worker-undangan share the R2 bucket `undangan-media`.
