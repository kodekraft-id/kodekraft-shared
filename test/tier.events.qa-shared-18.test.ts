// QA-shared-18: independent adversarial QA pass on BE-mono-29/BE-mono-30 (doc 17 FR-20.1/FR-21.1),
// on top of the developer's own tier.events.test.ts. Two goals per the task text:
//   (1) regression evidence that BE-mono-29/30 are purely additive — no existing tier.ts export's
//       behavior changed (this is QA-shared-17's job in tier.compat.test.ts; the checks here are a
//       second, independent confirmation scoped to "importing/using the new events helpers doesn't
//       disturb the old ones", not a full re-litigation of QA-shared-17's own matrix);
//   (2) the fuller edge-case matrix doc 17 FR-20.1's AC list calls for and QA-shared-18's own text
//       names explicitly: multiple events with MIXED usable/unusable dates (not just "all bad"),
//       an event exactly at a day boundary in WIB vs UTC (the precise millisecond, not just "a
//       start_at late in the WIB evening"), and isCheckinWindowOpen with 0/1/N events (incl.
//       overlap and array-order independence).
import { describe, expect, it } from "vitest";
import {
  TIER_CAPABILITIES,
  computeExpiresAt,
  computeExpiresAtFromEvents,
  getEffectivePhotoCap,
  getInvitationExpiryState,
  hasFeature,
  isCheckinWindowOpen,
  isDomainActive,
  isInvitationExpired,
  isInvitationLocked,
  parsePurchasedAddons,
} from "../src/tier.js";

const at = (iso: string) => new Date(iso);
const addMonths = (base: Date, months: number) => {
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
};

describe("QA-shared-18 — regression: pre-existing exports unaffected by BE-mono-29/30", () => {
  it("computeExpiresAt (the OLD publish-time function, AC-20.8) is untouched: same fixed vectors as before", () => {
    expect(computeExpiresAt(at("2026-01-31T00:00:00.000Z"), "basic")).toEqual(at("2026-05-01T00:00:00.000Z"));
    expect(computeExpiresAt(at("2026-01-15T00:00:00.000Z"), "premium")).toEqual(at("2026-07-15T00:00:00.000Z"));
    expect(computeExpiresAt(at("2026-01-15T00:00:00.000Z"), "exclusive")).toEqual(at("2027-01-15T00:00:00.000Z"));
    expect(computeExpiresAt.length).toBe(2); // signature unchanged
  });

  it("TIER_CAPABILITIES values/shape are exactly what QA-shared-17 pinned, still frozen", () => {
    expect(TIER_CAPABILITIES).toEqual({
      basic: { photoCap: 5, qrCheckin: false, customDomain: false, durationMonths: 3 },
      premium: { photoCap: 15, qrCheckin: false, customDomain: false, durationMonths: 6 },
      exclusive: { photoCap: 50, qrCheckin: false, customDomain: false, durationMonths: 12 },
    });
    expect(Object.isFrozen(TIER_CAPABILITIES)).toBe(true);
  });

  it("calling the new events/window helpers many times never mutates TIER_CAPABILITIES (shared addTierPeriodMonths reads it, must never write it)", () => {
    for (let i = 0; i < 50; i++) {
      computeExpiresAtFromEvents([{ end_at: `2026-0${(i % 9) + 1}-01T00:00:00Z` }], "basic");
      isCheckinWindowOpen([{ start_at: "2026-01-01T00:00:00Z", end_at: "2026-01-01T02:00:00Z" }], { now: new Date() });
    }
    expect(TIER_CAPABILITIES.basic.durationMonths).toBe(3);
    expect(TIER_CAPABILITIES.premium.durationMonths).toBe(6);
    expect(TIER_CAPABILITIES.exclusive.durationMonths).toBe(12);
  });

  it("getEffectivePhotoCap / hasFeature / parsePurchasedAddons spot-checks unchanged", () => {
    expect(getEffectivePhotoCap("basic", null, { gallery: 3 })).toBe(50);
    expect(hasFeature("exclusive", "qrCheckin", { qrcheckin: 1 })).toBe(true);
    expect(hasFeature("exclusive", "qrCheckin", {})).toBe(false);
    expect(parsePurchasedAddons('{"gallery":2}')).toEqual({ gallery: 2 });
  });

  it("isInvitationExpired / isInvitationLocked / getInvitationExpiryState / isDomainActive spot-checks unchanged", () => {
    const row = { is_demo: 0, expires_at: "2026-01-10T00:00:00.000Z" };
    expect(isInvitationExpired(row, at("2026-01-10T00:00:00.000Z"))).toBe(true);
    expect(isInvitationLocked(row, at("2026-02-09T00:00:00.000Z"))).toBe(true);
    expect(getInvitationExpiryState(row, at("2026-01-20T00:00:00.000Z"))).toBe("grace");
    expect(isDomainActive({ status: "active", expires_at: null }, { is_demo: 0, expires_at: null }, at("2026-01-01T00:00:00Z"))).toBe(true);
  });
});

describe("QA-shared-18 — computeExpiresAtFromEvents: mixed usable/unusable dates in ONE event list", () => {
  it("one usable event amid unusable ones (garbage strings, empty, missing) is used; the rest are excluded, not fatal", () => {
    const events = [
      { start_at: "not-a-date", end_at: "" },
      { end_at: "2026-04-01T00:00:00Z" },
      { start_at: undefined, end_at: null },
      {},
    ];
    expect(computeExpiresAtFromEvents(events, "basic")).toBe(addMonths(at("2026-04-01T00:00:00Z"), 3).toISOString());
  });

  it("the one usable event's position in the array (first / middle / last) never changes the result", () => {
    const good = { end_at: "2026-04-01T00:00:00Z" };
    const bad1 = { start_at: "junk" };
    const bad2 = { end_at: "also junk", start_at: "" };
    const expected = computeExpiresAtFromEvents([good], "premium");
    expect(computeExpiresAtFromEvents([good, bad1, bad2], "premium")).toBe(expected);
    expect(computeExpiresAtFromEvents([bad1, good, bad2], "premium")).toBe(expected);
    expect(computeExpiresAtFromEvents([bad1, bad2, good], "premium")).toBe(expected);
  });

  it("multiple usable dates mixed with multiple unusable ones: MAX still wins, unaffected by the noise", () => {
    const events = [
      { end_at: "2026-01-01T00:00:00Z" },
      { start_at: "junk", end_at: "also junk" },
      { end_at: "2026-06-01T00:00:00Z" }, // latest
      {},
      { end_at: "2026-03-01T00:00:00Z" },
      { start_at: null, end_at: undefined },
    ];
    expect(computeExpiresAtFromEvents(events, "exclusive")).toBe(addMonths(at("2026-06-01T00:00:00Z"), 12).toISOString());
  });

  it("a mix where the only usable date comes from a bare start_at (WIB fallback) alongside unusable ones", () => {
    const events = [{ start_at: "junk" }, { start_at: "2026-04-01T10:00:00Z" }, {}];
    // 2026-04-01T16:59:59.999Z == 23:59:59.999 WIB Apr 1
    expect(computeExpiresAtFromEvents(events, "basic")).toBe(addMonths(at("2026-04-01T16:59:59.999Z"), 3).toISOString());
  });
});

describe("QA-shared-18 — WIB/UTC day boundary at the exact millisecond", () => {
  it("start_at exactly at WIB midnight (00:00:00.000 WIB) belongs to THAT WIB day, not the previous one", () => {
    // 2026-03-01T00:00:00.000+07:00 == 2026-02-28T17:00:00.000Z
    const iso = computeExpiresAtFromEvents([{ start_at: "2026-02-28T17:00:00.000Z" }], "basic");
    expect(iso).toBe(addMonths(at("2026-03-01T16:59:59.999Z"), 3).toISOString());
  });

  it("one millisecond earlier (23:59:59.999 WIB the day before) belongs to the PREVIOUS WIB day", () => {
    // 2026-02-28T23:59:59.999+07:00 == 2026-02-28T16:59:59.999Z
    const iso = computeExpiresAtFromEvents([{ start_at: "2026-02-28T16:59:59.999Z" }], "basic");
    expect(iso).toBe(addMonths(at("2026-02-28T16:59:59.999Z"), 3).toISOString());
  });

  it("the same instant expressed as a +07:00 literal agrees with the Z form, at the boundary", () => {
    const zulu = computeExpiresAtFromEvents([{ start_at: "2026-02-28T17:00:00.000Z" }], "premium");
    const wib = computeExpiresAtFromEvents([{ start_at: "2026-03-01T00:00:00.000+07:00" }], "premium");
    expect(wib).toBe(zulu);
  });

  it("isCheckinWindowOpen's default end-of-day fallback is inclusive at 23:59:59.999 WIB and closed 1ms later, across the exact WIB/UTC rollover instant", () => {
    const events = [{ start_at: "2026-02-28T17:00:00.000Z" }]; // 00:00:00.000 WIB Mar 1, no end_at
    expect(isCheckinWindowOpen(events, { now: at("2026-03-01T16:59:59.999Z") })).toBe(true);
    expect(isCheckinWindowOpen(events, { now: at("2026-03-01T17:00:00.000Z") })).toBe(false);
  });

  it("a year boundary crossing (Dec 31 late WIB evening rolls to Jan 1) resolves to the correct WIB day", () => {
    // 2026-12-31T18:00:00Z == 2027-01-01T01:00:00+07:00 -> WIB day is Jan 1 2027, not Dec 31 2026.
    const iso = computeExpiresAtFromEvents([{ start_at: "2026-12-31T18:00:00.000Z" }], "basic");
    expect(iso).toBe(addMonths(at("2027-01-01T16:59:59.999Z"), 3).toISOString());
  });
});

describe("QA-shared-18 — isCheckinWindowOpen with 0/1/N events, overlap, and array order", () => {
  it("0 events: always closed (unless testMode)", () => {
    expect(isCheckinWindowOpen([], { now: at("2026-06-01T00:00:00Z") })).toBe(false);
    expect(isCheckinWindowOpen([], { now: at("2026-06-01T00:00:00Z"), testMode: true })).toBe(true);
  });

  it("1 event: open only inside its own window", () => {
    const events = [{ start_at: "2026-06-01T10:00:00Z", end_at: "2026-06-01T12:00:00Z" }];
    expect(isCheckinWindowOpen(events, { now: at("2026-06-01T11:00:00Z") })).toBe(true);
    expect(isCheckinWindowOpen(events, { now: at("2026-06-02T00:00:00Z") })).toBe(false);
  });

  it("N (3) events: open if ANY window matches, closed only once ALL are closed", () => {
    const events = [
      { start_at: "2026-01-01T10:00:00Z", end_at: "2026-01-01T12:00:00Z" },
      { start_at: "2026-06-01T10:00:00Z", end_at: "2026-06-01T12:00:00Z" },
      { start_at: "2099-01-01T10:00:00Z", end_at: "2099-01-01T12:00:00Z" },
    ];
    expect(isCheckinWindowOpen(events, { now: at("2026-06-01T11:00:00Z") })).toBe(true); // middle event
    expect(isCheckinWindowOpen(events, { now: at("2050-01-01T00:00:00Z") })).toBe(false); // none
  });

  it("N events all missing start_at: closed (no usable window at all), never throws", () => {
    const events = [{ end_at: "2026-06-01T12:00:00Z" }, {}, { start_at: null, end_at: "2099-01-01T00:00:00Z" }];
    expect(() => isCheckinWindowOpen(events, { now: at("2026-06-01T11:00:00Z") })).not.toThrow();
    expect(isCheckinWindowOpen(events, { now: at("2026-06-01T11:00:00Z") })).toBe(false);
  });

  it("overlapping events: still open inside the overlap and inside either exclusive half, no double-count/crash", () => {
    const events = [
      { start_at: "2026-06-01T10:00:00Z", end_at: "2026-06-01T14:00:00Z" },
      { start_at: "2026-06-01T12:00:00Z", end_at: "2026-06-01T16:00:00Z" },
    ];
    expect(isCheckinWindowOpen(events, { now: at("2026-06-01T13:00:00Z") })).toBe(true); // overlap
    expect(isCheckinWindowOpen(events, { now: at("2026-06-01T15:00:00Z") })).toBe(true); // 2nd only
    expect(isCheckinWindowOpen(events, { now: at("2026-06-01T08:59:59.999Z") })).toBe(false); // before 1st's buffer (10:00-60min=9:00)
    expect(isCheckinWindowOpen(events, { now: at("2026-06-01T09:00:00.000Z") })).toBe(true); // exactly 1st's buffer open
  });

  it("array order never changes the result (MAX/ANY semantics are order-independent)", () => {
    const a = { start_at: "2026-01-01T10:00:00Z", end_at: "2026-01-01T12:00:00Z" };
    const b = { start_at: "2026-06-01T10:00:00Z", end_at: "2026-06-01T12:00:00Z" };
    const c = { start_at: "2099-01-01T10:00:00Z", end_at: "2099-01-01T12:00:00Z" };
    for (const now of [at("2026-01-01T11:00:00Z"), at("2026-06-01T11:00:00Z"), at("2050-01-01T00:00:00Z")]) {
      const forward = isCheckinWindowOpen([a, b, c], { now });
      expect(isCheckinWindowOpen([c, b, a], { now })).toBe(forward);
      expect(isCheckinWindowOpen([b, a, c], { now })).toBe(forward);
    }
  });
});
