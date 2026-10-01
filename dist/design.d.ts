export interface DesignTerms {
    version: string;
    title: string;
    /** Kalimat di samping kotak centang. */
    statement: string;
    points: readonly string[];
}
/** Versi yang berlaku sekarang. Server menolak centang dari versi lain. */
export declare const DESIGN_TERMS_VERSION = "desain-custom-v1";
export declare const DESIGN_TERMS: Readonly<Record<string, DesignTerms>>;
/** Janji layanan di deskripsi add-on. BUKAN bagian persetujuan, jadi mengubahnya tidak membuat versi baru. */
export declare const DESIGN_SERVICE: Readonly<{
    revisions: 2;
    workDays: 7;
    minLeadDays: 14;
}>;
export declare function getDesignTerms(version: string): DesignTerms | null;
/**
 * Teks kanonik sebuah versi: inilah yang disimpan di `design_consents.terms_text` dan di-hash. Judul, versi,
 * kalimat centang, lalu poin bernomor, dipisah baris baru. `null` untuk versi yang tidak dikenal.
 */
export declare function designTermsText(version: string): string | null;
/** SHA-256 hex huruf kecil dari teks UTF-8 (Web Crypto: ada di Workers, browser, dan Node 20). */
export declare function sha256Hex(text: string): Promise<string>;
/** sha256 teks kanonik sebuah versi, atau `null` untuk versi yang tidak dikenal. */
export declare function designTermsSha256(version: string): Promise<string | null>;
export declare const FIGMA_URL_MAX_LENGTH = 2048;
export type FigmaUrlCheck = {
    ok: true;
    value: string;
} | {
    ok: false;
    reason: string;
};
/** Link Figma yang diterima: https, figma.com, file desain/prototipe. Spasi di ujung dibuang; lainnya apa adanya. */
export declare function normalizeFigmaUrl(raw: unknown): FigmaUrlCheck;
export declare const DESIGN_REQUEST_STATUSES: readonly ["received", "in_progress", "done", "cancelled"];
export type DesignRequestStatus = (typeof DESIGN_REQUEST_STATUSES)[number];
export declare const DESIGN_REQUEST_STATUS_LABEL: Readonly<Record<DesignRequestStatus, string>>;
export declare function isDesignRequestStatus(value: unknown): value is DesignRequestStatus;
