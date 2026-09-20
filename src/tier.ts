// Tier capability map + effective-capability API. Originally BE-mono-10 (doc 11 §1); extended by
// BE-mono-23/24 (doc 17 FR-1): purchased add-ons, photo ceiling, add-ons-only QR/domain, new
// durations. Pure values and predicates only, no D1 access. `assertFeature` is deliberately NOT
// exported from this package (project-docs/12 §5.2): each consuming repo writes its own 3-liner
// over `hasFeature`, throwing its own local `HttpError`, since the response envelope stays per-repo.

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
export const TIER_CAPABILITIES: Readonly<Record<PackageTier, TierCapabilities>> = Object.freeze({
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

const ADDON_IDS: readonly AddonId[] = ["domain", "qrcheckin", "gallery"];
const BINARY_ADDON_IDS: ReadonlySet<AddonId> = new Set<AddonId>(["domain", "qrcheckin"]);

function isAddonId(value: unknown): value is AddonId {
  return typeof value === "string" && (ADDON_IDS as readonly string[]).includes(value);
}

/** Normalizes one stored quantity: positive integers only, clamped to MAX_ADDON_QUANTITY,
 * binary add-ons forced to 1. Returns undefined when the entry must be ignored. */
function normalizeQuantity(id: AddonId, quantity: unknown): number | undefined {
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) return undefined;
  if (BINARY_ADDON_IDS.has(id)) return 1;
  return Math.min(quantity, MAX_ADDON_QUANTITY);
}

/**
 * Tolerant reader for purchased add-ons. Accepts (a) the object shape `{"gallery":2}`, (b) the
 * legacy `settings.addons` string array (each known id => quantity 1), (c) a JSON string of either,
 * (d) null/undefined/garbage => `{}`. Unknown ids (incl. `express`) and non-positive-integer
 * quantities are ignored. Never throws.
 */
export function parsePurchasedAddons(raw: unknown): PurchasedAddons {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  const result: PurchasedAddons = {};
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (isAddonId(entry)) result[entry] = 1;
    }
    return result;
  }
  if (typeof value !== "object" || value === null) return result;
  const record = value as Record<string, unknown>;
  for (const id of ADDON_IDS) {
    if (!Object.prototype.hasOwnProperty.call(record, id)) continue;
    const quantity = normalizeQuantity(id, record[id]);
    if (quantity !== undefined) result[id] = quantity;
  }
  return result;
}

/**
 * Most `gallery` units that still change the photo cap for a tier (storefront limit / server
 * rejection): Basic 3, Premium 3, Exclusive 0.
 */
export function maxUsefulGalleryUnits(tier: PackageTier): number {
  return Math.max(0, Math.ceil((PHOTO_CEILING - TIER_CAPABILITIES[tier].photoCap) / GALLERY_ADDON_PHOTOS));
}

/**
 * Effective photo cap: staff override (`invitations.photo_cap_override`) if set, otherwise
 * `min(tierCap + 15 x galleryQty, PHOTO_CEILING)` (never below the tier's own cap). `0` is a
 * legitimate override; only `null`/`undefined` fall back. An override may exceed the ceiling.
 */
export function getEffectivePhotoCap(
  tier: PackageTier,
  override?: number | null,
  addons?: PurchasedAddons | null,
): number {
  if (override !== null && override !== undefined) return override;
  const tierCap = TIER_CAPABILITIES[tier].photoCap;
  const withGallery = tierCap + GALLERY_ADDON_PHOTOS * (addons?.gallery ?? 0);
  return Math.max(tierCap, Math.min(withGallery, PHOTO_CEILING));
}

/** Whether an invitation has a binary feature: the tier grants it (never today) OR it was purchased. */
export function hasFeature(
  tier: PackageTier,
  feature: "qrCheckin" | "customDomain",
  addons?: PurchasedAddons | null,
): boolean {
  if (TIER_CAPABILITIES[tier][feature]) return true;
  const addonId: AddonId = feature === "qrCheckin" ? "qrcheckin" : "domain";
  return (addons?.[addonId] ?? 0) >= 1;
}

/** Everything an invitation is actually entitled to: tier defaults + purchased add-ons + staff override. */
export function getEffectiveCapabilities(
  tier: PackageTier,
  addons?: PurchasedAddons | null,
  photoCapOverride?: number | null,
): TierCapabilities {
  return {
    photoCap: getEffectivePhotoCap(tier, photoCapOverride, addons),
    qrCheckin: hasFeature(tier, "qrCheckin", addons),
    customDomain: hasFeature(tier, "customDomain", addons),
    durationMonths: TIER_CAPABILITIES[tier].durationMonths,
  };
}

/** Adds `months` to `base` using native UTC month arithmetic, preserving time-of-day. Overflow is
 * native `Date` behavior (e.g. Jan 31 + 1 month -> Mar 3), documented not fought (see
 * `computeExpiresAt`'s own tests for the edge-case matrix). Extracted so every tier-period
 * calculation in this module shares one implementation and can never drift apart. */
function addTierPeriodMonths(base: Date, months: number): Date {
  const result = new Date(base);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/** Computes `invitations.expires_at` at publish time. Pure — no D1 access. The `null` branch is
 * legacy/defensive only (no tier has a null duration any more). Shares its month arithmetic with
 * {@link computeExpiresAtFromEvents} via the internal `addTierPeriodMonths` helper. */
export function computeExpiresAt(activatedAt: Date, tier: PackageTier): Date | null {
  const months = TIER_CAPABILITIES[tier].durationMonths;
  if (months === null) return null;
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

const ISO_HAS_ZONE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/**
 * Parses a stored timestamp to epoch ms. Accepts a `Date`, UTC ISO (`...Z`), an offset ISO
 * (`...+07:00`), and a zone-less string (`YYYY-MM-DD HH:MM:SS` from SQLite `datetime('now')`, or
 * `YYYY-MM-DDTHH:MM:SS`), which is interpreted as UTC. Returns `null` for null/undefined/empty/
 * unparseable input.
 */
export function parseTimestampMs(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value !== "string") return null;
  let normalized = value.trim();
  if (normalized === "") return null;
  if (SQLITE_DATETIME.test(normalized)) normalized = normalized.replace(" ", "T");
  if (!ISO_HAS_ZONE.test(normalized)) normalized += "Z";
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
}

function isDemo(row: ExpirableInvitation | null | undefined): boolean {
  return row?.is_demo === 1;
}

/**
 * True when the invitation's tier time limit has passed (`expires_at <= now`, boundary inclusive).
 * `false` for demos (`is_demo === 1`, even with a past `expires_at`), for NULL/missing `expires_at`
 * (legacy rows: "not expired"), and for an unparseable `expires_at` (fail-open: never lock a
 * customer on garbage). A null/undefined row is `false`.
 */
export function isInvitationExpired(
  row: ExpirableInvitation | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!row || isDemo(row)) return false;
  const expiresMs = parseTimestampMs(row.expires_at);
  if (expiresMs === null) return false;
  return expiresMs <= now.getTime();
}

/**
 * True when the dashboard is LOCKED: `now >= expires_at + graceDays` (boundary inclusive). Between
 * `expires_at` and that instant the dashboard is read-only. Demos and NULL `expires_at` are never
 * locked. `graceDays` defaults to {@link EXPIRY_GRACE_DAYS}; a negative/non-finite value falls back
 * to the default.
 */
export function isInvitationLocked(
  row: ExpirableInvitation | null | undefined,
  now: Date = new Date(),
  graceDays: number = EXPIRY_GRACE_DAYS,
): boolean {
  if (!row || isDemo(row)) return false;
  const expiresMs = parseTimestampMs(row.expires_at);
  if (expiresMs === null) return false;
  const days = Number.isFinite(graceDays) && graceDays >= 0 ? graceDays : EXPIRY_GRACE_DAYS;
  return expiresMs + days * MS_PER_DAY <= now.getTime();
}

/** `active` (not expired) | `grace` (expired, dashboard read-only + export) | `locked` (grace over). */
export function getInvitationExpiryState(
  row: ExpirableInvitation | null | undefined,
  now: Date = new Date(),
  graceDays: number = EXPIRY_GRACE_DAYS,
): InvitationExpiryState {
  if (!isInvitationExpired(row, now)) return "active";
  return isInvitationLocked(row, now, graceDays) ? "locked" : "grace";
}

/**
 * Whether a custom domain may be served (doc 17 FR-15.2 / OQ-17): `status === 'active'` AND the
 * domain's own `expires_at` is NULL or in the future (`> now`) AND the invitation is within its
 * active period (demos exempt, via {@link isInvitationExpired}). A null/missing domain is inactive.
 */
export function isDomainActive(
  domain: DomainLifecycle | null | undefined,
  invitation: ExpirableInvitation | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!domain || domain.status !== "active") return false;
  const domainExpiresMs = parseTimestampMs(domain.expires_at);
  if (domainExpiresMs !== null && domainExpiresMs <= now.getTime()) return false;
  return !isInvitationExpired(invitation, now);
}

// ---------------------------------------------------------------------------------------------
// Event-based expiry + check-in pre-window. Direct product-rule change from Pram (2026-09-20),
// shipped additively (v0.8.0): (A) an invitation's tier period now counts from the LATEST event
// end, not first publish (`computeExpiresAt`/`activatedAt`-only stays exactly as-is, as the
// fallback path); (B) a QR check-in scanner may open up to CHECKIN_PRE_BUFFER_MINUTES before an
// event starts. Pure functions, injectable `now`, no D1 access — same conventions as the expiry/
// grace section above.
// ---------------------------------------------------------------------------------------------

/** Minimal `events` row shape the schedule-based helpers below need: both fields optional/
 * nullable so a raw D1 row, a partial select, or a legacy row all work. Field names match the D1
 * columns (snake_case) directly — no mapping layer required. */
export interface EventWindow {
  start_at?: string | Date | null;
  end_at?: string | Date | null;
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
function endOfWibDayMs(instantMs: number): number {
  const wibWallClock = new Date(instantMs + WIB_OFFSET_MS);
  const endOfWibDayAsUtcDigits = Date.UTC(
    wibWallClock.getUTCFullYear(),
    wibWallClock.getUTCMonth(),
    wibWallClock.getUTCDate(),
    23,
    59,
    59,
    999,
  );
  return endOfWibDayAsUtcDigits - WIB_OFFSET_MS;
}

/**
 * One event's "effective end" — shared by {@link computeExpiresAtFromEvents} and
 * {@link isCheckinWindowOpen} so the rule can never diverge between the two: `end_at` when it
 * parses, else 23:59:59.999 WIB on `start_at`'s WIB calendar day. `null` when neither date is
 * usable. Parses with {@link parseTimestampMs}, so `Z`/`+07:00`/zone-less/`Date` all work exactly
 * as everywhere else in this module.
 */
function effectiveEventEndMs(event: EventWindow | null | undefined): number | null {
  if (!event) return null;
  const endMs = parseTimestampMs(event.end_at);
  if (endMs !== null) return endMs;
  const startMs = parseTimestampMs(event.start_at);
  return startMs !== null ? endOfWibDayMs(startMs) : null;
}

/** The latest effective end across `events` (see {@link effectiveEventEndMs}), or `null` when no
 * event has a usable date. */
function latestEffectiveEventEndMs(events: readonly EventWindow[] | null | undefined): number | null {
  if (!events) return null;
  let latestMs: number | null = null;
  for (const event of events) {
    const endMs = effectiveEventEndMs(event);
    if (endMs !== null && (latestMs === null || endMs > latestMs)) latestMs = endMs;
  }
  return latestMs;
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
export function computeExpiresAtFromEvents(
  events: readonly EventWindow[] | null | undefined,
  tier: PackageTier,
  opts: ComputeExpiresAtFromEventsOptions = {},
): string | null {
  const months = TIER_CAPABILITIES[tier].durationMonths;
  if (months === null) return null;

  const basisMs = latestEffectiveEventEndMs(events) ?? parseTimestampMs(opts.activatedAt);
  if (basisMs === null) return null;

  return addTierPeriodMonths(new Date(basisMs), months).toISOString();
}

/** Minutes before an event's `start_at` a QR check-in scanner may open (product rule,
 * 2026-09-20). One constant, not per-caller. */
export const CHECKIN_PRE_BUFFER_MINUTES = 60;

/** Falls back to {@link CHECKIN_PRE_BUFFER_MINUTES} for a negative, `NaN`/non-finite, or
 * `undefined` value. `0` is a valid, deliberate "no pre-buffer, open exactly at start_at". */
function normalizeBufferMinutes(bufferMinutes: number | undefined): number {
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
function isEventCheckinWindowOpen(event: EventWindow | null | undefined, nowMs: number, bufferMs: number): boolean {
  if (!event) return false;
  const startMs = parseTimestampMs(event.start_at);
  if (startMs === null) return false;
  const endMs = effectiveEventEndMs(event);
  if (endMs === null) return false; // unreachable: a parsed start_at always yields a fallback end
  return nowMs >= startMs - bufferMs && nowMs <= endMs;
}

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
export function isCheckinWindowOpen(
  events: readonly EventWindow[] | null | undefined,
  opts: CheckinWindowOptions = {},
): boolean {
  if (opts.testMode) return true;
  if (!events || events.length === 0) return false;

  const nowMs = (opts.now ?? new Date()).getTime();
  const bufferMs = normalizeBufferMinutes(opts.bufferMinutes) * MS_PER_MINUTE;
  return events.some((event) => isEventCheckinWindowOpen(event, nowMs, bufferMs));
}
