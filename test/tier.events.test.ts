// Unit tests for the event-based expiry + check-in pre-window helpers (product-rule change from
// Pram, 2026-09-20, v0.8.0): computeExpiresAtFromEvents (Rule A) and isCheckinWindowOpen (Rule B).
// Against the real exports, not a fixture, in the same style as tier.expiry.test.ts.

import { describe, expect, it } from "vitest";
import {
  CHECKIN_PRE_BUFFER_MINUTES,
  TIER_CAPABILITIES,
  computeExpiresAtFromEvents,
  isCheckinWindowOpen,
  type PackageTier,
} from "../src/tier.js";

const at = (iso: string) => new Date(iso);
const addMonths = (base: Date, months: number) => {
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
};

describe("computeExpiresAtFromEvents", () => {
  describe("basis selection", () => {
    it("multi-event: the latest effective end wins, whichever event it comes from", () => {
      const events = [
        { end_at: "2026-01-01T00:00:00.000Z" },
        { start_at: "2026-06-01T00:00:00.000Z" }, // no end_at -> fallback WIB EOD, still latest
        { end_at: "2026-03-01T00:00:00.000Z" },
      ];
      const expectedBasis = new Date(Date.UTC(2026, 5, 1, 16, 59, 59, 999)); // 23:59:59.999 WIB Jun 1
      const expected = addMonths(expectedBasis, 3).toISOString();
      expect(computeExpiresAtFromEvents(events, "basic")).toBe(expected);
    });

    it("a later end_at always beats an earlier one, regardless of array order", () => {
      const ascending = [{ end_at: "2026-01-01T00:00:00Z" }, { end_at: "2026-05-01T00:00:00Z" }];
      const descending = [{ end_at: "2026-05-01T00:00:00Z" }, { end_at: "2026-01-01T00:00:00Z" }];
      expect(computeExpiresAtFromEvents(ascending, "premium")).toBe(computeExpiresAtFromEvents(descending, "premium"));
    });

    it("missing end_at falls back to 23:59:59.999 WIB on start_at's WIB calendar day", () => {
      // 10:00 UTC Jan 10 = 17:00 WIB Jan 10 -> same WIB day.
      const sameDay = computeExpiresAtFromEvents([{ start_at: "2026-01-10T10:00:00.000Z" }], "basic");
      expect(sameDay).toBe(addMonths(new Date(Date.UTC(2026, 0, 10, 16, 59, 59, 999)), 3).toISOString());
    });

    it("the WIB day is derived from the shifted instant, not the raw UTC digits (crosses midnight)", () => {
      // 20:00 UTC Jan 10 = 03:00 WIB Jan 11 -> WIB day is the 11th, not the 10th.
      const iso = computeExpiresAtFromEvents([{ start_at: "2026-01-10T20:00:00.000Z" }], "basic");
      expect(iso).toBe(addMonths(new Date(Date.UTC(2026, 0, 11, 16, 59, 59, 999)), 3).toISOString());
    });

    it("end_at wins over start_at on the same event even when both are present", () => {
      const withBoth = computeExpiresAtFromEvents(
        [{ start_at: "2026-01-01T00:00:00Z", end_at: "2026-01-10T00:00:00Z" }],
        "basic",
      );
      const endOnly = computeExpiresAtFromEvents([{ end_at: "2026-01-10T00:00:00Z" }], "basic");
      expect(withBoth).toBe(endOnly);
    });

    it("+07:00 offset and Z forms of the same end_at agree", () => {
      const zulu = computeExpiresAtFromEvents([{ end_at: "2026-01-10T00:00:00Z" }], "premium");
      const wib = computeExpiresAtFromEvents([{ end_at: "2026-01-10T07:00:00+07:00" }], "premium");
      expect(wib).toBe(zulu);
    });

    it("accepts a Date instance for start_at/end_at", () => {
      const iso = computeExpiresAtFromEvents([{ end_at: at("2026-01-10T00:00:00Z") }], "basic");
      expect(iso).toBe(addMonths(at("2026-01-10T00:00:00Z"), 3).toISOString());
    });
  });

  describe("activatedAt fallback", () => {
    it("falls back to activatedAt when events is an empty array", () => {
      const iso = computeExpiresAtFromEvents([], "premium", { activatedAt: "2026-01-15T00:00:00Z" });
      expect(iso).toBe(addMonths(at("2026-01-15T00:00:00Z"), 6).toISOString());
    });

    it("falls back to activatedAt when events is null/undefined", () => {
      const expected = addMonths(at("2026-01-15T00:00:00Z"), 3).toISOString();
      expect(computeExpiresAtFromEvents(null, "basic", { activatedAt: "2026-01-15T00:00:00Z" })).toBe(expected);
      expect(computeExpiresAtFromEvents(undefined, "basic", { activatedAt: "2026-01-15T00:00:00Z" })).toBe(expected);
    });

    it("falls back to activatedAt when every event lacks a usable date", () => {
      const events = [{}, { start_at: null, end_at: null }, { start_at: "junk", end_at: "" }];
      const iso = computeExpiresAtFromEvents(events, "exclusive", { activatedAt: "2026-01-15T00:00:00Z" });
      expect(iso).toBe(addMonths(at("2026-01-15T00:00:00Z"), 12).toISOString());
    });

    it("activatedAt accepts a Date instance, not just a string", () => {
      const iso = computeExpiresAtFromEvents([], "basic", { activatedAt: new Date(Date.UTC(2026, 0, 15)) });
      expect(iso).toBe(addMonths(new Date(Date.UTC(2026, 0, 15)), 3).toISOString());
    });

    it("a usable event always wins over activatedAt, even if activatedAt is also given", () => {
      const withEvent = computeExpiresAtFromEvents([{ end_at: "2026-03-01T00:00:00Z" }], "basic", {
        activatedAt: "2020-01-01T00:00:00Z",
      });
      expect(withEvent).toBe(addMonths(at("2026-03-01T00:00:00Z"), 3).toISOString());
    });
  });

  describe("no usable basis at all", () => {
    it("returns null when events is empty/missing and activatedAt is not given", () => {
      expect(computeExpiresAtFromEvents([], "basic")).toBeNull();
      expect(computeExpiresAtFromEvents(null, "premium", {})).toBeNull();
      expect(computeExpiresAtFromEvents(undefined, "exclusive")).toBeNull();
    });

    it("returns null when neither events nor activatedAt is usable", () => {
      const events = [{ start_at: "junk", end_at: "" }];
      expect(computeExpiresAtFromEvents(events, "exclusive", { activatedAt: null })).toBeNull();
    });

    it("returns null when activatedAt is unparseable and there are no events", () => {
      expect(computeExpiresAtFromEvents([], "basic", { activatedAt: "not-a-date" })).toBeNull();
    });
  });

  describe("tier month arithmetic (reused from computeExpiresAt)", () => {
    const TIER_MONTHS: Record<PackageTier, number> = { basic: 3, premium: 6, exclusive: 12 };

    it.each(Object.entries(TIER_MONTHS) as Array<[PackageTier, number]>)(
      "%s adds %i months to the latest event end",
      (tier, months) => {
        const events = [{ end_at: "2026-01-15T00:00:00.000Z" }];
        const expected = addMonths(at("2026-01-15T00:00:00.000Z"), months).toISOString();
        expect(computeExpiresAtFromEvents(events, tier)).toBe(expected);
      },
    );

    // Same edge cases as tier.test.ts's computeExpiresAt matrix (native setUTCMonth overflow).
    it.each([
      ["basic", "2026-01-31T00:00:00.000Z", new Date(Date.UTC(2026, 4, 1))], // Apr 31 -> May 1
      ["premium", "2026-08-31T00:00:00.000Z", new Date(Date.UTC(2027, 2, 3))], // Feb 31 -> Mar 3
      ["exclusive", "2028-02-29T00:00:00.000Z", new Date(Date.UTC(2029, 2, 1))], // leap day + 12mo -> Mar 1
    ] as const)("month-end edge: %s from %s", (tier, endAt, expected) => {
      expect(computeExpiresAtFromEvents([{ end_at: endAt }], tier)).toBe(expected.toISOString());
    });

    it("legacy/defensive: a null duration returns null (test-only injection, restored after)", () => {
      const basic = TIER_CAPABILITIES.basic as { durationMonths: number | null };
      const original = basic.durationMonths;
      try {
        basic.durationMonths = null;
        expect(computeExpiresAtFromEvents([{ end_at: "2026-01-15T00:00:00Z" }], "basic")).toBeNull();
      } finally {
        basic.durationMonths = original;
      }
      expect(TIER_CAPABILITIES.basic.durationMonths).toBe(3);
    });
  });

  describe("return shape and opts.now", () => {
    it("returns a UTC ISO string, not a Date", () => {
      const iso = computeExpiresAtFromEvents([{ end_at: "2026-01-15T00:00:00Z" }], "basic");
      expect(typeof iso).toBe("string");
      expect(iso).toMatch(/Z$/);
    });

    it("opts.now is accepted but does not affect the result (documented as unused today)", () => {
      const events = [{ end_at: "2026-01-10T00:00:00Z" }];
      const withPast = computeExpiresAtFromEvents(events, "basic", { now: at("1999-01-01T00:00:00Z") });
      const withFuture = computeExpiresAtFromEvents(events, "basic", { now: at("2099-01-01T00:00:00Z") });
      expect(withPast).toBe(withFuture);
    });
  });
});

describe("CHECKIN_PRE_BUFFER_MINUTES", () => {
  it("is 60", () => {
    expect(CHECKIN_PRE_BUFFER_MINUTES).toBe(60);
  });
});

describe("isCheckinWindowOpen", () => {
  const START = "2026-06-01T10:00:00.000Z";
  const END = "2026-06-01T12:00:00.000Z";
  const events = [{ start_at: START, end_at: END }];

  it("closed well before the buffer window and well after the end", () => {
    expect(isCheckinWindowOpen(events, { now: at("2026-06-01T00:00:00.000Z") })).toBe(false);
    expect(isCheckinWindowOpen(events, { now: at("2026-06-02T00:00:00.000Z") })).toBe(false);
  });

  it("boundary: open at exactly -60min, closed 1ms before it", () => {
    expect(isCheckinWindowOpen(events, { now: at("2026-06-01T08:59:59.999Z") })).toBe(false);
    expect(isCheckinWindowOpen(events, { now: at("2026-06-01T09:00:00.000Z") })).toBe(true);
  });

  it("boundary: open at exactly end_at, closed 1ms after it", () => {
    expect(isCheckinWindowOpen(events, { now: at(END) })).toBe(true);
    expect(isCheckinWindowOpen(events, { now: at("2026-06-01T12:00:00.001Z") })).toBe(false);
  });

  it("open throughout the event itself", () => {
    expect(isCheckinWindowOpen(events, { now: at("2026-06-01T11:00:00.000Z") })).toBe(true);
  });

  describe("missing end_at (WIB fallback)", () => {
    const withoutEnd = [{ start_at: "2026-06-01T10:00:00.000Z" }]; // no end_at

    it("stays open through 23:59:59.999 WIB on start_at's day, closed 1ms after", () => {
      expect(isCheckinWindowOpen(withoutEnd, { now: at("2026-06-01T16:59:59.999Z") })).toBe(true);
      expect(isCheckinWindowOpen(withoutEnd, { now: at("2026-06-01T17:00:00.000Z") })).toBe(false);
    });
  });

  describe("no start_at (conservative choice — flagged for Pram, see src/tier.ts)", () => {
    it("an event with end_at but no start_at never opens the window", () => {
      const endOnly = [{ end_at: "2099-01-01T00:00:00Z" }];
      expect(isCheckinWindowOpen(endOnly, { now: at("2050-01-01T00:00:00Z") })).toBe(false);
    });
  });

  describe("no usable events", () => {
    it("empty array closes the window", () => {
      expect(isCheckinWindowOpen([], { now: at(START) })).toBe(false);
    });

    it("null/undefined events close the window", () => {
      expect(isCheckinWindowOpen(null, { now: at(START) })).toBe(false);
      expect(isCheckinWindowOpen(undefined, { now: at(START) })).toBe(false);
    });

    it("events with no dates at all close the window", () => {
      expect(isCheckinWindowOpen([{}, { start_at: null, end_at: null }], { now: at(START) })).toBe(false);
    });
  });

  describe("testMode", () => {
    it("always opens the window, short-circuiting everything else", () => {
      expect(isCheckinWindowOpen([], { testMode: true })).toBe(true);
      expect(isCheckinWindowOpen(null, { testMode: true })).toBe(true);
      expect(isCheckinWindowOpen(events, { testMode: true, now: at("1999-01-01T00:00:00Z") })).toBe(true);
    });
  });

  describe("multi-event", () => {
    it("opens if ANY event's window matches, even with other far-off events", () => {
      const multi = [{ start_at: "2099-01-01T00:00:00Z", end_at: "2099-01-01T02:00:00Z" }, ...events];
      expect(isCheckinWindowOpen(multi, { now: at(START) })).toBe(true);
    });
  });

  describe("bufferMinutes", () => {
    const minus60 = at("2026-06-01T09:00:00.000Z"); // exactly START - 60min

    it("a smaller custom buffer narrows the window", () => {
      expect(isCheckinWindowOpen(events, { now: minus60, bufferMinutes: 30 })).toBe(false);
      expect(isCheckinWindowOpen(events, { now: minus60, bufferMinutes: 60 })).toBe(true);
    });

    it("0 is a valid buffer: no pre-window at all", () => {
      expect(isCheckinWindowOpen(events, { now: at(START), bufferMinutes: 0 })).toBe(true);
      expect(isCheckinWindowOpen(events, { now: at("2026-06-01T09:59:59.999Z"), bufferMinutes: 0 })).toBe(false);
    });

    it.each([-5, Number.NaN, Number.NEGATIVE_INFINITY, undefined])(
      "invalid bufferMinutes (%s) falls back to the 60-minute default",
      (bufferMinutes) => {
        expect(isCheckinWindowOpen(events, { now: minus60, bufferMinutes })).toBe(true);
      },
    );

    it("a larger custom buffer widens the window", () => {
      const minus90 = at("2026-06-01T08:30:00.000Z");
      expect(isCheckinWindowOpen(events, { now: minus90, bufferMinutes: 60 })).toBe(false);
      expect(isCheckinWindowOpen(events, { now: minus90, bufferMinutes: 90 })).toBe(true);
    });
  });

  describe("+07:00 offset vs Z equivalence", () => {
    it("agree at every interesting boundary", () => {
      const zulu = [{ start_at: "2026-06-01T10:00:00Z", end_at: "2026-06-01T12:00:00Z" }];
      const wib = [{ start_at: "2026-06-01T17:00:00+07:00", end_at: "2026-06-01T19:00:00+07:00" }];
      for (const now of ["2026-06-01T08:59:59Z", "2026-06-01T09:00:00Z", "2026-06-01T11:00:00Z", "2026-06-01T12:00:00Z", "2026-06-01T12:00:01Z"]) {
        expect(isCheckinWindowOpen(wib, { now: at(now) })).toBe(isCheckinWindowOpen(zulu, { now: at(now) }));
      }
    });
  });

  it("defaults now to the current time when omitted (no throw, deterministic for a year-2000 event)", () => {
    const longPast = [{ start_at: "2000-01-01T00:00:00Z", end_at: "2000-01-01T01:00:00Z" }];
    expect(() => isCheckinWindowOpen(longPast)).not.toThrow();
    expect(isCheckinWindowOpen(longPast)).toBe(false);
  });
});
