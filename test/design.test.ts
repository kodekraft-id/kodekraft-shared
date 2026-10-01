import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DESIGN_REQUEST_STATUSES,
  DESIGN_REQUEST_STATUS_LABEL,
  DESIGN_SERVICE,
  DESIGN_TERMS,
  DESIGN_TERMS_VERSION,
  designTermsSha256,
  designTermsText,
  getDesignTerms,
  isDesignRequestStatus,
  normalizeFigmaUrl,
  sha256Hex,
} from "../src/design.js";

describe("desain custom: teks persetujuan", () => {
  it("versi yang berlaku ada dan memuat lima poin yang disetujui Pram (doc 26 §3)", () => {
    const terms = getDesignTerms(DESIGN_TERMS_VERSION)!;
    expect(terms.version).toBe("desain-custom-v1");
    expect(terms.points).toHaveLength(5);
    expect(terms.points[1]).toContain("menjual ulang desain ini sebagai template undangan");
    expect(terms.points[2]).toContain("setelah tanggal acara saya");
    expect(terms.points[4]).toContain("saya bertanggung jawab atas klaim tersebut");
  });

  it("teks kanonik: judul + versi, kalimat centang, poin bernomor", () => {
    const text = designTermsText("desain-custom-v1")!;
    const lines = text.split("\n");
    expect(lines[0]).toBe("Ketentuan Desain Custom (desain-custom-v1)");
    expect(lines[1]).toBe("Saya menyetujui Ketentuan Desain Custom:");
    expect(lines.slice(2).map((l) => l.slice(0, 3))).toEqual(["1. ", "2. ", "3. ", "4. ", "5. "]);
  });

  it("versi yang tidak dikenal tidak punya teks, termasuk nama bawaan objek", async () => {
    for (const v of ["desain-custom-v0", "", "toString", "__proto__"]) {
      expect(getDesignTerms(v)).toBeNull();
      expect(designTermsText(v)).toBeNull();
      expect(await designTermsSha256(v)).toBeNull();
    }
  });

  it("sha256 sama dengan implementasi Node, huruf kecil, 64 karakter", async () => {
    const text = designTermsText(DESIGN_TERMS_VERSION)!;
    const expected = createHash("sha256").update(text, "utf8").digest("hex");
    expect(await designTermsSha256(DESIGN_TERMS_VERSION)).toBe(expected);
    expect(await sha256Hex("é")).toBe(createHash("sha256").update("é", "utf8").digest("hex"));
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it("teks versi 1 tidak berubah: mengubahnya berarti versi baru, bukan edit", async () => {
    // Sidik ini dikunci sengaja (dihitung terpisah dari teks doc 26 §3). Kalau tes ini gagal, teks
    // desain-custom-v1 telah diedit, dan setiap bukti yang sudah tersimpan berhenti cocok dengan versi
    // resminya. Kembalikan teksnya, lalu buat desain-custom-v2.
    expect(await designTermsSha256("desain-custom-v1")).toBe(
      "b2f41f644927fb13c7ea9e97db53dffc2eac3ca08fb0e10839e6e6ea759b6749",
    );
    expect(Object.isFrozen(DESIGN_TERMS)).toBe(true);
    expect(Object.isFrozen(DESIGN_TERMS["desain-custom-v1"])).toBe(true);
    expect(Object.isFrozen(DESIGN_TERMS["desain-custom-v1"].points)).toBe(true);
  });

  it("janji layanan terpisah dari persetujuan", () => {
    expect(DESIGN_SERVICE).toEqual({ revisions: 2, workDays: 7, minLeadDays: 14 });
    expect(designTermsText(DESIGN_TERMS_VERSION)).not.toContain("hari kerja");
  });
});

describe("desain custom: link Figma", () => {
  it("menerima file desain, file lama, dan prototipe, dengan atau tanpa www", () => {
    for (const url of [
      "https://www.figma.com/design/AbCdEf1234567890xyz/Undangan-Budi?node-id=1-2&t=x",
      "https://figma.com/file/AbCdEf1234567890xyz/Undangan",
      "https://www.figma.com/proto/AbCdEf1234567890xyz",
      "  https://www.figma.com/design/AbCdEf1234567890xyz/  ",
    ]) {
      const r = normalizeFigmaUrl(url);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(url.trim());
    }
  });

  it("menolak selain itu, dengan alasan yang bisa dibaca pembeli", () => {
    const cases: [unknown, string][] = [
      ["", "wajib"],
      [null, "wajib"],
      ["http://www.figma.com/design/AbCdEf1234567890/x", "tidak dikenali"],
      ["https://www.figma.com.evil.test/design/AbCdEf1234567890", "tidak dikenali"],
      ["https://evil.test/https://www.figma.com/design/AbCdEf1234567890", "tidak dikenali"],
      ["https://www.figma.com/community/file/1234567890123/Wedding", "komunitas"],
      ["https://www.figma.com/design/short", "tidak dikenali"],
      ["https://www.figma.com/design/AbCdEf1234567890/a b", "tidak dikenali"],
      ["https://www.figma.com/design/AbCdEf1234567890/" + "x".repeat(2100), "terlalu panjang"],
    ];
    for (const [input, reason] of cases) {
      const r = normalizeFigmaUrl(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain(reason);
    }
  });
});

describe("desain custom: status antrean", () => {
  it("empat status, masing-masing berlabel", () => {
    expect(DESIGN_REQUEST_STATUSES).toEqual(["received", "in_progress", "done", "cancelled"]);
    for (const s of DESIGN_REQUEST_STATUSES) expect(DESIGN_REQUEST_STATUS_LABEL[s]).toBeTruthy();
    expect(isDesignRequestStatus("done")).toBe(true);
    expect(isDesignRequestStatus("selesai")).toBe(false);
  });
});
