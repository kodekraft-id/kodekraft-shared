<!-- GENERATED FILE — do not hand-edit. Run `node bin/check-ownership.mjs --fix` to regenerate from ownership.json. -->

# OWNERSHIP.md

Human-readable render of `ownership.json`, the table-ownership matrix shared by the 4
`invitation-worker-*` repos. `writers` lists, per table, which app(s) may write it and
which columns (`*` = unrestricted). `readers` is a ceiling, not an obligation — see
`project-docs/12-cross-repo-integration-design.md` §5.4/§5.5 (rules R5-R7) in each
consuming repo for how this matrix is enforced against real code.

| Table | Schema module | Writers (writable columns) | Readers |
|---|---|---|---|
| `admins` | `schema/admins.ts` | worker-admin | — |
| `app_settings` | `schema/catalog.ts` | worker-admin | worker-landing, worker-user, worker-undangan |
| `clients` | `schema/clients.ts` | worker-landing (id, name, email, phone, password_hash, token_version, created_at, activation_token_hash, activation_expires_at, activation_issued_at, activation_resend_count, updated_at); worker-user (password_hash, token_version, name, email, phone, updated_at); worker-admin (id, name, email, phone, password_hash, created_at, deleted_at, updated_at) | — |
| `events` | `schema/content.ts` | worker-user | worker-undangan, worker-admin |
| `gift_accounts` | `schema/content.ts` | worker-user | worker-undangan |
| `gifts` | `schema/submissions.ts` | worker-undangan; worker-user | worker-admin |
| `guests` | `schema/guests.ts` | worker-user (id, invitation_id, name, token, group_name, phone, created_at, checked_in_at, checked_in_by, checkin_method, updated_at); worker-undangan (opened_at, opened_count) | worker-landing |
| `invitation_domains` | `schema/domains.ts` | worker-landing (id, invitation_id, domain, kind, status, requested_at, order_id, price_idr, term_months, created_at, updated_at); worker-user; worker-admin | worker-undangan |
| `invitations` | `schema/invitations.ts` | worker-landing (id, client_id, template_id, slug, status, event_type, title, opening, story, quote, music_r2_key, music_title, settings, wa_template, package_tier, purchased_addons, created_at, updated_at); worker-user (title, opening, story, quote, music_r2_key, music_title, settings, wa_template, event_type, status, activated_at, expires_at, updated_at); worker-admin (id, client_id, template_id, slug, event_type, title, settings, status, package_tier, photo_cap_override, purchased_addons, created_at, deleted_at, updated_at) | worker-undangan, worker-landing |
| `order_refunds` | `schema/orders.ts` | worker-admin | worker-landing |
| `order_status_log` | `schema/orders.ts` | worker-landing | worker-admin |
| `orders` | `schema/orders.ts` | worker-landing | worker-admin |
| `persons` | `schema/content.ts` | worker-user | worker-undangan |
| `photos` | `schema/content.ts` | worker-user | worker-undangan, worker-admin |
| `rsvp` | `schema/submissions.ts` | worker-undangan; worker-user | worker-admin |
| `sections` | `schema/sections.ts` | worker-landing; worker-user; worker-admin | worker-undangan |
| `story_items` | `schema/content.ts` | worker-user | worker-undangan |
| `templates` | `schema/catalog.ts` | worker-admin | worker-landing, worker-user, worker-undangan |
| `testimonials` | `schema/catalog.ts` | worker-admin | worker-landing, worker-user, worker-undangan |
| `wa_templates` | `schema/catalog.ts` | worker-admin | worker-landing, worker-user, worker-undangan |
| `wishes` | `schema/submissions.ts` | worker-undangan; worker-user | worker-admin |
