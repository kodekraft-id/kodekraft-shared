// Tier capability map + effective-capability API. Originally BE-mono-10 (doc 11 §1); extended by
// BE-mono-23/24 (doc 17 FR-1): purchased add-ons, photo ceiling, add-ons-only QR/domain, new
// durations. Pure values and predicates only, no D1 access. `assertFeature` is deliberately NOT
// exported from this package (project-docs/12 §5.2): each consuming repo writes its own 3-liner
// over `hasFeature`, throwing its own local `HttpError`, since the response envelope stays per-repo.
/** Extra photos granted by one `gallery` add-on unit. */
export const GALLERY_ADDON_PHOTOS = 15;
/** Hard photo ceiling for the tier-plus-add-on path (doc 17 ruling 7). A staff override may exceed it. */
export const PHOTO_CEILING = 50;
/** Sane upper bound applied when parsing a stored add-on quantity (defends against garbage rows). */
export const MAX_ADDON_QUANTITY = 99;
/** Premium's active duration in months. Pram ruled 6 for OQ-26 (must stay strictly between
 * Basic's 3 and Exclusive's 12). */
const PREMIUM_DURATION_MONTHS = 6;
/** Frozen tier -> capability defaults. Changing what a tier unlocks is a pricing decision,
 * same category as changing its price — edited by code review + redeploy, never at runtime.
 * v0.4.0 VALUE CHANGE: qrCheckin/customDomain are false at every tier (add-ons only);
 * durations are basic 3 / premium 6 / exclusive 12 (no tier is "never expires"). */
export const TIER_CAPABILITIES = Object.freeze({
    basic: { photoCap: 5, qrCheckin: false, customDomain: false, durationMonths: 3 },
    premium: { photoCap: 15, qrCheckin: false, customDomain: false, durationMonths: PREMIUM_DURATION_MONTHS },
    exclusive: { photoCap: 50, qrCheckin: false, customDomain: false, durationMonths: 12 },
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
const ADDON_IDS = ["domain", "qrcheckin", "gallery"];
const BINARY_ADDON_IDS = new Set(["domain", "qrcheckin"]);
function isAddonId(value) {
    return typeof value === "string" && ADDON_IDS.includes(value);
}
/** Normalizes one stored quantity: positive integers only, clamped to MAX_ADDON_QUANTITY,
 * binary add-ons forced to 1. Returns undefined when the entry must be ignored. */
function normalizeQuantity(id, quantity) {
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1)
        return undefined;
    if (BINARY_ADDON_IDS.has(id))
        return 1;
    return Math.min(quantity, MAX_ADDON_QUANTITY);
}
/**
 * Tolerant reader for purchased add-ons. Accepts (a) the object shape `{"gallery":2}`, (b) the
 * legacy `settings.addons` string array (each known id => quantity 1), (c) a JSON string of either,
 * (d) null/undefined/garbage => `{}`. Unknown ids (incl. `express`) and non-positive-integer
 * quantities are ignored. Never throws.
 */
export function parsePurchasedAddons(raw) {
    let value = raw;
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        }
        catch {
            return {};
        }
    }
    const result = {};
    if (Array.isArray(value)) {
        for (const entry of value) {
            if (isAddonId(entry))
                result[entry] = 1;
        }
        return result;
    }
    if (typeof value !== "object" || value === null)
        return result;
    const record = value;
    for (const id of ADDON_IDS) {
        if (!Object.prototype.hasOwnProperty.call(record, id))
            continue;
        const quantity = normalizeQuantity(id, record[id]);
        if (quantity !== undefined)
            result[id] = quantity;
    }
    return result;
}
/**
 * Most `gallery` units that still change the photo cap for a tier (storefront limit / server
 * rejection): Basic 3, Premium 3, Exclusive 0.
 */
export function maxUsefulGalleryUnits(tier) {
    return Math.max(0, Math.ceil((PHOTO_CEILING - TIER_CAPABILITIES[tier].photoCap) / GALLERY_ADDON_PHOTOS));
}
/**
 * Effective photo cap: staff override (`invitations.photo_cap_override`) if set, otherwise
 * `min(tierCap + 15 x galleryQty, PHOTO_CEILING)` (never below the tier's own cap). `0` is a
 * legitimate override; only `null`/`undefined` fall back. An override may exceed the ceiling.
 */
export function getEffectivePhotoCap(tier, override, addons) {
    if (override !== null && override !== undefined)
        return override;
    const tierCap = TIER_CAPABILITIES[tier].photoCap;
    const withGallery = tierCap + GALLERY_ADDON_PHOTOS * (addons?.gallery ?? 0);
    return Math.max(tierCap, Math.min(withGallery, PHOTO_CEILING));
}
/** Whether an invitation has a binary feature: the tier grants it (never today) OR it was purchased. */
export function hasFeature(tier, feature, addons) {
    if (TIER_CAPABILITIES[tier][feature])
        return true;
    const addonId = feature === "qrCheckin" ? "qrcheckin" : "domain";
    return (addons?.[addonId] ?? 0) >= 1;
}
/** Everything an invitation is actually entitled to: tier defaults + purchased add-ons + staff override. */
export function getEffectiveCapabilities(tier, addons, photoCapOverride) {
    return {
        photoCap: getEffectivePhotoCap(tier, photoCapOverride, addons),
        qrCheckin: hasFeature(tier, "qrCheckin", addons),
        customDomain: hasFeature(tier, "customDomain", addons),
        durationMonths: TIER_CAPABILITIES[tier].durationMonths,
    };
}
/** Computes `invitations.expires_at` at publish time. Pure — no D1 access. The `null` branch is
 * legacy/defensive only (no tier has a null duration any more). */
export function computeExpiresAt(activatedAt, tier) {
    const months = TIER_CAPABILITIES[tier].durationMonths;
    if (months === null)
        return null;
    const d = new Date(activatedAt);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d;
}
// ---------------------------------------------------------------------------------------------
// Expiry / grace / demo exemption (BE-mono-28, doc 17 section 16 + OQ-20 + OQ-17). Pure functions,
// injectable `now`, no D1 access, no HttpError. ONE implementation of the demo rule for every
// consumer (BE-user-07/23/27, BE-undangan-10, BE-admin-13/24, BE-wl-40).
// ---------------------------------------------------------------------------------------------
/** Dashboard read-only grace after `expires_at` (OQ-20: "~30 days"). One constant, not per-caller. */
export const EXPIRY_GRACE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ISO_HAS_ZONE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
/**
 * Parses a stored timestamp to epoch ms. Accepts a `Date`, UTC ISO (`...Z`), an offset ISO
 * (`...+07:00`), and a zone-less string (`YYYY-MM-DD HH:MM:SS` from SQLite `datetime('now')`, or
 * `YYYY-MM-DDTHH:MM:SS`), which is interpreted as UTC. Returns `null` for null/undefined/empty/
 * unparseable input.
 */
export function parseTimestampMs(value) {
    if (value === null || value === undefined)
        return null;
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isNaN(ms) ? null : ms;
    }
    if (typeof value !== "string")
        return null;
    let normalized = value.trim();
    if (normalized === "")
        return null;
    if (SQLITE_DATETIME.test(normalized))
        normalized = normalized.replace(" ", "T");
    if (!ISO_HAS_ZONE.test(normalized))
        normalized += "Z";
    const ms = Date.parse(normalized);
    return Number.isNaN(ms) ? null : ms;
}
function isDemo(row) {
    return row?.is_demo === 1;
}
/**
 * True when the invitation's tier time limit has passed (`expires_at <= now`, boundary inclusive).
 * `false` for demos (`is_demo === 1`, even with a past `expires_at`), for NULL/missing `expires_at`
 * (legacy rows: "not expired"), and for an unparseable `expires_at` (fail-open: never lock a
 * customer on garbage). A null/undefined row is `false`.
 */
export function isInvitationExpired(row, now = new Date()) {
    if (!row || isDemo(row))
        return false;
    const expiresMs = parseTimestampMs(row.expires_at);
    if (expiresMs === null)
        return false;
    return expiresMs <= now.getTime();
}
/**
 * True when the dashboard is LOCKED: `now >= expires_at + graceDays` (boundary inclusive). Between
 * `expires_at` and that instant the dashboard is read-only. Demos and NULL `expires_at` are never
 * locked. `graceDays` defaults to {@link EXPIRY_GRACE_DAYS}; a negative/non-finite value falls back
 * to the default.
 */
export function isInvitationLocked(row, now = new Date(), graceDays = EXPIRY_GRACE_DAYS) {
    if (!row || isDemo(row))
        return false;
    const expiresMs = parseTimestampMs(row.expires_at);
    if (expiresMs === null)
        return false;
    const days = Number.isFinite(graceDays) && graceDays >= 0 ? graceDays : EXPIRY_GRACE_DAYS;
    return expiresMs + days * MS_PER_DAY <= now.getTime();
}
/** `active` (not expired) | `grace` (expired, dashboard read-only + export) | `locked` (grace over). */
export function getInvitationExpiryState(row, now = new Date(), graceDays = EXPIRY_GRACE_DAYS) {
    if (!isInvitationExpired(row, now))
        return "active";
    return isInvitationLocked(row, now, graceDays) ? "locked" : "grace";
}
/**
 * Whether a custom domain may be served (doc 17 FR-15.2 / OQ-17): `status === 'active'` AND the
 * domain's own `expires_at` is NULL or in the future (`> now`) AND the invitation is within its
 * active period (demos exempt, via {@link isInvitationExpired}). A null/missing domain is inactive.
 */
export function isDomainActive(domain, invitation, now = new Date()) {
    if (!domain || domain.status !== "active")
        return false;
    const domainExpiresMs = parseTimestampMs(domain.expires_at);
    if (domainExpiresMs !== null && domainExpiresMs <= now.getTime())
        return false;
    return !isInvitationExpired(invitation, now);
}
