// QA-shared-17 — property/regression tests for the tier widening.
//
// `tier.compat.test.ts` already pins the four acceptance criteria as examples: the old 2-arg
// signatures still behave, `computeExpiresAt` keeps its signature and semantics, `tier.ts`
// imports nothing, and `TIER_CAPABILITIES` carries no `personalGuestLinks`/story flag. This
// file adds the *property* half the task asks for: the same invariants asserted over the whole
// input space rather than a couple of chosen points, which is what makes "the widening is
// backward compatible" a claim instead of a spot check.
//
// Deliberately no `fast-check` dependency. The generators below are a tiny seeded PRNG, so the
// cases are randomised across the space but identical on every run and on every machine — a
// failure is reproducible from the output alone, and the shared package gains no new dependency
// (it is consumed as a git dependency by four Workers; adding one is not a free decision).
// Updated for doc 35 (v0.26.0, BE-mono-45): the sellable photo and guest caps and the active period are gone, so the cap
// properties become "always null / always the fence" and the month arithmetic is exercised with the legacy table put back
// by `useLegacyDurations()`.
import { describe, expect, it } from "vitest";
import {
  TIER_CAPABILITIES,
  GUEST_TECHNICAL_FENCE,
  MAX_ADDON_QUANTITY,
  PHOTO_TECHNICAL_FENCE,
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
const FEATURES = ["qrCheckin", "customDomain"] as const;

/** mulberry32 — deterministic, seeded, 4 lines. Same sequence everywhere, forever. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RUNS = 300;

// ---------------------------------------------------------------------------
// 1. Backward compatibility, exhaustively rather than by example.
// ---------------------------------------------------------------------------

describe("QA-shared-17: absent inputs are inert", () => {
  it("getEffectivePhotoCap / getEffectiveGuestCap: null for every tier, whatever else the caller holds", () => {
    for (const tier of TIERS) {
      expect(getEffectivePhotoCap(tier)).toBeNull();
      expect(getEffectiveGuestCap(tier)).toBeNull();
    }
  });

  it("hasFeature: every tier x feature reads the tier default when no add-ons are passed", () => {
    for (const tier of TIERS) {
      for (const feature of FEATURES) {
        const expected = TIER_CAPABILITIES[tier][feature];
        expect(hasFeature(tier, feature)).toBe(expected);
        expect(hasFeature(tier, feature, null)).toBe(expected);
        expect(hasFeature(tier, feature, undefined)).toBe(expected);
        expect(hasFeature(tier, feature, {})).toBe(expected);
      }
    }
  });

  it("getEffectiveCapabilities with no add-ons IS the frozen tier row", () => {
    for (const tier of TIERS) {
      expect(getEffectiveCapabilities(tier)).toEqual(TIER_CAPABILITIES[tier]);
      expect(getEffectiveCapabilities(tier, null)).toEqual(TIER_CAPABILITIES[tier]);
      expect(getEffectiveCapabilities(tier, {})).toEqual(TIER_CAPABILITIES[tier]);
    }
  });

  it("an add-on the caller did not buy never changes the answer", () => {
    for (const tier of TIERS) {
      const inert: PurchasedAddons[] = [{}, { gallery: 0 }, { qrcheckin: 0 }, { domain: 0 }];
      for (const addons of inert) {
        expect(hasFeature(tier, "qrCheckin", addons)).toBe(TIER_CAPABILITIES[tier].qrCheckin);
        expect(hasFeature(tier, "customDomain", addons)).toBe(TIER_CAPABILITIES[tier].customDomain);
      }
      // No cross-talk between add-ons, and a retired `domain` row never grants anything.
      expect(hasFeature(tier, "qrCheckin", { domain: 1 })).toBe(false);
      expect(hasFeature(tier, "customDomain", { qrcheckin: 1 })).toBe(false);
      expect(hasFeature(tier, "customDomain", { domain: 1 })).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Cap properties over the whole input space: there is no sellable cap, whatever was bought.
// ---------------------------------------------------------------------------

describe("QA-shared-17: no sellable photo or guest cap, whatever add-ons an old row records", () => {
  it("over randomised gallery/guests quantities the caps stay null (retired add-ons have no effect)", () => {
    const rand = prng(20260921);
    for (const tier of TIERS) {
      for (let i = 0; i < RUNS; i++) {
        const gallery = Math.floor(rand() * (MAX_ADDON_QUANTITY + 1));
        const guests = Math.floor(rand() * (MAX_ADDON_QUANTITY + 1));
        const caps = getEffectiveCapabilities(tier, { gallery, guests });
        expect(caps.photoCap, `tier=${tier} gallery=${gallery}`).toBeNull();
        expect(caps.guestCap, `tier=${tier} guests=${guests}`).toBeNull();
      }
    }
  });

  it("the enforced limit is exactly the technical fence, identical for every tier", () => {
    for (const tier of TIERS) {
      expect(getEffectivePhotoCap(tier) ?? PHOTO_TECHNICAL_FENCE).toBe(300);
      expect(getEffectiveGuestCap(tier) ?? GUEST_TECHNICAL_FENCE).toBe(10_000);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. parsePurchasedAddons — it reads rows written by other systems, so it must never throw.
// ---------------------------------------------------------------------------

describe("QA-shared-17: parsePurchasedAddons is total (never throws) and always in range", () => {
  const GARBAGE: unknown[] = [
    null, undefined, "", "{", "[", "null", "undefined", "0", "false", 0, 1, -1, NaN, Infinity, -Infinity,
    true, false, [], {}, [1, 2, 3], ["gallery"], ["gallery", "gallery"], ["nope"], ["domain", "qrcheckin"],
    '{"gallery":3}', '{"gallery":"3"}', '{"gallery":-5}', '{"gallery":0}', '{"gallery":1.5}',
    '{"gallery":1e999}', '{"gallery":null}', '{"gallery":true}', '{"gallery":[]}', '{"gallery":{}}',
    '{"unknown":1}', '{"__proto__":{"gallery":99}}', '{"gallery":999999}',
    { gallery: 3 }, { gallery: -5 }, { gallery: 1.5 }, { gallery: NaN }, { gallery: Infinity },
    { gallery: "3" }, { gallery: null }, { gallery: undefined }, { unknown: 1 },
    { gallery: MAX_ADDON_QUANTITY + 1000 }, new Date(), () => {}, Symbol.iterator.toString(),
  ];

  it.each(GARBAGE.map((g, i) => [i, g] as const))("input #%i never throws and yields a valid shape", (_i, input) => {
    const result = parsePurchasedAddons(input);
    expect(result).toBeTypeOf("object");
    expect(result).not.toBeNull();

    for (const [key, quantity] of Object.entries(result)) {
      expect(["domain", "qrcheckin", "gallery"], `unexpected key ${key}`).toContain(key);
      expect(Number.isInteger(quantity), `${key}=${quantity} is not an integer`).toBe(true);
      expect(quantity, `${key}=${quantity}`).toBeGreaterThanOrEqual(1);
      expect(quantity, `${key}=${quantity}`).toBeLessThanOrEqual(MAX_ADDON_QUANTITY);
    }
  });

  it("no prototype pollution: a __proto__ key in the JSON cannot reach Object.prototype", () => {
    parsePurchasedAddons('{"__proto__":{"polluted":true}}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("parsing a stored JSON string equals parsing the object it encodes", () => {
    // The column is TEXT, so both forms occur at call sites. They must not diverge.
    const rand = prng(31337);
    for (let i = 0; i < RUNS; i++) {
      const obj: PurchasedAddons = {};
      if (rand() < 0.6) obj.gallery = Math.floor(rand() * (MAX_ADDON_QUANTITY + 20)) - 5;
      if (rand() < 0.5) obj.domain = Math.floor(rand() * 3);
      if (rand() < 0.5) obj.qrcheckin = Math.floor(rand() * 3);
      expect(parsePurchasedAddons(JSON.stringify(obj)), JSON.stringify(obj)).toEqual(parsePurchasedAddons(obj));
    }
  });

  it("is idempotent: re-parsing its own output changes nothing", () => {
    const rand = prng(90210);
    for (let i = 0; i < RUNS; i++) {
      const raw = { gallery: Math.floor(rand() * 200) - 20, domain: Math.floor(rand() * 4) - 1 };
      const once = parsePurchasedAddons(raw);
      expect(parsePurchasedAddons(once)).toEqual(once);
    }
  });

  it("the legacy array form still reads as quantity 1 per known id", () => {
    // Older rows stored `settings.addons = ["qrcheckin"]`. Still supported, still quantity 1.
    expect(parsePurchasedAddons(["qrcheckin"])).toEqual({ qrcheckin: 1 });
    expect(parsePurchasedAddons('["domain","gallery"]')).toEqual({ domain: 1, gallery: 1 });
    expect(parsePurchasedAddons(["nope", "qrcheckin"])).toEqual({ qrcheckin: 1 });
  });
});

// ---------------------------------------------------------------------------
// 4. computeExpiresAt: lifetime, and the month arithmetic that stays for a returning active period.
// ---------------------------------------------------------------------------

describe("QA-shared-17: computeExpiresAt is lifetime", () => {
  it("is null for every tier and every activation instant", () => {
    const rand = prng(112358);
    for (const tier of TIERS) {
      for (let i = 0; i < RUNS; i++) {
        const activatedAt = new Date(Date.UTC(2020 + Math.floor(rand() * 12), Math.floor(rand() * 12), 1 + Math.floor(rand() * 28), Math.floor(rand() * 24), Math.floor(rand() * 60)));
        expect(computeExpiresAt(activatedAt, tier), `tier=${tier} activatedAt=${activatedAt.toISOString()}`).toBeNull();
      }
    }
  });

  it("an add-on purchase never gives an invitation an end date", () => {
    for (const tier of TIERS) {
      for (const addons of [{}, { gallery: 3 }, { domain: 1 }, { qrcheckin: 1 }, { gallery: 99, domain: 1, qrcheckin: 1 }]) {
        expect(getEffectiveCapabilities(tier, addons).durationMonths).toBeNull();
      }
    }
  });
});

describe("QA-shared-17: computeExpiresAt month arithmetic (legacy table put back for this block)", () => {
  useLegacyDurations();

  it("is never null while a duration is set, and always strictly after activation", () => {
    const rand = prng(112358);
    for (const tier of TIERS) {
      for (let i = 0; i < RUNS; i++) {
        const activatedAt = new Date(Date.UTC(2020 + Math.floor(rand() * 12), Math.floor(rand() * 12), 1 + Math.floor(rand() * 28), Math.floor(rand() * 24), Math.floor(rand() * 60)));
        const expires = computeExpiresAt(activatedAt, tier);
        expect(expires, `tier=${tier} activatedAt=${activatedAt.toISOString()}`).not.toBeNull();
        expect(expires!.getTime()).toBeGreaterThan(activatedAt.getTime());
      }
    }
  });

  it("matches native setUTCMonth(+durationMonths) exactly, month-end overflow included", () => {
    // The overflow (Jan 31 + 1 month -> Mar 2/3) is documented behaviour, not a bug to fix here.
    const rand = prng(1618033);
    for (const tier of TIERS) {
      const months = LEGACY_MONTHS[tier];
      for (let i = 0; i < RUNS; i++) {
        const activatedAt = new Date(Date.UTC(2024 + Math.floor(rand() * 5), Math.floor(rand() * 12), 1 + Math.floor(rand() * 31), 12, 34, 56));
        const native = new Date(activatedAt);
        native.setUTCMonth(native.getUTCMonth() + months);
        expect(computeExpiresAt(activatedAt, tier)!.toISOString()).toBe(native.toISOString());
      }
    }
  });

  it("preserves time-of-day", () => {
    const activatedAt = new Date("2026-03-15T07:43:21.123Z");
    for (const tier of TIERS) {
      const expires = computeExpiresAt(activatedAt, tier)!;
      expect(expires.toISOString().slice(10)).toBe(activatedAt.toISOString().slice(10));
    }
  });

  it("the legacy ordering 3 < 6 < 12 survives into the computed dates", () => {
    const at = new Date("2026-01-15T00:00:00.000Z");
    expect(computeExpiresAt(at, "basic")!.getTime()).toBeLessThan(computeExpiresAt(at, "premium")!.getTime());
    expect(computeExpiresAt(at, "premium")!.getTime()).toBeLessThan(computeExpiresAt(at, "exclusive")!.getTime());
  });
});

// ---------------------------------------------------------------------------
// 5. The frozen table itself.
// ---------------------------------------------------------------------------

describe("QA-shared-17: TIER_CAPABILITIES is frozen and shaped as documented", () => {
  it("cannot be mutated at runtime — pricing changes go through code review, not a stray write", () => {
    expect(Object.isFrozen(TIER_CAPABILITIES)).toBe(true);
    const before = TIER_CAPABILITIES.basic.qrCheckin;
    try {
      (TIER_CAPABILITIES as any).basic = { qrCheckin: true };
    } catch {
      // strict mode throws; non-strict silently ignores. Either is fine — the value must hold.
    }
    expect(TIER_CAPABILITIES.basic.qrCheckin).toBe(before);
  });

  it("every tier row has exactly the six documented keys and no others", () => {
    // The guard comments in doc 11 call out `personalGuestLinks` and story flags by name:
    // personal links are ungated at every tier, so a flag here would be a gate nobody asked for.
    // `seating` (doc 21 §5.0 D5) is a binary add-on flag with the exact shape of `qrCheckin`.
    for (const tier of TIERS) {
      expect(Object.keys(TIER_CAPABILITIES[tier]).sort()).toEqual([
        "customDomain",
        "durationMonths",
        "guestCap",
        "photoCap",
        "qrCheckin",
        "seating",
      ]);
    }
  });

  it("the three tiers hold identical rows: no photo cap, no guest cap, lifetime (doc 35)", () => {
    for (const tier of TIERS) {
      expect(TIER_CAPABILITIES[tier].photoCap, tier).toBeNull();
      expect(TIER_CAPABILITIES[tier].guestCap, tier).toBeNull();
      expect(TIER_CAPABILITIES[tier].durationMonths, tier).toBeNull();
    }
  });

  it("qrCheckin and seating are false at EVERY tier and come only from their own add-on; customDomain comes from nothing (doc 35)", () => {
    for (const tier of TIERS) {
      expect(TIER_CAPABILITIES[tier].qrCheckin, tier).toBe(false);
      expect(TIER_CAPABILITIES[tier].customDomain, tier).toBe(false);
      expect(TIER_CAPABILITIES[tier].seating, tier).toBe(false);
    }
    for (const tier of TIERS) {
      expect(hasFeature(tier, "qrCheckin", { qrcheckin: 1 })).toBe(true);
      expect(hasFeature(tier, "customDomain", { domain: 1 })).toBe(false);
      expect(hasFeature(tier, "seating", { seating: 1 })).toBe(true);
      expect(hasFeature(tier, "seating", { qrcheckin: 1, domain: 1, gallery: 3, guests: 5 })).toBe(false);
      expect(hasFeature(tier, "qrCheckin", { seating: 1 })).toBe(false);
    }
  });
});
