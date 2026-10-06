// Unit tests for the tier capability map and effective-capability API (BE-mono-10, BE-mono-23,
// BE-mono-24), against the real exports, not a fixture. Source design: project-docs/11 section 1
// and project-docs/17-tier-addons-requirements.md FR-1; rewritten for doc 35 (6 Okt 2026, BE-mono-45):
// the three tiers are identical (no photo cap, no guest cap, lifetime) and custom domain, Extra Galeri and
// Extra Tamu are retired add-ons.

import { describe, expect, it } from "vitest";
import {
  GUEST_TECHNICAL_FENCE,
  MAX_ADDON_QUANTITY,
  PHOTO_TECHNICAL_FENCE,
  RETIRED_ADDON_IDS,
  TIER_CAPABILITIES,
  computeExpiresAt,
  getEffectiveCapabilities,
  getEffectiveGuestCap,
  getEffectivePhotoCap,
  hasFeature,
  parsePurchasedAddons,
  type PackageTier,
  type PurchasedAddons,
} from "../src/tier.js";
import { LEGACY_MONTHS, useLegacyDurations } from "./support/legacy-durations.js";

const TIERS: PackageTier[] = ["basic", "premium", "exclusive"];

describe("TIER_CAPABILITIES", () => {
  it("has exactly the 3 documented tiers", () => {
    expect(Object.keys(TIER_CAPABILITIES).sort()).toEqual(["basic", "exclusive", "premium"]);
  });

  it.each(TIERS)("%s: no photo cap, no guest cap, lifetime; QR, domain and Seating Plan are add-ons only", (tier) => {
    expect(TIER_CAPABILITIES[tier]).toEqual({
      photoCap: null,
      guestCap: null,
      qrCheckin: false,
      customDomain: false,
      seating: false,
      durationMonths: null,
    });
  });

  it("the three tiers are identical (doc 35: only the label survives, as information about old rows)", () => {
    expect(TIER_CAPABILITIES.premium).toEqual(TIER_CAPABILITIES.basic);
    expect(TIER_CAPABILITIES.exclusive).toEqual(TIER_CAPABILITIES.basic);
  });

  it("is frozen (Object.freeze) at the top level", () => {
    expect(Object.isFrozen(TIER_CAPABILITIES)).toBe(true);
  });

  it("exports the documented constants", () => {
    expect(MAX_ADDON_QUANTITY).toBe(99);
    expect(PHOTO_TECHNICAL_FENCE).toBe(300);
    expect(GUEST_TECHNICAL_FENCE).toBe(10_000);
    expect([...RETIRED_ADDON_IDS].sort()).toEqual(["domain", "gallery", "guests"]);
  });

  it("the technical fences are far above anything a normal invitation reaches and the tier table never mentions them", () => {
    expect(PHOTO_TECHNICAL_FENCE).toBeGreaterThan(50);
    expect(GUEST_TECHNICAL_FENCE).toBeGreaterThan(1000);
    expect(JSON.stringify(TIER_CAPABILITIES)).not.toMatch(/300|10000/);
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

  it("reads the seating add-on (Seating Plan) as binary, from both shapes", () => {
    expect(parsePurchasedAddons({ seating: 4 })).toEqual({ seating: 1 });
    expect(parsePurchasedAddons('{"seating":1,"guests":2}')).toEqual({ seating: 1, guests: 2 });
    expect(parsePurchasedAddons(["seating", "express"])).toEqual({ seating: 1 });
  });

  it("reads the design add-on (Desain Custom, doc 26) as binary and grants no feature", () => {
    expect(parsePurchasedAddons({ design: 2 })).toEqual({ design: 1 });
    expect(parsePurchasedAddons('{"design":1,"gallery":1}')).toEqual({ design: 1, gallery: 1 });
    expect(getEffectiveCapabilities("basic", parsePurchasedAddons({ design: 1 }))).toEqual(
      getEffectiveCapabilities("basic", {}),
    );
  });

  it("does not read inherited keys and does not pollute prototypes", () => {
    expect(parsePurchasedAddons(JSON.parse('{"__proto__":{"gallery":5}}'))).toEqual({});
    expect(parsePurchasedAddons(Object.create({ gallery: 3 }))).toEqual({});
    expect(({} as Record<string, unknown>).gallery).toBeUndefined();
  });
});

describe("hasFeature (2-arg: tier defaults only)", () => {
  it.each(TIERS)("%s: qrCheckin and customDomain are false without add-ons", (tier) => {
    expect(hasFeature(tier, "qrCheckin")).toBe(false);
    expect(hasFeature(tier, "customDomain")).toBe(false);
  });
});

describe("hasFeature (with add-ons)", () => {
  it.each(TIERS)("%s: qrcheckin add-on => qrCheckin true, customDomain false", (tier) => {
    expect(hasFeature(tier, "qrCheckin", { qrcheckin: 1 })).toBe(true);
    expect(hasFeature(tier, "customDomain", { qrcheckin: 1 })).toBe(false);
  });

  it.each(TIERS)("%s: an old domain add-on row grants NOTHING (custom domains are switched off, doc 35)", (tier) => {
    expect(hasFeature(tier, "customDomain", { domain: 1 })).toBe(false);
    expect(hasFeature(tier, "qrCheckin", { domain: 1 })).toBe(false);
    expect(getEffectiveCapabilities(tier, { domain: 1 }).customDomain).toBe(false);
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

describe("getEffectivePhotoCap / getEffectiveGuestCap (doc 35: no sellable cap)", () => {
  it.each(TIERS)("%s: null, and enforcement falls back to the technical fence", (tier) => {
    expect(getEffectivePhotoCap(tier)).toBeNull();
    expect(getEffectiveGuestCap(tier)).toBeNull();
    expect(getEffectivePhotoCap(tier) ?? PHOTO_TECHNICAL_FENCE).toBe(300);
    expect(getEffectiveGuestCap(tier) ?? GUEST_TECHNICAL_FENCE).toBe(10_000);
  });

  it("takes only the tier: the staff override and the gallery/guests add-ons no longer exist as inputs", () => {
    expect(getEffectivePhotoCap.length).toBe(1);
    expect(getEffectiveGuestCap.length).toBe(1);
  });
});

describe("getEffectiveCapabilities", () => {
  it.each(TIERS)("%s with no add-ons equals TIER_CAPABILITIES", (tier) => {
    expect(getEffectiveCapabilities(tier, {})).toEqual(TIER_CAPABILITIES[tier]);
    expect(getEffectiveCapabilities(tier)).toEqual(TIER_CAPABILITIES[tier]);
    expect(getEffectiveCapabilities(tier, null)).toEqual(TIER_CAPABILITIES[tier]);
  });

  // 3 tiers x every combination of {qrcheckin, domain(retired), gallery(retired) 0/2, guests(retired) 0/3, seating}
  const combos: PurchasedAddons[] = [];
  for (const qr of [0, 1]) {
    for (const domain of [0, 1]) {
      for (const gallery of [0, 2]) {
        for (const guests of [0, 3]) {
          for (const seating of [0, 1]) {
            const combo: PurchasedAddons = {};
            if (qr) combo.qrcheckin = 1;
            if (domain) combo.domain = 1;
            if (gallery) combo.gallery = gallery;
            if (guests) combo.guests = guests;
            if (seating) combo.seating = 1;
            combos.push(combo);
          }
        }
      }
    }
  }

  describe.each(TIERS)("%s", (tier) => {
    it.each(combos)("addons %o", (combo) => {
      expect(getEffectiveCapabilities(tier, combo)).toEqual({
        photoCap: null,
        guestCap: null,
        qrCheckin: combo.qrcheckin === 1,
        customDomain: false, // the domain add-on is retired: even a recorded row grants nothing
        seating: combo.seating === 1,
        durationMonths: null,
      });
    });
  });

  it("the seating add-on (Seating Plan, doc 21 §5.0 D5) grants only `seating`", () => {
    expect(getEffectiveCapabilities("basic", { seating: 1 })).toEqual({
      ...TIER_CAPABILITIES.basic,
      seating: true,
    });
    expect(getEffectiveCapabilities("exclusive", parsePurchasedAddons('{"seating":1,"qrcheckin":1}'))).toMatchObject({
      qrCheckin: true,
      seating: true,
      customDomain: false,
    });
  });

  it("accepts frozen add-ons (does not mutate inputs)", () => {
    expect(getEffectiveCapabilities("basic", Object.freeze({ qrcheckin: 1 })).qrCheckin).toBe(true);
  });

  it("composes with parsePurchasedAddons for stored values (JSON, legacy array, garbage)", () => {
    expect(getEffectiveCapabilities("basic", parsePurchasedAddons('{"gallery":1,"qrcheckin":1}'))).toMatchObject({
      photoCap: null,
      qrCheckin: true,
    });
    expect(getEffectiveCapabilities("premium", parsePurchasedAddons(["qrcheckin"])).qrCheckin).toBe(true);
    expect(getEffectiveCapabilities("premium", parsePurchasedAddons("garbage"))).toEqual(TIER_CAPABILITIES.premium);
  });
});

describe("computeExpiresAt: lifetime", () => {
  const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

  it.each(TIERS)("%s: always null (every invitation is lifetime)", (tier) => {
    expect(computeExpiresAt(at(2026, 1, 15), tier)).toBeNull();
    expect(computeExpiresAt(at(2026, 12, 31), tier)).toBeNull();
  });
});

describe("computeExpiresAt: the month arithmetic that is kept in case an active period returns", () => {
  useLegacyDurations();
  const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

  it("the legacy table is back inside this block only", () => {
    expect(TIER_CAPABILITIES.basic.durationMonths).toBe(LEGACY_MONTHS.basic);
  });

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

  it("returns a Date for every tier while a duration is set", () => {
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
});
