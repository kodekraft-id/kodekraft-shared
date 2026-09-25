// QA-shared-17: regression guards proving the tier.ts widening stays backward compatible and
// that the doc 11 / doc 17 guard rules cannot silently regress.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeExpiresAt, getEffectivePhotoCap, hasFeature, TIER_CAPABILITIES } from "../src/tier.js";

// Comments stripped: the header legitimately mentions HttpError to explain why it is NOT here.
const tierSource = readFileSync(fileURLToPath(new URL("../src/tier.ts", import.meta.url)), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

describe("tier.ts backward compatibility", () => {
  it("old 2-arg getEffectivePhotoCap calls behave exactly as before (override ?? tier default)", () => {
    expect(getEffectivePhotoCap("basic")).toBe(5);
    expect(getEffectivePhotoCap("premium", null)).toBe(15);
    expect(getEffectivePhotoCap("exclusive", undefined)).toBe(50);
    expect(getEffectivePhotoCap("basic", 20)).toBe(20);
    expect(getEffectivePhotoCap("premium", 0)).toBe(0);
  });

  it("old 2-arg hasFeature calls compile and read the tier default (false everywhere after ruling 13)", () => {
    expect(hasFeature("basic", "qrCheckin")).toBe(false);
    expect(hasFeature("exclusive", "customDomain")).toBe(false);
  });

  it("computeExpiresAt keeps its signature and native setUTCMonth semantics", () => {
    expect(computeExpiresAt.length).toBe(2);
    expect(computeExpiresAt(new Date(Date.UTC(2026, 0, 31)), "basic")).toEqual(new Date(Date.UTC(2026, 4, 1)));
  });

  it("tier.ts is dependency-free: no imports at all, no HttpError, no throw", () => {
    expect(tierSource).not.toMatch(/HttpError/);
    expect(tierSource).not.toMatch(/throw/);
    expect(tierSource).not.toMatch(/^\s*import\s/m);
    expect(tierSource).not.toMatch(/\bfrom\s+["']/);
  });

  it("TIER_CAPABILITIES has no personalGuestLinks / story / min_tier flag (doc 11 guard comments)", () => {
    const allowed = ["customDomain", "durationMonths", "guestCap", "photoCap", "qrCheckin"];
    for (const capabilities of Object.values(TIER_CAPABILITIES)) {
      expect(Object.keys(capabilities).sort()).toEqual(allowed);
    }
    const serialized = JSON.stringify(TIER_CAPABILITIES).toLowerCase();
    expect(serialized).not.toMatch(/personalguestlinks|story|min_?tier/);
  });
});
