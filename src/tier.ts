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

/** Computes `invitations.expires_at` at publish time. Pure — no D1 access. The `null` branch is
 * legacy/defensive only (no tier has a null duration any more). */
export function computeExpiresAt(activatedAt: Date, tier: PackageTier): Date | null {
  const months = TIER_CAPABILITIES[tier].durationMonths;
  if (months === null) return null;
  const d = new Date(activatedAt);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}
