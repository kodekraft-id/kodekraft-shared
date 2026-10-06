// Doc 35 (6 Okt 2026): every tier is lifetime (`durationMonths: null`), so nothing in production computes an `expires_at` any more.
// The month arithmetic in tier.ts is kept on purpose (an active period may come back, and old rows still carry dates), so these hooks put
// the former 3/6/12-month table back for the length of ONE describe block, keeping that arithmetic tested, and restore `null` afterwards.
import { afterEach, beforeEach } from "vitest";
import { TIER_CAPABILITIES, type PackageTier } from "../../src/tier.js";

export const LEGACY_MONTHS: Readonly<Record<PackageTier, number>> = { basic: 3, premium: 6, exclusive: 12 };

type MutableRow = { durationMonths: number | null };

export function useLegacyDurations(): void {
  beforeEach(() => {
    for (const tier of Object.keys(LEGACY_MONTHS) as PackageTier[]) {
      (TIER_CAPABILITIES[tier] as MutableRow).durationMonths = LEGACY_MONTHS[tier];
    }
  });
  afterEach(() => {
    for (const tier of Object.keys(LEGACY_MONTHS) as PackageTier[]) {
      (TIER_CAPABILITIES[tier] as MutableRow).durationMonths = null;
    }
  });
}
