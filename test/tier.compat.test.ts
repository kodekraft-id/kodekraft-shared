// QA-shared-17: regression guards proving the tier.ts widening stays backward compatible and
// that the doc 11 / doc 17 guard rules cannot silently regress. Updated for doc 35 (v0.26.0): the photo cap and the
// duration are gone (null), the override parameters are gone, and a retired add-on grants nothing.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeExpiresAt, getEffectivePhotoCap, hasFeature, TIER_CAPABILITIES } from "../src/tier.js";
import { useLegacyDurations } from "./support/legacy-durations.js";

// Comments stripped: the header legitimately mentions HttpError to explain why it is NOT here.
const tierSource = readFileSync(fileURLToPath(new URL("../src/tier.ts", import.meta.url)), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

describe("tier.ts backward compatibility", () => {
  it("getEffectivePhotoCap(tier) is null at every tier: the sellable cap is gone (doc 35)", () => {
    expect(getEffectivePhotoCap("basic")).toBeNull();
    expect(getEffectivePhotoCap("premium")).toBeNull();
    expect(getEffectivePhotoCap("exclusive")).toBeNull();
  });

  it("old 2-arg hasFeature calls compile and read the tier default (false everywhere after ruling 13)", () => {
    expect(hasFeature("basic", "qrCheckin")).toBe(false);
    expect(hasFeature("exclusive", "customDomain")).toBe(false);
  });

  it("computeExpiresAt keeps its signature; lifetime returns null", () => {
    expect(computeExpiresAt.length).toBe(2);
    expect(computeExpiresAt(new Date(Date.UTC(2026, 0, 31)), "basic")).toBeNull();
  });

  it("tier.ts is dependency-free: no imports at all, no HttpError, no throw", () => {
    expect(tierSource).not.toMatch(/HttpError/);
    expect(tierSource).not.toMatch(/throw/);
    expect(tierSource).not.toMatch(/^\s*import\s/m);
    expect(tierSource).not.toMatch(/\bfrom\s+["']/);
  });

  it("TIER_CAPABILITIES has no personalGuestLinks / story / min_tier flag (doc 11 guard comments)", () => {
    const allowed = ["customDomain", "durationMonths", "guestCap", "photoCap", "qrCheckin", "seating"];
    for (const capabilities of Object.values(TIER_CAPABILITIES)) {
      expect(Object.keys(capabilities).sort()).toEqual(allowed);
    }
    const serialized = JSON.stringify(TIER_CAPABILITIES).toLowerCase();
    expect(serialized).not.toMatch(/personalguestlinks|story|min_?tier/);
  });
});

describe("tier.ts backward compatibility: native setUTCMonth semantics survive for a returning active period", () => {
  useLegacyDurations();

  it("computeExpiresAt keeps native setUTCMonth overflow (Jan 31 + 3 months -> May 1)", () => {
    expect(computeExpiresAt(new Date(Date.UTC(2026, 0, 31)), "basic")).toEqual(new Date(Date.UTC(2026, 4, 1)));
  });
});
