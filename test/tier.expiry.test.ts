import { describe, expect, it } from "vitest";
import {
  EXPIRY_GRACE_DAYS,
  getInvitationExpiryState,
  isDomainActive,
  isInvitationExpired,
  isInvitationLocked,
  parseTimestampMs,
} from "../src/tier.js";

const EXPIRES = "2026-01-10T00:00:00.000Z";
const GRACE_END = "2026-02-09T00:00:00.000Z"; // EXPIRES + 30d
const at = (iso: string) => new Date(iso);

describe("parseTimestampMs", () => {
  it("parses Z, +07:00, sqlite and Date; nulls/garbage give null", () => {
    const utc = Date.parse("2026-01-10T00:00:00Z");
    expect(parseTimestampMs("2026-01-10T00:00:00Z")).toBe(utc);
    expect(parseTimestampMs("2026-01-10T07:00:00+07:00")).toBe(utc);
    expect(parseTimestampMs("2026-01-10 00:00:00")).toBe(utc);
    expect(parseTimestampMs("2026-01-10T00:00:00")).toBe(utc);
    expect(parseTimestampMs(new Date(utc))).toBe(utc);
    for (const bad of [null, undefined, "", "  ", "not-a-date", new Date("x")]) {
      expect(parseTimestampMs(bad as never)).toBeNull();
    }
  });
});

describe("isInvitationExpired (AC-16.2 matrix)", () => {
  it.each([
    ["demo, past expires_at", { is_demo: 1, expires_at: "2020-01-01T00:00:00Z" }, false],
    ["demo, null expires_at", { is_demo: 1, expires_at: null }, false],
    ["real, null (legacy)", { is_demo: 0, expires_at: null }, false],
    ["real, missing fields", {}, false],
    ["real, past", { is_demo: 0, expires_at: "2020-01-01T00:00:00Z" }, true],
    ["real, future", { is_demo: 0, expires_at: "2099-01-01T00:00:00Z" }, false],
    ["garbage expires_at fails open", { is_demo: 0, expires_at: "junk" }, false],
    ["is_demo true (boolean) is not demo", { is_demo: true as never, expires_at: "2020-01-01T00:00:00Z" }, true],
  ])("%s", (_name, row, expected) => {
    expect(isInvitationExpired(row, at("2026-06-01T00:00:00Z"))).toBe(expected);
  });

  it("null/undefined row is not expired", () => {
    expect(isInvitationExpired(null)).toBe(false);
    expect(isInvitationExpired(undefined)).toBe(false);
  });

  it("boundary is inclusive: expires_at <= now", () => {
    const row = { is_demo: 0, expires_at: EXPIRES };
    expect(isInvitationExpired(row, at("2026-01-09T23:59:59.999Z"))).toBe(false);
    expect(isInvitationExpired(row, at(EXPIRES))).toBe(true);
    expect(isInvitationExpired(row, at("2026-01-10T00:00:00.001Z"))).toBe(true);
  });

  it("+07:00 offset and Z forms of the same instant agree", () => {
    const zulu = { expires_at: "2026-01-10T00:00:00Z" };
    const wib = { expires_at: "2026-01-10T07:00:00+07:00" };
    for (const now of ["2026-01-09T23:59:59Z", "2026-01-10T00:00:00Z", "2026-01-10T00:00:01Z"]) {
      expect(isInvitationExpired(wib, at(now))).toBe(isInvitationExpired(zulu, at(now)));
    }
    // 07:00+07:00 on the 10th is 00:00Z on the 10th, so 23:59:59Z on the 9th is not yet expired
    expect(isInvitationExpired(wib, at("2026-01-09T23:59:59Z"))).toBe(false);
  });

  it("accepts a Date expires_at", () => {
    expect(isInvitationExpired({ expires_at: at(EXPIRES) }, at("2026-02-01T00:00:00Z"))).toBe(true);
  });
});

describe("isInvitationLocked / getInvitationExpiryState (30-day grace)", () => {
  const row = { is_demo: 0, expires_at: EXPIRES };

  it("default grace is 30 days", () => {
    expect(EXPIRY_GRACE_DAYS).toBe(30);
  });

  it("walks active -> grace -> locked with inclusive boundaries", () => {
    expect(getInvitationExpiryState(row, at("2026-01-09T23:59:59.999Z"))).toBe("active");
    expect(getInvitationExpiryState(row, at(EXPIRES))).toBe("grace");
    expect(getInvitationExpiryState(row, at("2026-02-08T23:59:59.999Z"))).toBe("grace");
    expect(getInvitationExpiryState(row, at(GRACE_END))).toBe("locked");
    expect(getInvitationExpiryState(row, at("2027-01-01T00:00:00Z"))).toBe("locked");
  });

  it("locked is false before expiry and during grace", () => {
    expect(isInvitationLocked(row, at("2026-01-05T00:00:00Z"))).toBe(false);
    expect(isInvitationLocked(row, at("2026-01-20T00:00:00Z"))).toBe(false);
    expect(isInvitationLocked(row, at(GRACE_END))).toBe(true);
  });

  it("custom graceDays, 0 = lock at expiry, invalid falls back to default", () => {
    expect(isInvitationLocked(row, at(EXPIRES), 0)).toBe(true);
    expect(isInvitationLocked(row, at("2026-01-17T00:00:00Z"), 7)).toBe(true);
    expect(isInvitationLocked(row, at("2026-01-16T23:59:59Z"), 7)).toBe(false);
    expect(isInvitationLocked(row, at("2026-01-20T00:00:00Z"), -1)).toBe(false);
    expect(isInvitationLocked(row, at("2026-01-20T00:00:00Z"), Number.NaN)).toBe(false);
  });

  it("grace boundary works with +07:00 offset input", () => {
    const wib = { expires_at: "2026-01-10T07:00:00+07:00" };
    expect(isInvitationLocked(wib, at("2026-02-08T23:59:59Z"))).toBe(false);
    expect(isInvitationLocked(wib, at(GRACE_END))).toBe(true);
  });

  it("demo and null/legacy are never expired, grace or locked", () => {
    const far = at("2099-01-01T00:00:00Z");
    for (const candidate of [
      { is_demo: 1, expires_at: "2020-01-01T00:00:00Z" },
      { is_demo: 1, expires_at: null },
      { is_demo: 0, expires_at: null },
      null,
      undefined,
    ]) {
      expect(isInvitationLocked(candidate, far)).toBe(false);
      expect(getInvitationExpiryState(candidate, far)).toBe("active");
    }
  });
});

describe("isDomainActive", () => {
  const now = at("2026-06-01T00:00:00Z");
  const live = { is_demo: 0, expires_at: "2099-01-01T00:00:00Z" };

  it("requires status active", () => {
    expect(isDomainActive({ status: "active", expires_at: null }, live, now)).toBe(true);
    for (const status of ["pending", "inactive", "expired", null, undefined]) {
      expect(isDomainActive({ status, expires_at: null }, live, now)).toBe(false);
    }
    expect(isDomainActive(null, live, now)).toBe(false);
  });

  it("domain's own expiry: null or future ok, <= now stops it", () => {
    expect(isDomainActive({ status: "active", expires_at: "2026-06-01T00:00:00.001Z" }, live, now)).toBe(true);
    expect(isDomainActive({ status: "active", expires_at: "2026-06-01T00:00:00Z" }, live, now)).toBe(false);
    expect(isDomainActive({ status: "active", expires_at: "2026-06-01T07:00:00+07:00" }, live, now)).toBe(false);
  });

  it("stops when the invitation tier period has passed, even with a live domain year", () => {
    const domain = { status: "active", expires_at: "2099-01-01T00:00:00Z" };
    expect(isDomainActive(domain, { is_demo: 0, expires_at: "2026-05-31T00:00:00Z" }, now)).toBe(false);
    expect(isDomainActive(domain, { is_demo: 0, expires_at: null }, now)).toBe(true);
  });

  it("demo invitation never stops the domain", () => {
    const domain = { status: "active", expires_at: null };
    expect(isDomainActive(domain, { is_demo: 1, expires_at: "2020-01-01T00:00:00Z" }, now)).toBe(true);
  });
});
