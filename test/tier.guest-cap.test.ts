// Kuota tamu per tier (doc 20 §2/§3), digantikan doc 35 (6 Okt 2026, BE-mono-45): tidak ada kuota jual lagi.
//
// Yang tersisa hanya pagar teknis tersembunyi (GUEST_TECHNICAL_FENCE = 10.000 baris tamu per undangan), yang bukan
// kuota: tidak dijual dan tidak ditampilkan. Ia membatasi berapa baris tamu yang boleh DITAMBAHKAN dan tidak pernah
// membatasi tamu yang sudah ada — tidak saat membuka undangan, tidak saat RSVP, tidak saat check-in. Aturan itu
// ditegakkan di worker-user; yang dijaga di sini adalah angkanya dan bahwa add-on lama tidak lagi berefek.
import { describe, expect, it } from "vitest";
import {
  GUEST_TECHNICAL_FENCE,
  MAX_ADDON_QUANTITY,
  TIER_CAPABILITIES,
  getEffectiveCapabilities,
  getEffectiveGuestCap,
  parsePurchasedAddons,
  type PackageTier,
} from "../src/tier.js";

const TIERS: PackageTier[] = ["basic", "premium", "exclusive"];

describe("getEffectiveGuestCap", () => {
  it("tanpa kuota jual di semua tier: null", () => {
    for (const tier of TIERS) expect(getEffectiveGuestCap(tier)).toBeNull();
  });

  it("penegak memakai `kuota ?? pagar teknis`, jadi batas yang berlaku 10.000 baris tamu", () => {
    for (const tier of TIERS) expect(getEffectiveGuestCap(tier) ?? GUEST_TECHNICAL_FENCE).toBe(10_000);
  });

  it("hanya menerima tier: override staf dan add-on Extra Tamu tidak lagi menjadi masukan", () => {
    expect(getEffectiveGuestCap.length).toBe(1);
  });
});

describe("add-on `guests` (pensiun) masih DIBACA sebagai kuantitatif, bukan biner, supaya baris lama tidak error", () => {
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
  it("add-on `guests` yang tercatat tidak menambah apa pun: kuota tetap null", () => {
    const caps = getEffectiveCapabilities("basic", { gallery: 1, guests: 2 });
    expect(caps.photoCap).toBeNull();
    expect(caps.guestCap).toBeNull();
  });

  it("setiap tier mengembalikan kuota tamunya sendiri (sama-sama null)", () => {
    for (const tier of TIERS) {
      expect(getEffectiveCapabilities(tier).guestCap).toBe(TIER_CAPABILITIES[tier].guestCap);
    }
  });
});
