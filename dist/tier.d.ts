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
 * legacy/defensive only (no tier has a null duration any more). */
export declare function computeExpiresAt(activatedAt: Date, tier: PackageTier): Date | null;
