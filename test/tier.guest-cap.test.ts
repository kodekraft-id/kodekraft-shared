// Kuota tamu per tier + add-on Extra Tamu (doc 20 §2/§3).
//
// Kuota ini membatasi berapa baris tamu yang boleh DITAMBAHKAN. Ia tidak pernah
// membatasi tamu yang sudah ada — tidak saat membuka undangan, tidak saat RSVP,
// tidak saat check-in. Aturan itu ditegakkan di worker-user; yang dijaga di sini
// adalah angkanya dan aritmetikanya.
import { describe, expect, it } from "vitest";
import {
  GUESTS_ADDON_GUESTS,
  MAX_ADDON_QUANTITY,
  TIER_CAPABILITIES,
  getEffectiveCapabilities,
  getEffectiveGuestCap,
  parsePurchasedAddons,
  type PackageTier,
} from "../src/tier";

const TIERS: PackageTier[] = ["basic", "premium", "exclusive"];

describe("getEffectiveGuestCap", () => {
  it("tanpa add-on dan tanpa override, kuotanya persis angka tier-nya", () => {
    expect(getEffectiveGuestCap("basic")).toBe(250);
    expect(getEffectiveGuestCap("premium")).toBe(500);
    expect(getEffectiveGuestCap("exclusive")).toBe(1000);
  });

  it("satu unit Extra Tamu menambah 100, dan boleh dibeli berkali-kali", () => {
    expect(getEffectiveGuestCap("basic", null, { guests: 1 })).toBe(350);
    expect(getEffectiveGuestCap("basic", null, { guests: 3 })).toBe(550);
    expect(getEffectiveGuestCap("premium", null, { guests: 2 })).toBe(700);
    expect(getEffectiveGuestCap("exclusive", null, { guests: 5 })).toBe(1500);
  });

  it("angkanya diturunkan dari GUESTS_ADDON_GUESTS, bukan ditulis ulang", () => {
    // Kalau nilai add-on diubah di satu tempat, tes ini ikut bergerak — janji di
    // katalog dan aritmetika di sini tidak bisa berpisah diam-diam.
    for (const tier of TIERS) {
      expect(getEffectiveGuestCap(tier, null, { guests: 4 })).toBe(
        TIER_CAPABILITIES[tier].guestCap + 4 * GUESTS_ADDON_GUESTS,
      );
    }
  });

  it("add-on lain tidak menyentuh kuota tamu", () => {
    expect(getEffectiveGuestCap("basic", null, { gallery: 3, qrcheckin: 1, domain: 1 })).toBe(250);
  });

  it("override staf menang, dan 0 adalah override yang sah", () => {
    expect(getEffectiveGuestCap("exclusive", 50)).toBe(50);
    expect(getEffectiveGuestCap("basic", 0)).toBe(0);
    // 0 berarti "tidak boleh menambah tamu sama sekali" — keadaan yang mungkin
    // dipakai saat menahan akun bermasalah. Kalau ia diperlakukan sebagai falsy,
    // akun itu justru mendapat kuota penuh tier-nya.
    expect(getEffectiveGuestCap("basic", 0, { guests: 9 })).toBe(0);
  });

  it("hanya null/undefined yang jatuh kembali ke perhitungan tier + add-on", () => {
    expect(getEffectiveGuestCap("basic", null, { guests: 1 })).toBe(350);
    expect(getEffectiveGuestCap("basic", undefined, { guests: 1 })).toBe(350);
  });

  it("override boleh di bawah angka tier — tidak dinaikkan diam-diam", () => {
    // Berbeda dari kuota foto, yang menjaga `Math.max(tierCap, ...)` pada jalur
    // add-on. Override adalah keputusan staf yang eksplisit; menaikkannya
    // kembali akan membuat keputusan itu tidak bisa dijalankan.
    expect(getEffectiveGuestCap("exclusive", 10)).toBe(10);
  });

  it("tidak ada plafon global — unit ke-99 masih menambah 100 tamu", () => {
    // Plafon foto (50) ada karena tiap foto menambah bobot halaman yang dimuat
    // tamu. Baris tamu tidak punya batas teknis setara, jadi menolaknya hanya
    // akan menolak uang tanpa alasan.
    expect(getEffectiveGuestCap("exclusive", null, { guests: MAX_ADDON_QUANTITY })).toBe(
      1000 + MAX_ADDON_QUANTITY * GUESTS_ADDON_GUESTS,
    );
  });

  it("tidak mengubah objek add-on yang dibekukan", () => {
    expect(getEffectiveGuestCap("basic", null, Object.freeze({ guests: 2 }))).toBe(450);
  });
});

describe("add-on `guests` dibaca sebagai kuantitatif, bukan biner", () => {
  it("kuantitasnya dipertahankan apa adanya", () => {
    expect(parsePurchasedAddons({ guests: 3 })).toEqual({ guests: 3 });
    expect(parsePurchasedAddons('{"guests":7}')).toEqual({ guests: 7 });
  });

  it("dijepit ke MAX_ADDON_QUANTITY, sama seperti gallery", () => {
    expect(parsePurchasedAddons({ guests: 1000 })).toEqual({ guests: MAX_ADDON_QUANTITY });
  });

  it("kuantitas tidak masuk akal diabaikan, tidak dilempar", () => {
    for (const bad of [0, -1, 1.5, "3", null, undefined, NaN]) {
      expect(parsePurchasedAddons({ guests: bad })).toEqual({});
    }
  });

  it("bentuk array warisan memberinya kuantitas 1", () => {
    expect(parsePurchasedAddons(["guests"])).toEqual({ guests: 1 });
  });
});

describe("getEffectiveCapabilities membawa guestCap", () => {
  it("argumen keempat adalah override kuota tamu, terpisah dari override foto", () => {
    const caps = getEffectiveCapabilities("basic", { gallery: 1, guests: 2 }, 9, 77);
    expect(caps.photoCap).toBe(9);
    expect(caps.guestCap).toBe(77);
  });

  it("override foto tidak pernah bocor ke kuota tamu", () => {
    // Keduanya angka, keduanya opsional, dan urutannya berdekatan — persis
    // bentuk kesalahan yang diam saja kalau tidak dipatok di sini.
    const caps = getEffectiveCapabilities("premium", { guests: 1 }, 40);
    expect(caps.photoCap).toBe(40);
    expect(caps.guestCap).toBe(600);
  });

  it("setiap tier mengembalikan kuota tamunya sendiri", () => {
    for (const tier of TIERS) {
      expect(getEffectiveCapabilities(tier).guestCap).toBe(TIER_CAPABILITIES[tier].guestCap);
    }
  });
});
