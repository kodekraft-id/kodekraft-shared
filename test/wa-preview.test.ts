import { describe, expect, it } from "vitest";
import {
  WA_PREVIEW_FOCUS_Y,
  WA_PREVIEW_HEIGHT,
  WA_PREVIEW_MAX_BYTES,
  WA_PREVIEW_QUALITIES,
  WA_PREVIEW_TARGET_BYTES,
  WA_PREVIEW_WIDTH,
  waPreviewCrop,
  waPreviewKey,
} from "../src/wa-preview.js";

describe("waPreviewKey", () => {
  it("mengganti ekstensi kunci sampul dengan .wa.jpg, di folder yang sama", () => {
    expect(waPreviewKey("inv/inv_abc/section/0b6c3f1e-1111-4222-8333-944455556666.webp")).toBe(
      "inv/inv_abc/section/0b6c3f1e-1111-4222-8333-944455556666.wa.jpg",
    );
    expect(waPreviewKey("inv/inv_abc/photo/x.jpg")).toBe("inv/inv_abc/photo/x.wa.jpg");
    expect(waPreviewKey("inv/inv_abc/photo/x.png")).toBe("inv/inv_abc/photo/x.wa.jpg");
  });

  it("tetap di bawah awalan inv/<id>/, jadi ikut terhapus bersama media undangan", () => {
    const key = waPreviewKey("inv/inv_abc/section/u.webp")!;
    expect(key.startsWith("inv/inv_abc/")).toBe(true);
  });

  it("hanya ekstensi terakhir yang diganti", () => {
    expect(waPreviewKey("inv/inv_abc/section/a.b.webp")).toBe("inv/inv_abc/section/a.b.wa.jpg");
  });

  it.each([null, undefined, "", "photo.webp", "inv/inv_abc/section/tanpa-ekstensi", "media/x.webp", "inv/x.webp"])(
    "%s => null (bukan kunci media undangan)",
    (key) => {
      expect(waPreviewKey(key)).toBeNull();
    },
  );

  it("kunci berkas WA tidak diturunkan lagi", () => {
    expect(waPreviewKey("inv/inv_abc/section/u.wa.jpg")).toBeNull();
  });
});

describe("waPreviewCrop", () => {
  const ratio = WA_PREVIEW_WIDTH / WA_PREVIEW_HEIGHT;

  it("potret 2160×2880: lebar penuh, tinggi sesuai rasio, titik tengah 40% dari atas", () => {
    const c = waPreviewCrop(2160, 2880);
    expect(c.sx).toBe(0);
    expect(c.sw).toBe(2160);
    expect(c.sh).toBe(Math.round(2160 / ratio));
    expect(c.sy + c.sh / 2).toBeCloseTo(2880 * WA_PREVIEW_FOCUS_Y, 0);
  });

  it("lanskap 4:3 (2880×2160) masih lebih tinggi dari 1200:630: lebar penuh, dipotong atas-bawah", () => {
    const c = waPreviewCrop(2880, 2160);
    expect(c.sx).toBe(0);
    expect(c.sw).toBe(2880);
    expect(c.sh).toBe(Math.round(2880 / ratio));
    expect(c.sy + c.sh / 2).toBeCloseTo(2160 * WA_PREVIEW_FOCUS_Y, 0);
  });

  it("lebih lebar dari 1200:630 (3000×1200): tinggi penuh, dipotong kiri-kanan sama banyak", () => {
    const c = waPreviewCrop(3000, 1200);
    const sw = Math.round(1200 * ratio);
    expect(c).toEqual({ sx: Math.floor((3000 - sw) / 2), sy: 0, sw, sh: 1200 });
  });

  it("panorama sangat lebar: tetap di dalam gambar", () => {
    const c = waPreviewCrop(5000, 500);
    expect(c.sx).toBeGreaterThanOrEqual(0);
    expect(c.sx + c.sw).toBeLessThanOrEqual(5000);
    expect(c.sh).toBe(500);
  });

  it("gambar persis 1200×630 tidak dipotong", () => {
    expect(waPreviewCrop(1200, 630)).toEqual({ sx: 0, sy: 0, sw: 1200, sh: 630 });
  });

  it("potret yang sedikit lebih tinggi dari rasio: potongan tidak keluar dari bawah gambar", () => {
    const c = waPreviewCrop(1200, 640);
    expect(c.sy).toBeGreaterThanOrEqual(0);
    expect(c.sy + c.sh).toBeLessThanOrEqual(640);
  });

  it.each([
    [1, 1],
    [3, 1000],
    [1000, 3],
    [4032, 3024],
    [3024, 4032],
    [1080, 1920],
  ])("%i×%i: potongan selalu di dalam gambar dan rasionya mendekati 1200:630", (w, h) => {
    const c = waPreviewCrop(w, h);
    expect(c.sx).toBeGreaterThanOrEqual(0);
    expect(c.sy).toBeGreaterThanOrEqual(0);
    expect(c.sx + c.sw).toBeLessThanOrEqual(w);
    expect(c.sy + c.sh).toBeLessThanOrEqual(h);
    expect(c.sw).toBeGreaterThan(0);
    expect(c.sh).toBeGreaterThan(0);
    if (w >= 100 && h >= 100) expect(Math.abs(c.sw / c.sh - ratio)).toBeLessThan(0.01);
  });

  it.each([
    [0, 100],
    [100, 0],
    [Number.NaN, 100],
    [-5, 100],
  ])("%s×%s ditolak", (w, h) => {
    expect(() => waPreviewCrop(w, h)).toThrow(RangeError);
  });
});

describe("batas ukuran", () => {
  it("target di bawah batas yang diterima server, dan kualitas menurun", () => {
    expect(WA_PREVIEW_TARGET_BYTES).toBeLessThan(WA_PREVIEW_MAX_BYTES);
    for (let i = 1; i < WA_PREVIEW_QUALITIES.length; i++) {
      expect(WA_PREVIEW_QUALITIES[i]).toBeLessThan(WA_PREVIEW_QUALITIES[i - 1]);
    }
  });
});
