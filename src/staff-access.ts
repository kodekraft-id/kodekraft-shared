// Akses staf sementara ke dashboard pemilik (doc 27, BE-mono-40).
//
// worker-admin MEMBUAT akses dan tautan serah-terimanya; worker-user MENUKAR tautan itu, menjaga mode staf, dan
// mencatat perubahan; keduanya menampilkan riwayat. Bentuk tautan, batas waktu, status sesi, dan nama bagian yang
// dilihat pemilik ada di sini, supaya panel admin dan dashboard tidak bisa berbeda pendapat tentang semua itu.

/** Lama akses, dihitung sejak dibuat di panel admin (doc 27 ketentuan 6). */
export const STAFF_ACCESS_MINUTES = 60;

/** Tautan serah-terima harus ditukar dalam waktu ini, dan hanya sekali. */
export const STAFF_ACCESS_LINK_MINUTES = 5;

/** Alasan wajib (doc 27 ketentuan 5); CHECK yang sama ada di `0035_staff_access.sql`. */
export const STAFF_ACCESS_REASON_MIN = 3;
export const STAFF_ACCESS_REASON_MAX = 200;

/** Halaman dashboard yang menukar tautan. */
export const STAFF_ACCESS_PATH = "/akses-staf";

/** Klaim JWT worker-user yang menandai token mode staf; isinya id sesi. */
export const STAFF_ACCESS_CLAIM = "sas";

/** Siapa yang mengakhiri lebih awal: staf dari dashboard, atau staf mana pun dari panel admin. */
export const STAFF_ACCESS_ENDED_BY = ["staff", "admin"] as const;
export type StaffAccessEndedBy = (typeof STAFF_ACCESS_ENDED_BY)[number];

const SESSION_ID_RE = /^sas_[A-Za-z0-9]{6,40}$/;
/** 32 byte acak dalam base64url tanpa padding. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isStaffAccessSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_RE.test(value);
}

export function isStaffAccessToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

/**
 * Tautan yang dibuka staf: `<dashboard>/akses-staf#<id sesi>.<token>`. Token sengaja di fragmen: browser tidak
 * pernah mengirim fragmen ke server mana pun, jadi ia tidak masuk log dan tidak ikut Referer.
 */
export function staffAccessUrl(dashboardBaseUrl: string, sessionId: string, token: string): string {
  if (!isStaffAccessSessionId(sessionId)) throw new Error("staffAccessUrl: id sesi tidak sah");
  if (!isStaffAccessToken(token)) throw new Error("staffAccessUrl: token tidak sah");
  return `${dashboardBaseUrl.replace(/\/+$/, "")}${STAFF_ACCESS_PATH}#${sessionId}.${token}`;
}

/** Kebalikan `staffAccessUrl` untuk `location.hash` (dengan atau tanpa `#`). `null` bila bentuknya salah. */
export function parseStaffAccessFragment(hash: string): { sessionId: string; token: string } | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const dot = raw.indexOf(".");
  if (dot < 0) return null;
  const sessionId = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  return isStaffAccessSessionId(sessionId) && isStaffAccessToken(token) ? { sessionId, token } : null;
}

/** Alasan yang dirapikan (spasi di ujung dibuang), atau `null` bila panjangnya di luar 3–200 karakter. */
export function normalizeStaffAccessReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  const length = [...reason].length;
  return length >= STAFF_ACCESS_REASON_MIN && length <= STAFF_ACCESS_REASON_MAX ? reason : null;
}

/** Batas waktu akses baru yang dibuat pada `now`, dalam ISO-8601 seperti kolom-kolomnya. */
export function staffAccessWindow(now: Date): { createdAt: string; linkExpiresAt: string; expiresAt: string } {
  const t = now.getTime();
  return {
    createdAt: new Date(t).toISOString(),
    linkExpiresAt: new Date(t + STAFF_ACCESS_LINK_MINUTES * 60_000).toISOString(),
    expiresAt: new Date(t + STAFF_ACCESS_MINUTES * 60_000).toISOString(),
  };
}

/**
 * Status sesi, dihitung dan tidak disimpan:
 *   waiting  belum dibuka, tautan masih berlaku
 *   unused   tidak pernah dibuka (tautan lewat, atau diakhiri sebelum dibuka)
 *   active   dibuka, belum diakhiri, belum lewat waktu: HANYA status ini yang boleh dipakai bekerja
 *   ended    dibuka lalu diakhiri lebih awal
 *   expired  dibuka lalu habis waktu
 */
export type StaffAccessState = "waiting" | "unused" | "active" | "ended" | "expired";

export interface StaffAccessTimes {
  linkExpiresAt: string;
  expiresAt: string;
  openedAt: string | null;
  endedAt: string | null;
}

export function staffAccessState(row: StaffAccessTimes, now: Date): StaffAccessState {
  const t = now.getTime();
  if (row.openedAt === null) {
    if (row.endedAt !== null) return "unused";
    return t < Date.parse(row.linkExpiresAt) ? "waiting" : "unused";
  }
  if (row.endedAt !== null) return "ended";
  return t < Date.parse(row.expiresAt) ? "active" : "expired";
}

export const STAFF_ACCESS_STATE_LABEL: Readonly<Record<StaffAccessState, string>> = Object.freeze({
  waiting: "Menunggu dibuka",
  unused: "Tidak dipakai",
  active: "Aktif",
  ended: "Diakhiri",
  expired: "Habis waktu",
});

/** Bagian dashboard yang disentuh sebuah perubahan; inilah yang dilihat pemilik, bukan alamat API-nya. */
export type StaffAccessArea =
  | "undangan"
  | "terbit"
  | "mempelai"
  | "acara"
  | "rekening"
  | "tamu"
  | "checkin"
  | "meja"
  | "resepsionis"
  | "interaksi"
  | "media"
  | "bagian"
  | "cerita"
  | "domain"
  | "addon"
  | "lainnya";

export const STAFF_ACCESS_AREA_LABEL: Readonly<Record<StaffAccessArea, string>> = Object.freeze({
  undangan: "Info undangan",
  terbit: "Terbit",
  mempelai: "Mempelai",
  acara: "Acara",
  rekening: "Rekening hadiah",
  tamu: "Tamu",
  checkin: "Check-in",
  meja: "Seating Plan",
  resepsionis: "Resepsionis",
  interaksi: "Ucapan & hadiah",
  media: "Foto & musik",
  bagian: "Bagian undangan",
  cerita: "Cerita",
  domain: "Domain",
  addon: "Add-on",
  lainnya: "Lainnya",
});

const INVITATION_SUBRESOURCE: Readonly<Record<string, StaffAccessArea>> = Object.freeze({
  publish: "terbit",
  unpublish: "terbit",
  persons: "mempelai",
  events: "acara",
  "gift-accounts": "rekening",
  guests: "tamu",
  "guest-imports": "tamu",
  checkin: "checkin",
  attendees: "checkin",
  "test-mode": "checkin",
  seating: "meja",
  resepsionis: "resepsionis",
  "usher-token": "resepsionis",
  photos: "media",
  music: "media",
  sections: "bagian",
  "story-items": "cerita",
  domain: "domain",
  addons: "addon",
});

const TOP_LEVEL: Readonly<Record<string, StaffAccessArea>> = Object.freeze({
  persons: "mempelai",
  events: "acara",
  "gift-accounts": "rekening",
  guests: "tamu",
  "guest-imports": "tamu",
  "group-attendees": "tamu",
  seating: "meja",
  wishes: "interaksi",
  gifts: "interaksi",
  photos: "media",
  sections: "bagian",
  "story-items": "cerita",
});

/** Bagian untuk sebuah alamat API dashboard (`/api/...`, dengan atau tanpa `/api`, query diabaikan). */
export function staffAccessArea(path: string): StaffAccessArea {
  const clean = path.split("?")[0].split("#")[0];
  const segments = clean.replace(/^\/api(?=\/|$)/, "").split("/").filter(Boolean);
  const [head, , sub] = segments;
  if (head === "invitations") {
    if (segments.length <= 2) return "undangan";
    return INVITATION_SUBRESOURCE[sub] ?? "lainnya";
  }
  if (head === "guests" && sub === "checkin") return "checkin";
  return (head !== undefined && TOP_LEVEL[head]) || "lainnya";
}

export interface StaffAccessAreaCount {
  area: StaffAccessArea;
  label: string;
  count: number;
}

/** Ringkasan per bagian, terbanyak dulu (seri: urutan label). */
export function summarizeStaffAccessAreas(paths: readonly string[]): StaffAccessAreaCount[] {
  const counts = new Map<StaffAccessArea, number>();
  for (const path of paths) {
    const area = staffAccessArea(path);
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([area, count]) => ({ area, label: STAFF_ACCESS_AREA_LABEL[area], count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "id"));
}
