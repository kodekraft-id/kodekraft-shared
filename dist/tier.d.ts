/** The 3 package tiers a client can buy. The one canonical type — DB schema's
 * `invitations.package_tier` CHECK constraint should be kept manually in sync with this. */
export type PackageTier = "basic" | "premium" | "exclusive";
export interface TierCapabilities {
    photoCap: number;
    qrCheckin: boolean;
    customDomain: boolean;
    /** Months of active duration after publish; null = never expires ("forever"). */
    durationMonths: number | null;
}
/** Frozen tier -> capability defaults. Changing what a tier unlocks is a pricing decision,
 * same category as changing its price — edited by code review + redeploy, never at runtime. */
export declare const TIER_CAPABILITIES: Readonly<Record<PackageTier, TierCapabilities>>;
/**
 * Effective photo cap for an invitation: the per-buyer staff override
 * (`invitations.photo_cap_override`) if one is set, otherwise the tier default.
 * `0` is a legitimate override value (a real zero-cap), not treated as "no override" —
 * only `null`/`undefined` fall back to the tier default.
 */
export declare function getEffectivePhotoCap(tier: PackageTier, override?: number | null): number;
/** Whether a tier includes a given binary feature (QR check-in / custom domain). */
export declare function hasFeature(tier: PackageTier, feature: "qrCheckin" | "customDomain"): boolean;
/** Computes `invitations.expires_at` at publish time. Pure — no D1 access. */
export declare function computeExpiresAt(activatedAt: Date, tier: PackageTier): Date | null;
