import { describe, expect, it } from "vitest";
import {
  STAFF_ACCESS_AREA_LABEL,
  STAFF_ACCESS_CLAIM,
  STAFF_ACCESS_LINK_MINUTES,
  STAFF_ACCESS_MINUTES,
  STAFF_ACCESS_PATH,
  STAFF_ACCESS_STATE_LABEL,
  isStaffAccessSessionId,
  isStaffAccessToken,
  normalizeStaffAccessReason,
  parseStaffAccessFragment,
  staffAccessArea,
  staffAccessState,
  staffAccessUrl,
  staffAccessWindow,
  summarizeStaffAccessAreas,
} from "../src/staff-access.js";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE"; // 43 karakter base64url
const SID = "sas_7Hk2Lm9Qx4Rt1V";

describe("akses staf: konstanta (doc 27 ketentuan 5-6)", () => {
  it("60 menit akses, 5 menit tautan, klaim sas, halaman /akses-staf", () => {
    expect(STAFF_ACCESS_MINUTES).toBe(60);
    expect(STAFF_ACCESS_LINK_MINUTES).toBe(5);
    expect(STAFF_ACCESS_CLAIM).toBe("sas");
    expect(STAFF_ACCESS_PATH).toBe("/akses-staf");
  });

  it("jendela waktu: tautan 5 menit dan akses 60 menit sejak dibuat, ISO-8601", () => {
    const w = staffAccessWindow(new Date("2026-10-01T03:00:00.000Z"));
    expect(w).toEqual({
      createdAt: "2026-10-01T03:00:00.000Z",
      linkExpiresAt: "2026-10-01T03:05:00.000Z",
      expiresAt: "2026-10-01T04:00:00.000Z",
    });
  });
});

describe("akses staf: tautan serah-terima", () => {
  it("token di fragmen, bukan query; garis miring di ujung basis dibuang", () => {
    expect(staffAccessUrl("https://dash-invitation.kodekraft.id/", SID, TOKEN)).toBe(
      `https://dash-invitation.kodekraft.id/akses-staf#${SID}.${TOKEN}`,
    );
  });

  it("menolak membentuk tautan dari id atau token yang salah bentuk", () => {
    expect(() => staffAccessUrl("https://x", "usr_abcdefgh", TOKEN)).toThrow();
    expect(() => staffAccessUrl("https://x", SID, "pendek")).toThrow();
  });

  it("pembaca fragmen: dengan atau tanpa #, dan kebalikan persis pembentuknya", () => {
    const url = staffAccessUrl("http://localhost:5173", SID, TOKEN);
    const hash = url.slice(url.indexOf("#"));
    expect(parseStaffAccessFragment(hash)).toEqual({ sessionId: SID, token: TOKEN });
    expect(parseStaffAccessFragment(hash.slice(1))).toEqual({ sessionId: SID, token: TOKEN });
  });

  it("fragmen rusak = null, bukan galat", () => {
    for (const bad of ["", "#", `#${SID}`, `#${SID}.`, `#.${TOKEN}`, `#usr_abcdefgh.${TOKEN}`, `#${SID}.${TOKEN}x`, `#${SID}.${TOKEN.slice(1)}`, `#${SID}.${TOKEN.replace("A", "+")}`]) {
      expect(parseStaffAccessFragment(bad)).toBeNull();
    }
  });

  it("validator id dan token", () => {
    expect(isStaffAccessSessionId(SID)).toBe(true);
    expect(isStaffAccessSessionId("sas_abc")).toBe(false);
    expect(isStaffAccessSessionId(42)).toBe(false);
    expect(isStaffAccessToken(TOKEN)).toBe(true);
    expect(isStaffAccessToken(TOKEN + "=")).toBe(false);
  });
});

describe("akses staf: alasan", () => {
  it("dirapikan, 3-200 karakter (dihitung per karakter, bukan per byte)", () => {
    expect(normalizeStaffAccessReason("  Express: isi data dari WA  ")).toBe("Express: isi data dari WA");
    expect(normalizeStaffAccessReason("ab")).toBeNull();
    expect(normalizeStaffAccessReason("   ab   ")).toBeNull();
    expect(normalizeStaffAccessReason("x".repeat(200))).toHaveLength(200);
    expect(normalizeStaffAccessReason("x".repeat(201))).toBeNull();
    expect(normalizeStaffAccessReason("🙂".repeat(200))).not.toBeNull();
    expect(normalizeStaffAccessReason(null)).toBeNull();
    expect(normalizeStaffAccessReason(123)).toBeNull();
  });
});

describe("akses staf: status sesi", () => {
  const base = {
    linkExpiresAt: "2026-10-01T03:05:00.000Z",
    expiresAt: "2026-10-01T04:00:00.000Z",
    openedAt: null as string | null,
    endedAt: null as string | null,
  };
  const at = (iso: string) => new Date(iso);

  it("belum dibuka: menunggu selama tautan berlaku, lalu tidak dipakai", () => {
    expect(staffAccessState(base, at("2026-10-01T03:04:59.000Z"))).toBe("waiting");
    expect(staffAccessState(base, at("2026-10-01T03:05:00.000Z"))).toBe("unused");
  });

  it("diakhiri sebelum dibuka = tidak dipakai", () => {
    expect(staffAccessState({ ...base, endedAt: "2026-10-01T03:01:00.000Z" }, at("2026-10-01T03:02:00.000Z"))).toBe("unused");
  });

  it("dibuka: aktif sampai expires_at, lalu habis waktu; diakhiri = diakhiri", () => {
    const opened = { ...base, openedAt: "2026-10-01T03:01:00.000Z" };
    expect(staffAccessState(opened, at("2026-10-01T03:59:59.000Z"))).toBe("active");
    expect(staffAccessState(opened, at("2026-10-01T04:00:00.000Z"))).toBe("expired");
    expect(staffAccessState({ ...opened, endedAt: "2026-10-01T03:30:00.000Z" }, at("2026-10-01T03:31:00.000Z"))).toBe("ended");
  });

  it("setiap status punya label", () => {
    expect(Object.keys(STAFF_ACCESS_STATE_LABEL).sort()).toEqual(["active", "ended", "expired", "unused", "waiting"]);
  });
});

describe("akses staf: bagian yang dilihat pemilik", () => {
  // Setiap rute tulis worker-user (2026-10-01) dipetakan ke satu bagian. Kalau rute baru
  // ditambahkan dan jatuh ke "lainnya", pemilik melihat "Lainnya": tambahkan pemetaannya.
  const cases: Array<[string, string]> = [
    ["/api/invitations/inv_x", "undangan"],
    ["/api/invitations/inv_x/publish", "terbit"],
    ["/api/invitations/inv_x/unpublish", "terbit"],
    ["/api/invitations/inv_x/persons", "mempelai"],
    ["/api/invitations/inv_x/persons/reorder", "mempelai"],
    ["/api/persons/per_x", "mempelai"],
    ["/api/persons/per_x/photo", "mempelai"],
    ["/api/invitations/inv_x/events", "acara"],
    ["/api/invitations/inv_x/events/reorder", "acara"],
    ["/api/events/evt_x", "acara"],
    ["/api/invitations/inv_x/gift-accounts", "rekening"],
    ["/api/gift-accounts/ga_x", "rekening"],
    ["/api/gift-accounts/ga_x/qr", "rekening"],
    ["/api/invitations/inv_x/guests", "tamu"],
    ["/api/invitations/inv_x/guests/bulk", "tamu"],
    ["/api/guests/gst_x", "tamu"],
    ["/api/guests/gst_x/regenerate-token", "tamu"],
    ["/api/invitations/inv_x/guest-imports", "tamu"],
    ["/api/guest-imports/imp_x/chunks", "tamu"],
    ["/api/guest-imports/imp_x/commit", "tamu"],
    ["/api/group-attendees/att_x", "tamu"],
    ["/api/guests/gst_x/checkin", "checkin"],
    ["/api/invitations/inv_x/checkin", "checkin"],
    ["/api/invitations/inv_x/checkin/group", "checkin"],
    ["/api/invitations/inv_x/attendees/att_x/checkin", "checkin"],
    ["/api/invitations/inv_x/test-mode", "checkin"],
    ["/api/invitations/inv_x/seating/tables", "meja"],
    ["/api/seating/tables/tbl_x", "meja"],
    ["/api/seating/tables/tbl_x/seats", "meja"],
    ["/api/seating/tables/tbl_x/seats/3", "meja"],
    ["/api/invitations/inv_x/resepsionis/pin", "resepsionis"],
    ["/api/invitations/inv_x/resepsionis/sessions", "resepsionis"],
    ["/api/invitations/inv_x/usher-token", "resepsionis"],
    ["/api/wishes/wsh_x", "interaksi"],
    ["/api/gifts/gft_x", "interaksi"],
    ["/api/invitations/inv_x/photos", "media"],
    ["/api/invitations/inv_x/photos/reorder", "media"],
    ["/api/photos/pho_x", "media"],
    ["/api/invitations/inv_x/music", "media"],
    ["/api/invitations/inv_x/sections/reorder", "bagian"],
    ["/api/sections/sec_x", "bagian"],
    ["/api/sections/sec_x/background", "bagian"],
    ["/api/invitations/inv_x/story-items", "cerita"],
    ["/api/story-items/sti_x/photo", "cerita"],
    ["/api/invitations/inv_x/domain", "domain"],
    ["/api/invitations/inv_x/addons/checkout", "addon"],
    ["/api/something-new", "lainnya"],
    ["/api/invitations/inv_x/something-new", "lainnya"],
  ];
  it.each(cases)("%s -> %s", (path, area) => {
    expect(staffAccessArea(path)).toBe(area);
  });

  it("query, fragmen, dan awalan /api tidak mengubah hasil", () => {
    expect(staffAccessArea("/api/invitations/inv_x/events?x=1")).toBe("acara");
    expect(staffAccessArea("/invitations/inv_x/events")).toBe("acara");
    expect(staffAccessArea("/api")).toBe("lainnya");
    expect(staffAccessArea("")).toBe("lainnya");
  });

  it("ringkasan: terbanyak dulu, seri menurut label, dengan label Indonesia", () => {
    const summary = summarizeStaffAccessAreas([
      "/api/guests/gst_1",
      "/api/events/evt_1",
      "/api/invitations/inv_x/guests",
      "/api/persons/per_1",
      "/api/guests/gst_2",
    ]);
    expect(summary).toEqual([
      { area: "tamu", label: "Tamu", count: 3 },
      { area: "acara", label: "Acara", count: 1 },
      { area: "mempelai", label: "Mempelai", count: 1 },
    ]);
    expect(summarizeStaffAccessAreas([])).toEqual([]);
  });

  it("setiap bagian punya label", () => {
    for (const [, area] of cases) expect(STAFF_ACCESS_AREA_LABEL[area as keyof typeof STAFF_ACCESS_AREA_LABEL]).toBeTruthy();
  });
});
