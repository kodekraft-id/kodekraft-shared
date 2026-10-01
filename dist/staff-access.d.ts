/** Lama akses, dihitung sejak dibuat di panel admin (doc 27 ketentuan 6). */
export declare const STAFF_ACCESS_MINUTES = 60;
/** Tautan serah-terima harus ditukar dalam waktu ini, dan hanya sekali. */
export declare const STAFF_ACCESS_LINK_MINUTES = 5;
/** Alasan wajib (doc 27 ketentuan 5); CHECK yang sama ada di `0035_staff_access.sql`. */
export declare const STAFF_ACCESS_REASON_MIN = 3;
export declare const STAFF_ACCESS_REASON_MAX = 200;
/** Halaman dashboard yang menukar tautan. */
export declare const STAFF_ACCESS_PATH = "/akses-staf";
/** Klaim JWT worker-user yang menandai token mode staf; isinya id sesi. */
export declare const STAFF_ACCESS_CLAIM = "sas";
/** Siapa yang mengakhiri lebih awal: staf dari dashboard, atau staf mana pun dari panel admin. */
export declare const STAFF_ACCESS_ENDED_BY: readonly ["staff", "admin"];
export type StaffAccessEndedBy = (typeof STAFF_ACCESS_ENDED_BY)[number];
export declare function isStaffAccessSessionId(value: unknown): value is string;
export declare function isStaffAccessToken(value: unknown): value is string;
/**
 * Tautan yang dibuka staf: `<dashboard>/akses-staf#<id sesi>.<token>`. Token sengaja di fragmen: browser tidak
 * pernah mengirim fragmen ke server mana pun, jadi ia tidak masuk log dan tidak ikut Referer.
 */
export declare function staffAccessUrl(dashboardBaseUrl: string, sessionId: string, token: string): string;
/** Kebalikan `staffAccessUrl` untuk `location.hash` (dengan atau tanpa `#`). `null` bila bentuknya salah. */
export declare function parseStaffAccessFragment(hash: string): {
    sessionId: string;
    token: string;
} | null;
/** Alasan yang dirapikan (spasi di ujung dibuang), atau `null` bila panjangnya di luar 3–200 karakter. */
export declare function normalizeStaffAccessReason(value: unknown): string | null;
/** Batas waktu akses baru yang dibuat pada `now`, dalam ISO-8601 seperti kolom-kolomnya. */
export declare function staffAccessWindow(now: Date): {
    createdAt: string;
    linkExpiresAt: string;
    expiresAt: string;
};
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
export declare function staffAccessState(row: StaffAccessTimes, now: Date): StaffAccessState;
export declare const STAFF_ACCESS_STATE_LABEL: Readonly<Record<StaffAccessState, string>>;
/** Bagian dashboard yang disentuh sebuah perubahan; inilah yang dilihat pemilik, bukan alamat API-nya. */
export type StaffAccessArea = "undangan" | "terbit" | "mempelai" | "acara" | "rekening" | "tamu" | "checkin" | "meja" | "resepsionis" | "interaksi" | "media" | "bagian" | "cerita" | "domain" | "addon" | "lainnya";
export declare const STAFF_ACCESS_AREA_LABEL: Readonly<Record<StaffAccessArea, string>>;
/** Bagian untuk sebuah alamat API dashboard (`/api/...`, dengan atau tanpa `/api`, query diabaikan). */
export declare function staffAccessArea(path: string): StaffAccessArea;
export interface StaffAccessAreaCount {
    area: StaffAccessArea;
    label: string;
    count: number;
}
/** Ringkasan per bagian, terbanyak dulu (seri: urutan label). */
export declare function summarizeStaffAccessAreas(paths: readonly string[]): StaffAccessAreaCount[];
