// BE-mono-32: the one canonical custom-domain validator. These tests exist largely to
// pin down the two real divergences that led to this module, so neither can come back.
import { describe, expect, it } from "vitest";
import {
  MAX_LABEL_LENGTH,
  MIN_LABEL_LENGTH,
  RESERVED_LABEL_LIST,
  normalizeDomainName,
} from "../src/domain-name";

const ok = (raw: string) => {
  const r = normalizeDomainName(raw);
  expect(r.reason, `expected ${JSON.stringify(raw)} to be accepted`).toBeNull();
  return r.value;
};
const bad = (raw: string | null | undefined) => {
  const r = normalizeDomainName(raw);
  expect(r.ok, `expected ${JSON.stringify(raw)} to be rejected`).toBe(false);
  return r.reason;
};

describe("normalizeDomainName", () => {
  it("accepts a bare label and appends the suffix", () => {
    expect(ok("budi-dan-sari")).toBe("budi-dan-sari.my.id");
  });

  it("accepts a full name and returns it normalized", () => {
    expect(ok("Budi-Dan-Sari.My.Id")).toBe("budi-dan-sari.my.id");
  });

  it("strips scheme, www., path, query, fragment and trailing dots", () => {
    expect(ok("https://www.budi.my.id/undangan?x=1#top")).toBe("budi.my.id");
    expect(ok("budi.my.id.")).toBe("budi.my.id");
  });

  // Divergence 2, found 2026-09-21: checkout accepted this (stripping `www.`) while the
  // dashboard rejected it by requiring exactly three DNS labels. Two doors, one queue.
  it("accepts a www-prefixed name, the case the dashboard used to refuse", () => {
    expect(ok("www.budi.my.id")).toBe("budi.my.id");
  });

  it("rejects any suffix other than .my.id", () => {
    expect(bad("budi.co.id")).toMatch(/akhiran \.my\.id/);
    expect(bad("budi.com")).toMatch(/akhiran \.my\.id/);
  });

  // Divergence 1, found 2026-09-20: the dashboard had neither of these rules, so a
  // customer could request a name checkout would have refused.
  it("enforces the minimum length", () => {
    expect(bad("ab")).toMatch(new RegExp(`${MIN_LABEL_LENGTH}-${MAX_LABEL_LENGTH}`));
    expect(ok("abc")).toBe("abc.my.id");
  });

  it("rejects every reserved label", () => {
    for (const label of RESERVED_LABEL_LIST) {
      expect(normalizeDomainName(label).ok, `${label} must be reserved`).toBe(false);
    }
  });

  it("rejects a reserved label even when written as a full name", () => {
    expect(bad("admin.my.id")).toMatch(/tidak dapat digunakan/);
  });

  it("enforces charset and hyphen placement", () => {
    expect(bad("budi_sari")).toMatch(/huruf kecil/);
    expect(bad("-budi")).toMatch(/huruf kecil/);
    expect(bad("budi-")).toMatch(/huruf kecil/);
    expect(bad("budi sari")).toMatch(/huruf kecil/);
  });

  it("rejects the punycode-style `--` in positions 3 and 4", () => {
    expect(bad("xn--budi")).toMatch(/tanda hubung ganda/);
    // A `--` elsewhere is fine.
    expect(ok("budi--sari")).toBe("budi--sari.my.id");
  });

  it("enforces the maximum label length", () => {
    expect(ok("a".repeat(MAX_LABEL_LENGTH))).toBe(`${"a".repeat(MAX_LABEL_LENGTH)}.my.id`);
    expect(bad("a".repeat(MAX_LABEL_LENGTH + 1))).toMatch(/karakter/);
  });

  it("never throws on hostile or absent input", () => {
    for (const raw of [null, undefined, "", "   ", "\n", "a".repeat(5000), "://", "...", "."]) {
      expect(() => normalizeDomainName(raw as string)).not.toThrow();
      expect(normalizeDomainName(raw as string).ok).toBe(false);
    }
  });

  it("is pure - the same input always gives the same answer", () => {
    const a = normalizeDomainName("Budi.My.Id");
    const b = normalizeDomainName("Budi.My.Id");
    expect(a).toEqual(b);
  });
});
