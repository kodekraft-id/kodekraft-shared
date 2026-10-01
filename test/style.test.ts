import { describe, expect, it } from "vitest";
import { STAFF_CSS_MAX_LENGTH, checkStaffCss, isHexColor, isStaffTextScale } from "../src/style.js";

describe("tampilan khusus: ukuran teks dan warna", () => {
  it("ukuran teks hanya dari daftar", () => {
    expect([80, 90, 100, 120].every(isStaffTextScale)).toBe(true);
    expect([79, 92, 125, 0, -5, Number.NaN].some(isStaffTextScale)).toBe(false);
    expect(isStaffTextScale("90")).toBe(false);
  });

  it("warna hanya #rrggbb", () => {
    expect(isHexColor("#8a5A44")).toBe(true);
    for (const bad of ["#abc", "8a5a44", "red", "rgb(1,2,3)", "#8a5a44;background:red", "#8a5a4g", ""]) expect(isHexColor(bad)).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });
});

describe("tampilan khusus: aturan CSS", () => {
  it("CSS biasa lolos, spasi di ujung dibuang, kosong berarti tanpa CSS", () => {
    expect(checkStaffCss("  .btn-open{border-radius:4px}\n")).toEqual({ ok: true, css: ".btn-open{border-radius:4px}" });
    expect(checkStaffCss(".a::before{content:\"“\"} /* catatan */ @media (min-width:1024px){.b{font-size:12px}}")).toMatchObject({ ok: true });
    expect(checkStaffCss("   ")).toEqual({ ok: true, css: "" });
  });

  it("tidak bisa keluar dari elemen <style>", () => {
    expect(checkStaffCss("</style><script>alert(1)</script>")).toEqual({ ok: false, reason: "Tanda < tidak boleh dipakai di CSS khusus." });
    expect(checkStaffCss(".a{} </STYLE >")).toMatchObject({ ok: false });
  });

  it("tidak memuat berkas dari luar, juga lewat escape atau string", () => {
    const rejected = [
      ".a{background:url(https://contoh.com/a.png)}",
      ".a{background:URL ( 'x' )}",
      "@import 'https://contoh.com/a.css';",
      "@IMPORT url(x);",
      ".a{background:image-set(\"https://contoh.com/a.png\" 1x)}",
      ".a{background:-webkit-image-set(\"x\" 1x)}",
      ".a{background:image(\"x\")}",
      ".a{background:cross-fade(\"x\", \"y\")}",
      ".a{background:element(#b)}",
      "@font-face{font-family:x;src:url(x)}",
      ".a{background:u\\72l(x)}",
    ];
    for (const css of rejected) expect(checkStaffCss(css).ok, css).toBe(false);
    expect(checkStaffCss(".a{background:u\\72l(x)}")).toEqual({ ok: false, reason: "Garis miring terbalik (\\) tidak boleh dipakai. Tulis karakternya langsung." });
  });

  it("kata yang hanya MIRIP tidak ikut ditolak", () => {
    expect(checkStaffCss(".source-note{color:red} .curl{display:none} .imageset{width:1px}")).toMatchObject({ ok: true });
  });

  it("tidak menjalankan kode", () => {
    for (const css of [".a{width:expression(alert(1))}", ".a{behavior:x}", ".a{-moz-binding:x}", "a{b:javascript:alert(1)}"]) {
      expect(checkStaffCss(css)).toEqual({ ok: false, reason: "CSS khusus tidak boleh menjalankan kode." });
    }
  });

  it("panjang maksimum", () => {
    const max = ".a{}".padEnd(STAFF_CSS_MAX_LENGTH, "x");
    expect(checkStaffCss(max)).toMatchObject({ ok: true });
    expect(checkStaffCss(`${max}x`)).toEqual({ ok: false, reason: `CSS khusus terlalu panjang: ${STAFF_CSS_MAX_LENGTH + 1} karakter, maksimum ${STAFF_CSS_MAX_LENGTH}.` });
  });
});
