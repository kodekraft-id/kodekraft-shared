// Tier capability map + effective-capability API. Originally BE-mono-10 (doc 11 §1); extended by
// BE-mono-23/24 (doc 17 FR-1): purchased add-ons, photo ceiling, add-ons-only QR/domain, new
// durations. Pure values and predicates only, no D1 access. `assertFeature` is deliberately NOT
// exported from this package (project-docs/12 §5.2): each consuming repo writes its own 3-liner
// over `hasFeature`, throwing its own local `HttpError`, since the response envelope stays per-repo.
/** Pagar teknis foto galeri per undangan (doc 35 §3.3, jawaban Pram 6 Okt 2026). BUKAN kuota: tidak dijual dan tidak
 * ditampilkan di mana pun; ia hanya menahan akun yang disalahgunakan (ribuan foto 20 MB sebagai penyimpanan gratis).
 * Bila tercapai, pesannya ramah dan menyuruh menghubungi tim. Satu konstanta untuk menaikkannya kapan saja. */
export const PHOTO_TECHNICAL_FENCE = 300;
/** Pagar teknis baris tamu per undangan (doc 35 §3.3): sama dengan {@link PHOTO_TECHNICAL_FENCE}, bukan kuota. */
export const GUEST_TECHNICAL_FENCE = 10_000;
/** Sane upper bound applied when parsing a stored add-on quantity (defends against garbage rows). */
export const MAX_ADDON_QUANTITY = 99;
/** Frozen tier -> capability defaults. Changing what a tier unlocks is a pricing decision,
 * same category as changing its price — edited by code review + redeploy, never at runtime.
 * v0.4.0 VALUE CHANGE: qrCheckin/customDomain are false at every tier (add-ons only).
 * v0.26.0 VALUE CHANGE (doc 35, 6 Okt 2026): the three tiers are identical — no photo cap, no guest cap, and no active
 * period (lifetime). Only the label survives (`invitations.package_tier`), as information about old rows. */
export const TIER_CAPABILITIES = Object.freeze({
    basic: { photoCap: null, guestCap: null, qrCheckin: false, customDomain: false, seating: false, durationMonths: null },
    premium: { photoCap: null, guestCap: null, qrCheckin: false, customDomain: false, seating: false, durationMonths: null },
    exclusive: { photoCap: null, guestCap: null, qrCheckin: false, customDomain: false, seating: false, durationMonths: null },
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
const ADDON_IDS = ["domain", "qrcheckin", "gallery", "guests", "seating", "design"];
const BINARY_ADDON_IDS = new Set(["domain", "qrcheckin", "seating", "design"]);
/** Add-ons that are no longer sold and grant nothing (doc 35, 6 Okt 2026): `gallery` and `guests` (no photo or guest quota
 * to extend) and `domain` (custom domains are switched off entirely). Old `purchased_addons` rows still PARSE (nothing
 * throws), but they have no effect on {@link hasFeature} or {@link getEffectiveCapabilities}. */
export const RETIRED_ADDON_IDS = Object.freeze(["domain", "gallery", "guests"]);
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
 * Effective photo cap: `null` (no sellable cap) for every tier since doc 35 (6 Okt 2026). The staff override
 * (`invitations.photo_cap_override`) and the `gallery` add-on no longer matter: the column stays as dead data. Enforcement
 * uses `getEffectivePhotoCap(tier) ?? PHOTO_TECHNICAL_FENCE`.
 */
export function getEffectivePhotoCap(tier) {
    return TIER_CAPABILITIES[tier].photoCap;
}
/**
 * Effective guest-row cap: `null` (no sellable cap) for every tier since doc 35 (6 Okt 2026); the staff override and the
 * `guests` add-on no longer matter. Enforcement uses `getEffectiveGuestCap(tier) ?? GUEST_TECHNICAL_FENCE`.
 */
export function getEffectiveGuestCap(tier) {
    return TIER_CAPABILITIES[tier].guestCap;
}
const FEATURE_ADDON = Object.freeze({
    qrCheckin: "qrcheckin",
    customDomain: "domain",
    seating: "seating",
});
/** Whether an invitation has a binary feature: the tier grants it (never today) OR it was purchased. A retired add-on
 * ({@link RETIRED_ADDON_IDS}: today `customDomain`) grants nothing even when an old row still records it. */
export function hasFeature(tier, feature, addons) {
    if (TIER_CAPABILITIES[tier][feature])
        return true;
    const addon = FEATURE_ADDON[feature];
    if (RETIRED_ADDON_IDS.includes(addon))
        return false;
    return (addons?.[addon] ?? 0) >= 1;
}
/** Everything an invitation is actually entitled to: tier defaults + purchased (non-retired) add-ons. */
export function getEffectiveCapabilities(tier, addons) {
    return {
        photoCap: getEffectivePhotoCap(tier),
        guestCap: getEffectiveGuestCap(tier),
        qrCheckin: hasFeature(tier, "qrCheckin", addons),
        customDomain: hasFeature(tier, "customDomain", addons),
        seating: hasFeature(tier, "seating", addons),
        durationMonths: TIER_CAPABILITIES[tier].durationMonths,
    };
}
/** Adds `months` to `base` using native UTC month arithmetic, preserving time-of-day. Overflow is
 * native `Date` behavior (e.g. Jan 31 + 1 month -> Mar 3), documented not fought (see
 * `computeExpiresAt`'s own tests for the edge-case matrix). Extracted so every tier-period
 * calculation in this module shares one implementation and can never drift apart. */
function addTierPeriodMonths(base, months) {
    const result = new Date(base);
    result.setUTCMonth(result.getUTCMonth() + months);
    return result;
}
/** Computes `invitations.expires_at` at publish time. Pure — no D1 access. Since doc 35 (6 Okt 2026) every tier has a
 * `null` duration, so this ALWAYS returns `null` (lifetime). The month arithmetic stays, shared with
 * {@link computeExpiresAtFromEvents} via the internal `addTierPeriodMonths` helper, in case an active period ever returns. */
export function computeExpiresAt(activatedAt, tier) {
    const months = TIER_CAPABILITIES[tier].durationMonths;
    if (months === null)
        return null;
    return addTierPeriodMonths(activatedAt, months);
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
/** Indonesia Western time (WIB, UTC+7) — used ONLY for the "no `end_at`" fallback below. Not a
 * general timezone-conversion utility: every other timestamp in this module is UTC. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;
/**
 * 23:59:59.999 WIB on the WIB calendar day containing `instantMs`, returned as a UTC epoch ms.
 * The day is derived from the WIB-shifted instant, not from the raw stored digits, so this stays
 * self-consistent even when `start_at` carries a non-WIB offset (or `Z`): the result is always
 * `>= instantMs`.
 */
function endOfWibDayMs(instantMs) {
    const wibWallClock = new Date(instantMs + WIB_OFFSET_MS);
    const endOfWibDayAsUtcDigits = Date.UTC(wibWallClock.getUTCFullYear(), wibWallClock.getUTCMonth(), wibWallClock.getUTCDate(), 23, 59, 59, 999);
    return endOfWibDayAsUtcDigits - WIB_OFFSET_MS;
}
/**
 * One event's "effective end" — shared by {@link computeExpiresAtFromEvents} and
 * {@link isCheckinWindowOpen} so the rule can never diverge between the two: `end_at` when it
 * parses, else 23:59:59.999 WIB on `start_at`'s WIB calendar day. `null` when neither date is
 * usable. Parses with {@link parseTimestampMs}, so `Z`/`+07:00`/zone-less/`Date` all work exactly
 * as everywhere else in this module.
 */
function effectiveEventEndMs(event) {
    if (!event)
        return null;
    const endMs = parseTimestampMs(event.end_at);
    if (endMs !== null)
        return endMs;
    const startMs = parseTimestampMs(event.start_at);
    return startMs !== null ? endOfWibDayMs(startMs) : null;
}
/** The latest effective end across `events` (see {@link effectiveEventEndMs}), or `null` when no
 * event has a usable date. */
function latestEffectiveEventEndMs(events) {
    if (!events)
        return null;
    let latestMs = null;
    for (const event of events) {
        const endMs = effectiveEventEndMs(event);
        if (endMs !== null && (latestMs === null || endMs > latestMs))
            latestMs = endMs;
    }
    return latestMs;
}
/**
 * Computes `invitations.expires_at` from an invitation's own events (product-rule change,
 * 2026-09-20): basis = the LATEST effective end across `events` (see {@link effectiveEventEndMs})
 * + the tier's period in months, reusing the exact month arithmetic {@link computeExpiresAt} uses
 * (via the shared internal `addTierPeriodMonths`) so month-end behavior never diverges between
 * the two. Falls back to `opts.activatedAt` + the tier period when no event has a usable date;
 * returns `null` when `activatedAt` is missing/unusable too (caller decides, e.g. leave the
 * invitation without an `expires_at` until it has either). The `null`-duration branch is legacy/
 * defensive only, same as {@link computeExpiresAt}. Demos (`is_demo === 1`) are NOT handled here —
 * matching `computeExpiresAt`'s existing convention of leaving that to callers.
 */
export function computeExpiresAtFromEvents(events, tier, opts = {}) {
    const months = TIER_CAPABILITIES[tier].durationMonths;
    if (months === null)
        return null;
    const basisMs = latestEffectiveEventEndMs(events) ?? parseTimestampMs(opts.activatedAt);
    if (basisMs === null)
        return null;
    return addTierPeriodMonths(new Date(basisMs), months).toISOString();
}
/** Minutes before an event's `start_at` a QR check-in scanner may open (product rule,
 * 2026-09-20). One constant, not per-caller. */
export const CHECKIN_PRE_BUFFER_MINUTES = 60;
/** Falls back to {@link CHECKIN_PRE_BUFFER_MINUTES} for a negative, `NaN`/non-finite, or
 * `undefined` value. `0` is a valid, deliberate "no pre-buffer, open exactly at start_at". */
function normalizeBufferMinutes(bufferMinutes) {
    if (typeof bufferMinutes !== "number" || !Number.isFinite(bufferMinutes) || bufferMinutes < 0) {
        return CHECKIN_PRE_BUFFER_MINUTES;
    }
    return bufferMinutes;
}
/**
 * One event's check-in window: `[start_at - bufferMs, effective end]`, boundaries inclusive.
 * Conservative choice, flagged for Pram (not guessed): an event with NO `start_at` never opens a
 * window, even when it has a usable `end_at` — there is no principled way to place the pre-buffer
 * without a start time. This differs from {@link computeExpiresAtFromEvents}, where a bare
 * `end_at` IS usable, because that path needs no start bound.
 */
function isEventCheckinWindowOpen(event, nowMs, bufferMs) {
    if (!event)
        return false;
    const startMs = parseTimestampMs(event.start_at);
    if (startMs === null)
        return false;
    const endMs = effectiveEventEndMs(event);
    if (endMs === null)
        return false; // unreachable: a parsed start_at always yields a fallback end
    return nowMs >= startMs - bufferMs && nowMs <= endMs;
}
/**
 * When the LAST check-in window closes: the latest effective end (see {@link effectiveEventEndMs})
 * among the events that can open a window at all — those with a usable `start_at`, the same
 * events {@link isCheckinWindowOpen} considers. `null` when no event can open a window.
 *
 * Added for the Dashboard Resepsionis (BE-mono-36, doc 22 R2): a receptionist's phone stays
 * signed in until this moment. Exported from here, not recomputed in worker-user, so the session
 * end and the window rule can never disagree about when check-in is over.
 */
export function lastCheckinWindowEnd(events) {
    if (!events)
        return null;
    let latestMs = null;
    for (const event of events) {
        if (parseTimestampMs(event?.start_at) === null)
            continue;
        const endMs = effectiveEventEndMs(event);
        if (endMs !== null && (latestMs === null || endMs > latestMs))
            latestMs = endMs;
    }
    return latestMs === null ? null : new Date(latestMs);
}
/**
 * Whether a QR check-in scanner may accept scans right now: `now` falls within
 * `[start_at - bufferMinutes, effective end]` of ANY event in `events` (same effective-end rule as
 * {@link computeExpiresAtFromEvents}), boundaries inclusive. `testMode: true` always returns
 * `true` (the customer testing a scanner before the event). No usable event — missing/empty
 * `events`, or every event missing `start_at` — closes the window unless `testMode`.
 */
export function isCheckinWindowOpen(events, opts = {}) {
    if (opts.testMode)
        return true;
    if (!events || events.length === 0)
        return false;
    const nowMs = (opts.now ?? new Date()).getTime();
    const bufferMs = normalizeBufferMinutes(opts.bufferMinutes) * MS_PER_MINUTE;
    return events.some((event) => isEventCheckinWindowOpen(event, nowMs, bufferMs));
}
