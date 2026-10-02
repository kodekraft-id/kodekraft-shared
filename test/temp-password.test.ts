import { describe, expect, it } from "vitest";
import {
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_GROUPS,
  TEMP_PASSWORD_GROUP_LENGTH,
  TEMP_PASSWORD_LENGTH,
  TEMP_PASSWORD_PATTERN,
  TEMP_PASSWORD_SEPARATOR,
  generateTemporaryPassword,
  isTemporaryPassword,
  type RandomBytes,
} from "../src/temp-password.js";

/** Aturan password dashboard (worker-user `passwordSchema`), disalin di sini supaya tes ini gagal bila formatnya tidak lagi lolos. */
function satisfiesDashboardPolicy(pw: string): boolean {
  return pw.length >= 8 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^a-zA-Z0-9]/.test(pw);
}

/** Sumber acak tetap: mengulang `bytes` terus-menerus. */
function fixedRandom(bytes: number[]): RandomBytes {
  let i = 0;
  return (length) => {
    const out = new Uint8Array(length);
    for (let k = 0; k < length; k++) out[k] = bytes[i++ % bytes.length];
    return out;
  };
}

describe("alfabet dan format (doc 30 §2.6)", () => {
  it("56 karakter, tanpa huruf/angka yang mudah tertukar, tanpa duplikat", () => {
    expect(TEMP_PASSWORD_ALPHABET).toHaveLength(56);
    expect(new Set(TEMP_PASSWORD_ALPHABET).size).toBe(56);
    for (const ambiguous of ["0", "O", "o", "1", "l", "I"]) expect(TEMP_PASSWORD_ALPHABET).not.toContain(ambiguous);
    expect(TEMP_PASSWORD_ALPHABET.replace(/[A-Z]/g, "")).toHaveLength(32); // 24 huruf besar
    expect(TEMP_PASSWORD_ALPHABET.replace(/[a-z]/g, "")).toHaveLength(32); // 24 huruf kecil
    expect(TEMP_PASSWORD_ALPHABET.replace(/[0-9]/g, "")).toHaveLength(48); // 8 angka
  });

  it("kelas karakter pola sama persis dengan alfabet", () => {
    for (let code = 0x20; code < 0x7f; code++) {
      const ch = String.fromCharCode(code);
      const asPassword = `${ch.repeat(4)}-${"Abc2"}-${"Abc2"}`;
      expect(TEMP_PASSWORD_PATTERN.test(asPassword), `karakter ${JSON.stringify(ch)}`).toBe(TEMP_PASSWORD_ALPHABET.includes(ch));
    }
  });

  it("3 kelompok × 4 karakter dipisah strip, total 14", () => {
    expect(TEMP_PASSWORD_GROUPS).toBe(3);
    expect(TEMP_PASSWORD_GROUP_LENGTH).toBe(4);
    expect(TEMP_PASSWORD_SEPARATOR).toBe("-");
    expect(TEMP_PASSWORD_LENGTH).toBe(14);
  });
});

describe("generateTemporaryPassword", () => {
  it("memenuhi format, aturan password dashboard, dan dikenali", () => {
    for (let i = 0; i < 2000; i++) {
      const pw = generateTemporaryPassword();
      expect(pw).toHaveLength(TEMP_PASSWORD_LENGTH);
      expect(pw).toMatch(TEMP_PASSWORD_PATTERN);
      expect(satisfiesDashboardPolicy(pw)).toBe(true);
      expect(isTemporaryPassword(pw)).toBe(true);
    }
  });

  it("tidak berulang (5.000 kali, 70 bit)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateTemporaryPassword());
    expect(seen.size).toBe(5000);
  });

  it("di dalam tiap golongan (huruf besar, huruf kecil, angka) setiap karakter sama peluangnya", () => {
    // Antar golongan memang tidak rata: kandidat tanpa angka (±16%) ditolak utuh, jadi angka lebih sering muncul. Itu
    // sebaran rata atas himpunan password yang LOLOS aturan (±69,4 bit), bukan cacat. Yang harus rata adalah karakter
    // di dalam satu golongan. Tanpa rejection sampling, huruf kecil a–h (indeks 24–31) akan ±15% lebih sering daripada
    // i–z, jauh di atas batas 5 simpangan baku di bawah, jadi modulo bias tertangkap di sini juga.
    const counts = new Map<string, number>();
    for (let i = 0; i < 30000; i++) {
      for (const ch of generateTemporaryPassword().replaceAll("-", "")) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(56);
    for (const cls of [/[A-Z]/, /[a-z]/, /[0-9]/]) {
      const members = [...TEMP_PASSWORD_ALPHABET].filter((ch) => cls.test(ch));
      const mean = members.reduce((sum, ch) => sum + (counts.get(ch) ?? 0), 0) / members.length;
      for (const ch of members) {
        const n = counts.get(ch) ?? 0;
        expect(Math.abs(n - mean), `karakter ${ch}: ${n} (rata-rata golongan ${Math.round(mean)})`).toBeLessThan(5 * Math.sqrt(mean));
      }
    }
  });

  it("membuang byte ≥ 224 (rejection sampling) dan memetakan sisanya dengan modulo 56", () => {
    // 224, 255, dan 230 dilewati. Sisanya byte % 56: 0 → "A", 1 → "B", 55 → "9", 24 → "a", 81 → 25 → "b", 56 → 0 → "A",
    // 2 → "C", 26 → "c", 50 → "4", 3 → "D", 27 → "d", 51 → "5". Byte ke-13 (4) tidak terpakai.
    const pw = generateTemporaryPassword(fixedRandom([224, 255, 0, 230, 1, 55, 24, 81, 56, 2, 26, 50, 3, 27, 51, 4]));
    expect(pw).toBe("AB9a-bACc-4Dd5");
  });

  it("mengulang bila hasilnya tanpa huruf kecil/angka, dan menyerah dengan error bila sumbernya rusak", () => {
    // Hanya huruf besar dulu (0..23), baru campuran.
    const upperOnly = Array.from({ length: 12 }, (_, i) => i % 24);
    const mixed = [0, 24, 48, 1, 25, 49, 2, 26, 50, 3, 27, 51];
    const pw = generateTemporaryPassword(fixedRandom([...upperOnly, ...mixed]));
    expect(pw).toMatch(TEMP_PASSWORD_PATTERN);
    expect(satisfiesDashboardPolicy(pw)).toBe(true);

    expect(() => generateTemporaryPassword(fixedRandom([0]))).toThrow(/campuran/);
    expect(() => generateTemporaryPassword(() => new Uint8Array(0))).toThrow(/kosong/);
  });
});

describe("isTemporaryPassword", () => {
  it("mengenali contoh dokumen dan menolak yang bukan formatnya", () => {
    expect(isTemporaryPassword("Hq4m-P9xK-r7Tz")).toBe(true);
    for (const value of [
      "",
      "Hq4m-P9xK-r7T", // kurang satu
      "Hq4m-P9xK-r7Tz-", // strip di ujung
      "Hq4mP9xKr7Tz", // tanpa strip
      "Hq4m P9xK r7Tz", // spasi
      " Hq4m-P9xK-r7Tz", // spasi di depan: tidak dipangkas
      "Hq4m-P9xK-r7Tz\n",
      "Hq0m-P9xK-r7Tz", // angka 0
      "Hq4m-P9xK-r7To", // huruf o
      "Hq4m_P9xK_r7Tz",
      "KodekraftDemo123", // password biasa
      "Rahasia-2026!",
    ])
      expect(isTemporaryPassword(value), JSON.stringify(value)).toBe(false);
    for (const value of [null, undefined, 12345678, {}, ["Hq4m-P9xK-r7Tz"]]) expect(isTemporaryPassword(value)).toBe(false);
  });
});
