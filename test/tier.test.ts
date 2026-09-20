// Unit tests for the tier capability map and effective-capability API (BE-mono-10, BE-mono-23,
// BE-mono-24), against the real exports, not a fixture. Source design: project-docs/11 section 1
// and project-docs/17-tier-addons-requirements.md FR-1 (AC-1.1 .. AC-1.9).

import { describe, expect, it } from "vitest";
import {
  GALLERY_ADDON_PHOTOS,
  MAX_ADDON_QUANTITY,
  PHOTO_CEILING,
  TIER_CAPABILITIES,
  computeExpiresAt,
  getEffectiveCapabilities,
  getEffectivePhotoCap,
  hasFeature,
  maxUsefulGalleryUnits,
  parsePurchasedAddons,
  type PackageTier,
  type PurchasedAddons,
} from "../src/tier.js";

const TIERS: PackageTier[] = ["basic", "premium", "exclusive"];
const TIER_PHOTO_CAP: Record<PackageTier, number> = { basic: 5, premium: 15, exclusive: 50 };
const TIER_MONTHS: Record<PackageTier, number> = { basic: 3, premium: 6, exclusive: 12 };

describe("TIER_CAPABILITIES", () => {
  it("has exactly the 3 documented tiers", () => {
    expect(Object.keys(TIER_CAPABILITIES).sort()).toEqual(["basic", "exclusive", "premium"]);
  });

  it.each(TIERS)("%s: photo cap and duration match the rulings; QR and domain are add-ons only", (tier) => {
    expect(TIER_CAPABILITIES[tier]).toEqual({
      photoCap: TIER_PHOTO_CAP[tier],
      qrCheckin: false,
      customDomain: false,
      durationMonths: TIER_MONTHS[tier],
    });
  });

  it("has no tier with a null duration, and Premium is strictly between Basic and Exclusive", () => {
    for (const tier of TIERS) expect(TIER_CAPABILITIES[tier].durationMonths).not.toBeNull();
    const premium = TIER_CAPABILITIES.premium.durationMonths as number;
    expect(premium).toBeGreaterThan(3);
    expect(premium).toBeLessThan(12);
  });

  it("is frozen (Object.freeze) at the top level", () => {
    expect(Object.isFrozen(TIER_CAPABILITIES)).toBe(true);
  });

  it("exports the documented constants", () => {
    expect(GALLERY_ADDON_PHOTOS).toBe(15);
    expect(PHOTO_CEILING).toBe(50);
    expect(MAX_ADDON_QUANTITY).toBe(99);
  });
});

describe("maxUsefulGalleryUnits", () => {
  it("is 3 for basic, 3 for premium, 0 for exclusive", () => {
    expect(maxUsefulGalleryUnits("basic")).toBe(3);
    expect(maxUsefulGalleryUnits("premium")).toBe(3);
    expect(maxUsefulGalleryUnits("exclusive")).toBe(0);
  });

  it("the max useful units reach the ceiling, one fewer does not (basic, premium)", () => {
    for (const tier of ["basic", "premium"] as const) {
      const units = maxUsefulGalleryUnits(tier);
      expect(getEffectivePhotoCap(tier, null, { gallery: units })).toBe(PHOTO_CEILING);
      expect(getEffectivePhotoCap(tier, null, { gallery: units - 1 })).toBeLessThan(PHOTO_CEILING);
    }
  });
});

describe("parsePurchasedAddons", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["number", 5],
    ["boolean", true],
    ["empty string", ""],
    ["invalid JSON string", "{not json"],
    ["JSON string of a number", "42"],
    ["JSON string null", "null"],
    ["empty object", {}],
    ["empty array", []],
    ["function", () => 1],
    ["symbol", Symbol("x")],
  ])("garbage/empty %s => {}", (_label, raw) => {
    expect(parsePurchasedAddons(raw)).toEqual({});
  });

  it("accepts the object shape", () => {
    expect(parsePurchasedAddons({ gallery: 2, qrcheckin: 1, domain: 1 })).toEqual({ gallery: 2, qrcheckin: 1, domain: 1 });
  });

  it("accepts a JSON string of the object shape", () => {
    expect(parsePurchasedAddons('{"gallery":2}')).toEqual({ gallery: 2 });
  });

  it("accepts the legacy settings.addons string array, ignoring express and unknown ids", () => {
    expect(parsePurchasedAddons(["qrcheckin", "express", "bogus"])).toEqual({ qrcheckin: 1 });
    expect(parsePurchasedAddons(["gallery", "domain"])).toEqual({ gallery: 1, domain: 1 });
  });

  it("accepts a JSON string of the legacy array", () => {
    expect(parsePurchasedAddons('["qrcheckin","express"]')).toEqual({ qrcheckin: 1 });
  });

  it("ignores non-string entries in a legacy array", () => {
    expect(parsePurchasedAddons([1, null, {}, "qrcheckin"])).toEqual({ qrcheckin: 1 });
  });

  it("ignores unknown and express keys in the object shape", () => {
    expect(parsePurchasedAddons({ express: 1, bogus: 3, gallery: 1 })).toEqual({ gallery: 1 });
  });

  it.each([-1, 0, 1.5, NaN, Infinity, "2", null, true, {}])("ignores invalid quantity %s", (quantity) => {
    expect(parsePurchasedAddons({ gallery: quantity, qrcheckin: quantity })).toEqual({});
  });

  it("clamps gallery quantity to MAX_ADDON_QUANTITY", () => {
    expect(parsePurchasedAddons({ gallery: 1000 })).toEqual({ gallery: MAX_ADDON_QUANTITY });
  });

  it("normalizes binary add-ons to quantity 1", () => {
    expect(parsePurchasedAddons({ qrcheckin: 5, domain: 3 })).toEqual({ qrcheckin: 1, domain: 1 });
  });

  it("does not read inherited keys and does not pollute prototypes", () => {
    expect(parsePurchasedAddons(JSON.parse('{"__proto__":{"gallery":5}}'))).toEqual({});
    expect(parsePurchasedAddons(Object.create({ gallery: 3 }))).toEqual({});
    expect(({} as Record<string, unknown>).gallery).toBeUndefined();
  });
});

describe("hasFeature (2-arg: tier defaults only)", () => {
  it.each(TIERS)("%s: qrCheckin and customDomain are false without add-ons (Premium lost QR, Exclusive lost domain)", (tier) => {
    expect(hasFeature(tier, "qrCheckin")).toBe(false);
    expect(hasFeature(tier, "customDomain")).toBe(false);
  });
});

describe("hasFeature (with add-ons)", () => {
  it.each(TIERS)("%s: qrcheckin add-on => qrCheckin true, customDomain false", (tier) => {
    expect(hasFeature(tier, "qrCheckin", { qrcheckin: 1 })).toBe(true);
    expect(hasFeature(tier, "customDomain", { qrcheckin: 1 })).toBe(false);
  });

  it.each(TIERS)("%s: domain add-on => customDomain true, qrCheckin false", (tier) => {
    expect(hasFeature(tier, "customDomain", { domain: 1 })).toBe(true);
    expect(hasFeature(tier, "qrCheckin", { domain: 1 })).toBe(false);
  });

  it("a gallery add-on grants neither feature; empty/null/undefined add-ons grant nothing", () => {
    expect(hasFeature("basic", "qrCheckin", { gallery: 3 })).toBe(false);
    expect(hasFeature("basic", "customDomain", {})).toBe(false);
    expect(hasFeature("basic", "qrCheckin", null)).toBe(false);
    expect(hasFeature("basic", "qrCheckin", undefined)).toBe(false);
  });

  it("a zero quantity is not an entitlement", () => {
    expect(hasFeature("basic", "qrCheckin", { qrcheckin: 0 })).toBe(false);
  });
});

describe("getEffectivePhotoCap", () => {
  it("returns the tier default when no override and no add-ons", () => {
    for (const tier of TIERS) expect(getEffectivePhotoCap(tier)).toBe(TIER_PHOTO_CAP[tier]);
  });

  it("null/undefined override falls through to the tier default", () => {
    expect(getEffectivePhotoCap("basic", null)).toBe(5);
    expect(getEffectivePhotoCap("basic", undefined)).toBe(5);
    expect(getEffectivePhotoCap("basic", undefined, null)).toBe(5);
  });

  it("override wins and may exceed the ceiling", () => {
    expect(getEffectivePhotoCap("basic", 20)).toBe(20);
    expect(getEffectivePhotoCap("exclusive", 100)).toBe(100);
    expect(getEffectivePhotoCap("basic", 80, {})).toBe(80);
  });

  it("an override of 0 is a legitimate zero-cap, even with gallery add-ons", () => {
    expect(getEffectivePhotoCap("premium", 0)).toBe(0);
    expect(getEffectivePhotoCap("basic", 0, { gallery: 3 })).toBe(0);
  });

  it("an override beats the add-on path", () => {
    expect(getEffectivePhotoCap("basic", 8, { gallery: 3 })).toBe(8);
  });

  const galleryMatrix: Array<[PackageTier, number, number]> = [
    ["basic", 0, 5],
    ["basic", 1, 20],
    ["basic", 2, 35],
    ["basic", 3, 50],
    ["basic", 4, 50],
    ["basic", 10, 50],
    ["basic", MAX_ADDON_QUANTITY, 50],
    ["premium", 0, 15],
    ["premium", 1, 30],
    ["premium", 2, 45],
    ["premium", 3, 50],
    ["premium", 4, 50],
    ["premium", 10, 50],
    ["exclusive", 0, 50],
    ["exclusive", 1, 50],
    ["exclusive", 3, 50],
    ["exclusive", 10, 50],
  ];
  it.each(galleryMatrix)("%s + gallery x%i => %i (ceiling-clamped)", (tier, quantity, expected) => {
    expect(getEffectivePhotoCap(tier, null, { gallery: quantity })).toBe(expected);
  });

  it("qrcheckin/domain add-ons never change the photo cap", () => {
    expect(getEffectivePhotoCap("basic", null, { qrcheckin: 1, domain: 1 })).toBe(5);
  });
});

describe("getEffectiveCapabilities", () => {
  it.each(TIERS)("%s with no add-ons equals TIER_CAPABILITIES (AC-1.1)", (tier) => {
    expect(getEffectiveCapabilities(tier, {})).toEqual(TIER_CAPABILITIES[tier]);
    expect(getEffectiveCapabilities(tier)).toEqual(TIER_CAPABILITIES[tier]);
    expect(getEffectiveCapabilities(tier, null, null)).toEqual(TIER_CAPABILITIES[tier]);
  });

  // 3 tiers x every combination of {qrcheckin, domain, gallery 0/2} x override (none/null/0/8/80)
  const addonCombos: PurchasedAddons[] = [];
  for (const qr of [0, 1]) {
    for (const domain of [0, 1]) {
      for (const gallery of [0, 2]) {
        const combo: PurchasedAddons = {};
        if (qr) combo.qrcheckin = 1;
        if (domain) combo.domain = 1;
        if (gallery) combo.gallery = gallery;
        addonCombos.push(combo);
      }
    }
  }
  const overrides: Array<number | null | undefined> = [undefined, null, 0, 8, 80];
  const cases = addonCombos.flatMap((combo) => overrides.map((override) => ({ combo, override })));

  describe.each(TIERS)("%s", (tier) => {
    it.each(cases)("addons $combo override $override", ({ combo, override }) => {
      const galleryCap = Math.min(TIER_PHOTO_CAP[tier] + 15 * (combo.gallery ?? 0), 50);
      expect(getEffectiveCapabilities(tier, combo, override)).toEqual({
        photoCap: override ?? Math.max(TIER_PHOTO_CAP[tier], galleryCap),
        qrCheckin: combo.qrcheckin === 1,
        customDomain: combo.domain === 1,
        durationMonths: TIER_MONTHS[tier],
      });
    });
  });

  it("specific spec cells (AC-1.3 / 1.4 / 1.5)", () => {
    expect(getEffectiveCapabilities("basic", { gallery: 2 }).photoCap).toBe(35);
    expect(getEffectiveCapabilities("premium", { gallery: 1 }).photoCap).toBe(30);
    expect(getEffectiveCapabilities("premium", { gallery: 3 }).photoCap).toBe(50);
    expect(getEffectiveCapabilities("basic", { gallery: 3 }, 8).photoCap).toBe(8);
    expect(getEffectiveCapabilities("basic", { gallery: 3 }, 0).photoCap).toBe(0);
    expect(getEffectiveCapabilities("basic", {}, 80).photoCap).toBe(80);
    expect(getEffectiveCapabilities("exclusive", { domain: 1, qrcheckin: 1 })).toEqual({
      photoCap: 50,
      qrCheckin: true,
      customDomain: true,
      durationMonths: 12,
    });
  });

  it("accepts frozen add-ons (does not mutate inputs)", () => {
    expect(getEffectiveCapabilities("basic", Object.freeze({ gallery: 2 }), 3).photoCap).toBe(3);
  });

  it("composes with parsePurchasedAddons for stored values (JSON, legacy array, garbage)", () => {
    expect(getEffectiveCapabilities("basic", parsePurchasedAddons('{"gallery":1,"qrcheckin":1}'))).toMatchObject({
      photoCap: 20,
      qrCheckin: true,
    });
    expect(getEffectiveCapabilities("premium", parsePurchasedAddons(["qrcheckin"])).qrCheckin).toBe(true);
    expect(getEffectiveCapabilities("premium", parsePurchasedAddons("garbage"))).toEqual(TIER_CAPABILITIES.premium);
  });
});

describe("computeExpiresAt", () => {
  const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

  it.each([
    ["basic", at(2026, 1, 15), at(2026, 4, 15)],
    ["premium", at(2026, 1, 15), at(2026, 7, 15)],
    ["exclusive", at(2026, 1, 15), at(2027, 1, 15)],
    ["basic", at(2026, 11, 15), at(2027, 2, 15)],
    ["premium", at(2026, 8, 15), at(2027, 2, 15)],
    ["exclusive", at(2026, 12, 31), at(2027, 12, 31)],
  ] as const)("%s from %s", (tier, activatedAt, expected) => {
    expect(computeExpiresAt(activatedAt, tier)).toEqual(expected);
  });

  it("returns a Date (never null) for every tier", () => {
    for (const tier of TIERS) expect(computeExpiresAt(at(2026, 1, 15), tier)).toBeInstanceOf(Date);
  });

  it("does not mutate the activatedAt argument", () => {
    const activatedAt = at(2026, 1, 15);
    const original = activatedAt.getTime();
    for (const tier of TIERS) computeExpiresAt(activatedAt, tier);
    expect(activatedAt.getTime()).toBe(original);
  });

  it("preserves the time-of-day component", () => {
    const activatedAt = new Date(Date.UTC(2026, 0, 15, 13, 45, 12, 500));
    expect(computeExpiresAt(activatedAt, "premium")).toEqual(new Date(Date.UTC(2026, 6, 15, 13, 45, 12, 500)));
  });

  // Month-end edge cases: native setUTCMonth overflow is documented, not fought (unchanged behavior).
  it.each([
    ["basic", at(2026, 1, 31), at(2026, 5, 1)], // Apr 31 -> May 1
    ["basic", at(2026, 11, 30), at(2027, 3, 2)], // Feb 30 (2027 has 28 days) -> Mar 2
    ["basic", at(2026, 8, 31), at(2026, 12, 1)], // Nov 31 -> Dec 1
    ["premium", at(2026, 1, 31), at(2026, 7, 31)], // Jul has 31 days: no overflow
    ["premium", at(2026, 8, 31), at(2027, 3, 3)], // Feb 31 -> Mar 3
    ["premium", at(2026, 12, 31), at(2027, 7, 1)], // Jun 31 -> Jul 1
    ["exclusive", at(2028, 2, 29), at(2029, 3, 1)], // leap day + 12 months -> Mar 1
    ["exclusive", at(2027, 2, 28), at(2028, 2, 28)],
    ["exclusive", at(2026, 10, 31), at(2027, 10, 31)],
  ] as const)("month-end: %s from %s", (tier, activatedAt, expected) => {
    expect(computeExpiresAt(activatedAt, tier)).toEqual(expected);
  });

  it("legacy/defensive: a null duration returns null (test-only injection, restored after)", () => {
    const basic = TIER_CAPABILITIES.basic as { durationMonths: number | null };
    const original = basic.durationMonths;
    try {
      basic.durationMonths = null;
      expect(computeExpiresAt(at(2026, 1, 15), "basic")).toBeNull();
    } finally {
      basic.durationMonths = original;
    }
    expect(TIER_CAPABILITIES.basic.durationMonths).toBe(3);
  });
});
