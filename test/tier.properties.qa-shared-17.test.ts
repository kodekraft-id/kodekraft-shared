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
import { describe, expect, it } from "vitest";
import {
  TIER_CAPABILITIES,
  GALLERY_ADDON_PHOTOS,
  PHOTO_CEILING,
  MAX_ADDON_QUANTITY,
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

describe("QA-shared-17: the widened signatures are indistinguishable from the old ones when unused", () => {
  it("getEffectivePhotoCap: every way of saying 'no override, no add-ons' agrees, for every tier", () => {
    for (const tier of TIERS) {
      const expected = TIER_CAPABILITIES[tier].photoCap;
      // The old 1-arg/2-arg call sites, plus every spelling of "absent" the widened params accept.
      expect(getEffectivePhotoCap(tier)).toBe(expected);
      expect(getEffectivePhotoCap(tier, null)).toBe(expected);
      expect(getEffectivePhotoCap(tier, undefined)).toBe(expected);
      expect(getEffectivePhotoCap(tier, null, null)).toBe(expected);
      expect(getEffectivePhotoCap(tier, undefined, undefined)).toBe(expected);
      expect(getEffectivePhotoCap(tier, null, {})).toBe(expected);
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

  it("getEffectiveCapabilities with no add-ons and no override IS the frozen tier row", () => {
    for (const tier of TIERS) {
      expect(getEffectiveCapabilities(tier)).toEqual(TIER_CAPABILITIES[tier]);
      expect(getEffectiveCapabilities(tier, null, null)).toEqual(TIER_CAPABILITIES[tier]);
      expect(getEffectiveCapabilities(tier, {}, undefined)).toEqual(TIER_CAPABILITIES[tier]);
    }
  });

  it("an add-on the caller did not buy never changes the answer", () => {
    // Widening means the *presence* of the parameter must be inert. A zero quantity, an unknown
    // key, and an unrelated add-on must all read exactly like `{}`.
    for (const tier of TIERS) {
      const inert: PurchasedAddons[] = [{}, { gallery: 0 }, { qrcheckin: 0 }, { domain: 0 }];
      for (const addons of inert) {
        expect(getEffectivePhotoCap(tier, null, addons)).toBe(TIER_CAPABILITIES[tier].photoCap);
        expect(hasFeature(tier, "qrCheckin", addons)).toBe(TIER_CAPABILITIES[tier].qrCheckin);
        expect(hasFeature(tier, "customDomain", addons)).toBe(TIER_CAPABILITIES[tier].customDomain);
      }
      // A `domain` unit must not grant QR check-in, and vice versa — no cross-talk.
      expect(hasFeature(tier, "qrCheckin", { domain: 1 })).toBe(false);
      expect(hasFeature(tier, "customDomain", { qrcheckin: 1 })).toBe(false);
      expect(getEffectivePhotoCap(tier, null, { domain: 1, qrcheckin: 1 })).toBe(TIER_CAPABILITIES[tier].photoCap);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Photo-cap properties over the whole input space.
// ---------------------------------------------------------------------------

describe("QA-shared-17: photo cap properties", () => {
  it("never below the tier cap, never above the ceiling — over randomised gallery quantities", () => {
    const rand = prng(20260921);
    for (const tier of TIERS) {
      const tierCap = TIER_CAPABILITIES[tier].photoCap;
      for (let i = 0; i < RUNS; i++) {
        const gallery = Math.floor(rand() * (MAX_ADDON_QUANTITY + 1));
        const cap = getEffectivePhotoCap(tier, null, { gallery });
        expect(cap, `tier=${tier} gallery=${gallery}`).toBeGreaterThanOrEqual(tierCap);
        expect(cap, `tier=${tier} gallery=${gallery}`).toBeLessThanOrEqual(PHOTO_CEILING);
      }
    }
  });

  it("monotonic: buying one more gallery unit never lowers the cap", () => {
    for (const tier of TIERS) {
      for (let gallery = 0; gallery < MAX_ADDON_QUANTITY; gallery++) {
        const here = getEffectivePhotoCap(tier, null, { gallery });
        const next = getEffectivePhotoCap(tier, null, { gallery: gallery + 1 });
        expect(next, `tier=${tier} gallery=${gallery}`).toBeGreaterThanOrEqual(here);
      }
    }
  });

  it("maxUsefulGalleryUnits is exactly the point where the cap stops moving", () => {
    // Its contract, and the number the storefront limits on / the server rejects past. If it
    // drifted from the cap maths, buyers could be sold a unit that changes nothing.
    for (const tier of TIERS) {
      const useful = maxUsefulGalleryUnits(tier);
      const atUseful = getEffectivePhotoCap(tier, null, { gallery: useful });

      // Nothing beyond it has any effect...
      for (const beyond of [useful + 1, useful + 5, MAX_ADDON_QUANTITY]) {
        expect(getEffectivePhotoCap(tier, null, { gallery: beyond }), `tier=${tier} beyond=${beyond}`).toBe(atUseful);
      }
      // ...and every unit up to it strictly increases the cap.
      for (let gallery = 0; gallery < useful; gallery++) {
        expect(
          getEffectivePhotoCap(tier, null, { gallery: gallery + 1 }),
          `tier=${tier} gallery=${gallery}`,
        ).toBeGreaterThan(getEffectivePhotoCap(tier, null, { gallery }));
      }
    }
    // Exclusive already sits at the ceiling, so no gallery unit is ever useful to it.
    expect(maxUsefulGalleryUnits("exclusive")).toBe(0);
  });

  it("each useful unit adds exactly GALLERY_ADDON_PHOTOS, until the ceiling clamps it", () => {
    for (const tier of TIERS) {
      const tierCap = TIER_CAPABILITIES[tier].photoCap;
      for (let gallery = 0; gallery <= MAX_ADDON_QUANTITY; gallery++) {
        const expected = Math.max(tierCap, Math.min(tierCap + GALLERY_ADDON_PHOTOS * gallery, PHOTO_CEILING));
        expect(getEffectivePhotoCap(tier, null, { gallery }), `tier=${tier} gallery=${gallery}`).toBe(expected);
      }
    }
  });

  it("a staff override always wins — including 0, and including values above the ceiling", () => {
    // `0` is a legitimate override (photo upload switched off for this invitation); only
    // null/undefined fall back. An override may deliberately exceed PHOTO_CEILING.
    const rand = prng(775533);
    for (const tier of TIERS) {
      for (let i = 0; i < RUNS; i++) {
        const override = Math.floor(rand() * 500) - 100; // spans negatives, 0, and > ceiling
        const gallery = Math.floor(rand() * (MAX_ADDON_QUANTITY + 1));
        expect(getEffectivePhotoCap(tier, override, { gallery }), `tier=${tier} override=${override}`).toBe(override);
      }
      expect(getEffectivePhotoCap(tier, 0, { gallery: 3 })).toBe(0);
      expect(getEffectivePhotoCap(tier, PHOTO_CEILING + 25)).toBe(PHOTO_CEILING + 25);
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
// 4. computeExpiresAt — the regression half of the task.
// ---------------------------------------------------------------------------

describe("QA-shared-17: computeExpiresAt properties", () => {
  it("is never null for any real tier, and always strictly after activation", () => {
    // Doc 17 ruling 20/21: there is no 'never expires' tier any more. The `null` branch is
    // legacy/defensive; no tier may reach it.
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
    // Pinning it means a future "fix" has to be a deliberate, visible decision.
    const rand = prng(1618033);
    for (const tier of TIERS) {
      const months = TIER_CAPABILITIES[tier].durationMonths!;
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

  it("tier durations stay strictly ordered 3 < 6 < 12 (OQ-26's own constraint)", () => {
    const basic = TIER_CAPABILITIES.basic.durationMonths!;
    const premium = TIER_CAPABILITIES.premium.durationMonths!;
    const exclusive = TIER_CAPABILITIES.exclusive.durationMonths!;
    expect(basic).toBe(3);
    expect(premium).toBe(6);
    expect(exclusive).toBe(12);
    expect(basic).toBeLessThan(premium);
    expect(premium).toBeLessThan(exclusive);

    // ...and that ordering survives into the computed dates, not just the constants.
    const at = new Date("2026-01-15T00:00:00.000Z");
    expect(computeExpiresAt(at, "basic")!.getTime()).toBeLessThan(computeExpiresAt(at, "premium")!.getTime());
    expect(computeExpiresAt(at, "premium")!.getTime()).toBeLessThan(computeExpiresAt(at, "exclusive")!.getTime());
  });

  it("an add-on purchase never changes how long the invitation lives", () => {
    // Duration is a tier property only — no add-on extends it. Worth pinning now that
    // getEffectiveCapabilities takes add-ons: it would be an easy thing to wire in by accident.
    for (const tier of TIERS) {
      for (const addons of [{}, { gallery: 3 }, { domain: 1 }, { qrcheckin: 1 }, { gallery: 99, domain: 1, qrcheckin: 1 }]) {
        expect(getEffectiveCapabilities(tier, addons).durationMonths).toBe(TIER_CAPABILITIES[tier].durationMonths);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. The frozen table itself.
// ---------------------------------------------------------------------------

describe("QA-shared-17: TIER_CAPABILITIES is frozen and shaped as documented", () => {
  it("cannot be mutated at runtime — pricing changes go through code review, not a stray write", () => {
    expect(Object.isFrozen(TIER_CAPABILITIES)).toBe(true);
    const before = TIER_CAPABILITIES.basic.photoCap;
    try {
      (TIER_CAPABILITIES as any).basic = { photoCap: 999 };
    } catch {
      // strict mode throws; non-strict silently ignores. Either is fine — the value must hold.
    }
    expect(TIER_CAPABILITIES.basic.photoCap).toBe(before);
  });

  it("every tier row has exactly the five documented keys and no others", () => {
    // The guard comments in doc 11 call out `personalGuestLinks` and story flags by name:
    // personal links are ungated at every tier, so a flag here would be a gate nobody asked for.
    //
    // `guestCap` (doc 20, 2026-09-25) is the fifth key, and adding it did NOT contradict that
    // guard: it caps how many guest ROWS may be ADDED, not whether personal links work. Every
    // tier still has them, unconditionally, and an already-added guest is never blocked.
    for (const tier of TIERS) {
      expect(Object.keys(TIER_CAPABILITIES[tier]).sort()).toEqual([
        "customDomain",
        "durationMonths",
        "guestCap",
        "photoCap",
        "qrCheckin",
      ]);
    }
  });

  it("guestCap is 250/500/1000 and strictly increases with tier (doc 20 §2)", () => {
    expect(TIER_CAPABILITIES.basic.guestCap).toBe(250);
    expect(TIER_CAPABILITIES.premium.guestCap).toBe(500);
    expect(TIER_CAPABILITIES.exclusive.guestCap).toBe(1000);
    // Capacity rises FASTER than price (1:2:4 vs 1:2:3.5) — that ratio is what makes the
    // upper tiers feel better value per guest, and it is a pricing decision, not an accident.
    expect(TIER_CAPABILITIES.premium.guestCap).toBeGreaterThan(TIER_CAPABILITIES.basic.guestCap);
    expect(TIER_CAPABILITIES.exclusive.guestCap).toBeGreaterThan(TIER_CAPABILITIES.premium.guestCap);
  });

  it("qrCheckin and customDomain are false at EVERY tier — they are add-ons only (doc 17 ruling 13)", () => {
    for (const tier of TIERS) {
      expect(TIER_CAPABILITIES[tier].qrCheckin, tier).toBe(false);
      expect(TIER_CAPABILITIES[tier].customDomain, tier).toBe(false);
    }
    // ...so the ONLY way to get either is a purchased add-on.
    for (const tier of TIERS) {
      expect(hasFeature(tier, "qrCheckin", { qrcheckin: 1 })).toBe(true);
      expect(hasFeature(tier, "customDomain", { domain: 1 })).toBe(true);
    }
  });

  it("photo caps are non-decreasing across tiers and none exceeds the ceiling", () => {
    expect(TIER_CAPABILITIES.basic.photoCap).toBeLessThanOrEqual(TIER_CAPABILITIES.premium.photoCap);
    expect(TIER_CAPABILITIES.premium.photoCap).toBeLessThanOrEqual(TIER_CAPABILITIES.exclusive.photoCap);
    for (const tier of TIERS) expect(TIER_CAPABILITIES[tier].photoCap).toBeLessThanOrEqual(PHOTO_CEILING);
  });
});
