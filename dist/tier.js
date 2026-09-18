// Real implementation (BE-mono-10): doc 11 (`11-tier-capability-design.md`) §1's tier
// capability map — the single source of truth for "tier X unlocks feature Y". Pure values
// and predicates only, no D1 access. `assertFeature` is deliberately NOT exported from this
// package (project-docs/12 §5.2): each consuming repo writes its own 3-liner over `hasFeature`,
// throwing its own local `HttpError`, since the response envelope stays per-repo.
/** Frozen tier -> capability defaults. Changing what a tier unlocks is a pricing decision,
 * same category as changing its price — edited by code review + redeploy, never at runtime. */
export const TIER_CAPABILITIES = Object.freeze({
    basic: { photoCap: 5, qrCheckin: false, customDomain: false, durationMonths: 3 },
    premium: { photoCap: 15, qrCheckin: true, customDomain: false, durationMonths: 12 },
    exclusive: { photoCap: 50, qrCheckin: true, customDomain: true, durationMonths: null },
});
// Personal guest links (`guests.token`, the `?to=` mechanism) are deliberately NOT modeled
// in this map: every tier has them, unconditionally (confirmed 2026-09-17). Do not add a
// `personalGuestLinks` flag here — its only effect would be inviting a future
// `if (!hasFeature(...))` check that contradicts the confirmed decision. If personal links
// ever need to become conditional, that's a new product decision requiring a new field here,
// not a bug fix to "restore" one.
//
// Templates are tier-agnostic by product decision (2026-09-17): this map is keyed ONLY by
// tier, never by template key. No `templates.min_tier` column exists or should be added.
/**
 * Effective photo cap for an invitation: the per-buyer staff override
 * (`invitations.photo_cap_override`) if one is set, otherwise the tier default.
 * `0` is a legitimate override value (a real zero-cap), not treated as "no override" —
 * only `null`/`undefined` fall back to the tier default.
 */
export function getEffectivePhotoCap(tier, override) {
    return override ?? TIER_CAPABILITIES[tier].photoCap;
}
/** Whether a tier includes a given binary feature (QR check-in / custom domain). */
export function hasFeature(tier, feature) {
    return TIER_CAPABILITIES[tier][feature];
}
/** Computes `invitations.expires_at` at publish time. Pure — no D1 access. */
export function computeExpiresAt(activatedAt, tier) {
    const months = TIER_CAPABILITIES[tier].durationMonths;
    if (months === null)
        return null;
    const d = new Date(activatedAt);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d;
}
