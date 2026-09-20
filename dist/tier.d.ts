/** The 3 package tiers a client can buy. The one canonical type — DB schema's
 * `invitations.package_tier` CHECK constraint should be kept manually in sync with this. */
export type PackageTier = "basic" | "premium" | "exclusive";
export interface TierCapabilities {
    photoCap: number;
    /** Always `false` at every tier (doc 17 ruling 13): QR check-in is an ADD-ON ONLY. Kept as a
     * field so the type shape and existing 2-arg callers still compile. */
    qrCheckin: boolean;
    /** Always `false` at every tier (doc 17 ruling 13): custom domain is an ADD-ON ONLY. */
    customDomain: boolean;
    /** Months of active duration after publish. Every tier has a number today (doc 17 rulings
     * 20/21); `null` = "never expires" is kept in the type ONLY for legacy/defensive paths. */
    durationMonths: number | null;
}
/** Capability-bearing purchasable add-on ids (doc 17 §4). `express` is deliberately NOT one. */
export type AddonId = "domain" | "qrcheckin" | "gallery";
/** Per-invitation purchased add-ons: `{ [addonId]: quantity }`, persisted in
 * `invitations.purchased_addons` (JSON, nullable). Binary add-ons are always quantity 1. */
export type PurchasedAddons = Partial<Record<AddonId, number>>;
/** Extra photos granted by one `gallery` add-on unit. */
export declare const GALLERY_ADDON_PHOTOS = 15;
/** Hard photo ceiling for the tier-plus-add-on path (doc 17 ruling 7). A staff override may exceed it. */
export declare const PHOTO_CEILING = 50;
/** Sane upper bound applied when parsing a stored add-on quantity (defends against garbage rows). */
export declare const MAX_ADDON_QUANTITY = 99;
/** Frozen tier -> capability defaults. Changing what a tier unlocks is a pricing decision,
 * same category as changing its price — edited by code review + redeploy, never at runtime.
 * v0.4.0 VALUE CHANGE: qrCheckin/customDomain are false at every tier (add-ons only);
 * durations are basic 3 / premium 6 / exclusive 12 (no tier is "never expires"). */
export declare const TIER_CAPABILITIES: Readonly<Record<PackageTier, TierCapabilities>>;
/**
 * Tolerant reader for purchased add-ons. Accepts (a) the object shape `{"gallery":2}`, (b) the
 * legacy `settings.addons` string array (each known id => quantity 1), (c) a JSON string of either,
 * (d) null/undefined/garbage => `{}`. Unknown ids (incl. `express`) and non-positive-integer
 * quantities are ignored. Never throws.
 */
export declare function parsePurchasedAddons(raw: unknown): PurchasedAddons;
/**
 * Most `gallery` units that still change the photo cap for a tier (storefront limit / server
 * rejection): Basic 3, Premium 3, Exclusive 0.
 */
export declare function maxUsefulGalleryUnits(tier: PackageTier): number;
/**
 * Effective photo cap: staff override (`invitations.photo_cap_override`) if set, otherwise
 * `min(tierCap + 15 x galleryQty, PHOTO_CEILING)` (never below the tier's own cap). `0` is a
 * legitimate override; only `null`/`undefined` fall back. An override may exceed the ceiling.
 */
export declare function getEffectivePhotoCap(tier: PackageTier, override?: number | null, addons?: PurchasedAddons | null): number;
/** Whether an invitation has a binary feature: the tier grants it (never today) OR it was purchased. */
export declare function hasFeature(tier: PackageTier, feature: "qrCheckin" | "customDomain", addons?: PurchasedAddons | null): boolean;
/** Everything an invitation is actually entitled to: tier defaults + purchased add-ons + staff override. */
export declare function getEffectiveCapabilities(tier: PackageTier, addons?: PurchasedAddons | null, photoCapOverride?: number | null): TierCapabilities;
/** Computes `invitations.expires_at` at publish time. Pure — no D1 access. The `null` branch is
 * legacy/defensive only (no tier has a null duration any more). Shares its month arithmetic with
 * {@link computeExpiresAtFromEvents} via the internal `addTierPeriodMonths` helper. */
export declare function computeExpiresAt(activatedAt: Date, tier: PackageTier): Date | null;
/** Dashboard read-only grace after `expires_at` (OQ-20: "~30 days"). One constant, not per-caller. */
export declare const EXPIRY_GRACE_DAYS = 30;
/** Lifecycle state of an invitation relative to its tier time limit. */
export type InvitationExpiryState = "active" | "grace" | "locked";
/** Minimal row shape the expiry helpers need; both fields optional/nullable so a raw D1 row, a
 * partial select, or a legacy row all work. `is_demo` is INTEGER 0/1: only `=== 1` counts as demo. */
export interface ExpirableInvitation {
    is_demo?: number | null;
    expires_at?: string | Date | null;
}
/** Minimal `invitation_domains` shape for {@link isDomainActive}. */
export interface DomainLifecycle {
    status?: string | null;
    expires_at?: string | Date | null;
}
/**
 * Parses a stored timestamp to epoch ms. Accepts a `Date`, UTC ISO (`...Z`), an offset ISO
 * (`...+07:00`), and a zone-less string (`YYYY-MM-DD HH:MM:SS` from SQLite `datetime('now')`, or
 * `YYYY-MM-DDTHH:MM:SS`), which is interpreted as UTC. Returns `null` for null/undefined/empty/
 * unparseable input.
 */
export declare function parseTimestampMs(value: string | Date | null | undefined): number | null;
/**
 * True when the invitation's tier time limit has passed (`expires_at <= now`, boundary inclusive).
 * `false` for demos (`is_demo === 1`, even with a past `expires_at`), for NULL/missing `expires_at`
 * (legacy rows: "not expired"), and for an unparseable `expires_at` (fail-open: never lock a
 * customer on garbage). A null/undefined row is `false`.
 */
export declare function isInvitationExpired(row: ExpirableInvitation | null | undefined, now?: Date): boolean;
/**
 * True when the dashboard is LOCKED: `now >= expires_at + graceDays` (boundary inclusive). Between
 * `expires_at` and that instant the dashboard is read-only. Demos and NULL `expires_at` are never
 * locked. `graceDays` defaults to {@link EXPIRY_GRACE_DAYS}; a negative/non-finite value falls back
 * to the default.
 */
export declare function isInvitationLocked(row: ExpirableInvitation | null | undefined, now?: Date, graceDays?: number): boolean;
/** `active` (not expired) | `grace` (expired, dashboard read-only + export) | `locked` (grace over). */
export declare function getInvitationExpiryState(row: ExpirableInvitation | null | undefined, now?: Date, graceDays?: number): InvitationExpiryState;
/**
 * Whether a custom domain may be served (doc 17 FR-15.2 / OQ-17): `status === 'active'` AND the
 * domain's own `expires_at` is NULL or in the future (`> now`) AND the invitation is within its
 * active period (demos exempt, via {@link isInvitationExpired}). A null/missing domain is inactive.
 */
export declare function isDomainActive(domain: DomainLifecycle | null | undefined, invitation: ExpirableInvitation | null | undefined, now?: Date): boolean;
/** Minimal `events` row shape the schedule-based helpers below need: both fields optional/
 * nullable so a raw D1 row, a partial select, or a legacy row all work. Field names match the D1
 * columns (snake_case) directly — no mapping layer required. */
export interface EventWindow {
    start_at?: string | Date | null;
    end_at?: string | Date | null;
}
/** Options for {@link computeExpiresAtFromEvents}. */
export interface ComputeExpiresAtFromEventsOptions {
    /** Fallback basis when no event in `events` has a usable date. Parsed with
     * {@link parseTimestampMs} (accepts the same shapes as everywhere else in this module). */
    activatedAt?: string | Date | null;
    /** Accepted for signature symmetry with this module's other injectable-`now` helpers. NOT used
     * today: the result is fully determined by `events`/`activatedAt`, never by wall-clock time. */
    now?: Date;
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
export declare function computeExpiresAtFromEvents(events: readonly EventWindow[] | null | undefined, tier: PackageTier, opts?: ComputeExpiresAtFromEventsOptions): string | null;
/** Minutes before an event's `start_at` a QR check-in scanner may open (product rule,
 * 2026-09-20). One constant, not per-caller. */
export declare const CHECKIN_PRE_BUFFER_MINUTES = 60;
/** Options for {@link isCheckinWindowOpen}. */
export interface CheckinWindowOptions {
    /** Defaults to `new Date()`. */
    now?: Date;
    /** Minutes before `start_at` the window opens. Defaults to, and falls back on an invalid value
     * to, {@link CHECKIN_PRE_BUFFER_MINUTES}. */
    bufferMinutes?: number;
    /** `true` always opens the window (staff testing a scanner ahead of the event). Short-circuits
     * every other check, including "no usable events". */
    testMode?: boolean;
}
/**
 * Whether a QR check-in scanner may accept scans right now: `now` falls within
 * `[start_at - bufferMinutes, effective end]` of ANY event in `events` (same effective-end rule as
 * {@link computeExpiresAtFromEvents}), boundaries inclusive. `testMode: true` always returns
 * `true` (the customer testing a scanner before the event). No usable event — missing/empty
 * `events`, or every event missing `start_at` — closes the window unless `testMode`.
 */
export declare function isCheckinWindowOpen(events: readonly EventWindow[] | null | undefined, opts?: CheckinWindowOptions): boolean;
