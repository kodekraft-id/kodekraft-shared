// Real unit tests for the tier capability map (BE-mono-10), against the real
// TIER_CAPABILITIES constant — not a fixture. See project-docs/11-tier-capability-design.md
// §1 for the source design.

import { describe, expect, it } from "vitest";
import { computeExpiresAt, getEffectivePhotoCap, hasFeature, TIER_CAPABILITIES } from "../src/tier.js";

describe("TIER_CAPABILITIES", () => {
  it("has exactly the 3 documented tiers", () => {
    expect(Object.keys(TIER_CAPABILITIES).sort()).toEqual(["basic", "exclusive", "premium"]);
  });

  it("matches doc 11 §1's exact values for basic", () => {
    expect(TIER_CAPABILITIES.basic).toEqual({
      photoCap: 5,
      qrCheckin: false,
      customDomain: false,
      durationMonths: 3,
    });
  });

  it("matches doc 11 §1's exact values for premium", () => {
    expect(TIER_CAPABILITIES.premium).toEqual({
      photoCap: 15,
      qrCheckin: true,
      customDomain: false,
      durationMonths: 12,
    });
  });

  it("matches doc 11 §1's exact values for exclusive", () => {
    expect(TIER_CAPABILITIES.exclusive).toEqual({
      photoCap: 50,
      qrCheckin: true,
      customDomain: true,
      durationMonths: null,
    });
  });

  it("is frozen (Object.freeze) at the top level", () => {
    expect(Object.isFrozen(TIER_CAPABILITIES)).toBe(true);
  });
});

describe("getEffectivePhotoCap", () => {
  it("returns the tier default when no override is given", () => {
    expect(getEffectivePhotoCap("basic")).toBe(5);
    expect(getEffectivePhotoCap("premium")).toBe(15);
    expect(getEffectivePhotoCap("exclusive")).toBe(50);
  });

  it("returns the tier default when the override is null or undefined", () => {
    expect(getEffectivePhotoCap("basic", null)).toBe(5);
    expect(getEffectivePhotoCap("basic", undefined)).toBe(5);
  });

  it("returns the override when one is given", () => {
    expect(getEffectivePhotoCap("basic", 20)).toBe(20);
    expect(getEffectivePhotoCap("exclusive", 100)).toBe(100);
  });

  it("treats an override of 0 as a legitimate zero-cap value, not as absent", () => {
    expect(getEffectivePhotoCap("premium", 0)).toBe(0);
  });
});

describe("hasFeature", () => {
  it("reports false for qrCheckin and customDomain on basic", () => {
    expect(hasFeature("basic", "qrCheckin")).toBe(false);
    expect(hasFeature("basic", "customDomain")).toBe(false);
  });

  it("reports true for qrCheckin and false for customDomain on premium", () => {
    expect(hasFeature("premium", "qrCheckin")).toBe(true);
    expect(hasFeature("premium", "customDomain")).toBe(false);
  });

  it("reports true for qrCheckin and customDomain on exclusive", () => {
    expect(hasFeature("exclusive", "qrCheckin")).toBe(true);
    expect(hasFeature("exclusive", "customDomain")).toBe(true);
  });
});

describe("computeExpiresAt", () => {
  it("computes 3 months forward for basic", () => {
    const activatedAt = new Date(Date.UTC(2026, 0, 15)); // 2026-01-15
    expect(computeExpiresAt(activatedAt, "basic")).toEqual(new Date(Date.UTC(2026, 3, 15)));
  });

  it("computes 12 months forward for premium", () => {
    const activatedAt = new Date(Date.UTC(2026, 0, 15)); // 2026-01-15
    expect(computeExpiresAt(activatedAt, "premium")).toEqual(new Date(Date.UTC(2027, 0, 15)));
  });

  it("returns null for exclusive (never expires)", () => {
    const activatedAt = new Date(Date.UTC(2026, 0, 15));
    expect(computeExpiresAt(activatedAt, "exclusive")).toBeNull();
  });

  it("does not mutate the activatedAt argument", () => {
    const activatedAt = new Date(Date.UTC(2026, 0, 15));
    const original = activatedAt.getTime();
    computeExpiresAt(activatedAt, "basic");
    expect(activatedAt.getTime()).toBe(original);
  });

  it("handles the month-boundary overflow via native setUTCMonth rollover (Jan 31 + 1 month -> Mar 3, not Feb 31)", () => {
    // Documenting, not fighting, the platform: 2026 is not a leap year, so Feb has 28 days.
    // setUTCMonth(1) on a day-31 date overflows past Feb 28 into March, landing on Mar 3.
    const activatedAt = new Date(Date.UTC(2026, 0, 31)); // 2026-01-31
    const oneMonthForward = new Date(activatedAt);
    oneMonthForward.setUTCMonth(oneMonthForward.getUTCMonth() + 1);
    expect(oneMonthForward).toEqual(new Date(Date.UTC(2026, 2, 3))); // 2026-03-03

    // basic's 3-month duration from Jan 31 also overflows: month index 0+3=3 (April) has only
    // 30 days, so day 31 rolls into May 1 — same native setUTCMonth behavior, not special-cased.
    expect(computeExpiresAt(activatedAt, "basic")).toEqual(new Date(Date.UTC(2026, 4, 1)));
  });
});
