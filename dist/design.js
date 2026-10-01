// Add-on Desain Custom (doc 26, BE-mono-39): teks persetujuan jual ulang dan aturan link Figma.
//
// Teks persetujuan dipakai di empat tempat: storefront dan dashboard yang MENAMPILKANNYA, worker-landing yang
// MENYIMPANNYA sebagai bukti, dan worker-admin yang MEMERIKSA keutuhannya. Kalau keempatnya memegang salinan
// sendiri, bukti yang tersimpan bisa berbeda dari yang dilihat pembeli tanpa ada yang tahu. Jadi satu-satunya
// salinan ada di sini.
//
// SEBUAH VERSI TIDAK PERNAH DIEDIT. Mengubah satu kata = versi baru di DESIGN_TERMS, dengan versi lama tetap
// ada, karena baris bukti lama menunjuk ke versi lama dan halaman ketentuannya harus tetap bisa dibaca.
/** Versi yang berlaku sekarang. Server menolak centang dari versi lain. */
export const DESIGN_TERMS_VERSION = "desain-custom-v1";
export const DESIGN_TERMS = Object.freeze({
    "desain-custom-v1": Object.freeze({
        version: "desain-custom-v1",
        title: "Ketentuan Desain Custom",
        statement: "Saya menyetujui Ketentuan Desain Custom:",
        points: Object.freeze([
            "Desain di tautan Figma ini saya buat sendiri, atau saya sudah mendapat izin dari pembuatnya untuk memberikan izin di poin 2.",
            "Saya mengizinkan KodeKraft, tanpa batas waktu dan tanpa imbalan tambahan, memakai, mengubah, dan menjual ulang desain ini sebagai template undangan.",
            "Nama, foto, dan data pribadi saya tidak ikut dijual. Desain ini baru dijual setelah tanggal acara saya.",
            "KodeKraft boleh mengganti font, ilustrasi, atau foto berlisensi dengan yang setara.",
            "Jika ada pihak lain yang mengklaim hak atas desain ini, saya bertanggung jawab atas klaim tersebut.",
        ]),
    }),
});
/** Janji layanan di deskripsi add-on. BUKAN bagian persetujuan, jadi mengubahnya tidak membuat versi baru. */
export const DESIGN_SERVICE = Object.freeze({ revisions: 2, workDays: 7, minLeadDays: 14 });
export function getDesignTerms(version) {
    return Object.prototype.hasOwnProperty.call(DESIGN_TERMS, version) ? DESIGN_TERMS[version] : null;
}
/**
 * Teks kanonik sebuah versi: inilah yang disimpan di `design_consents.terms_text` dan di-hash. Judul, versi,
 * kalimat centang, lalu poin bernomor, dipisah baris baru. `null` untuk versi yang tidak dikenal.
 */
export function designTermsText(version) {
    const terms = getDesignTerms(version);
    if (!terms)
        return null;
    return [
        `${terms.title} (${terms.version})`,
        terms.statement,
        ...terms.points.map((point, i) => `${i + 1}. ${point}`),
    ].join("\n");
}
/** SHA-256 hex huruf kecil dari teks UTF-8 (Web Crypto: ada di Workers, browser, dan Node 20). */
export async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** sha256 teks kanonik sebuah versi, atau `null` untuk versi yang tidak dikenal. */
export async function designTermsSha256(version) {
    const text = designTermsText(version);
    return text === null ? null : sha256Hex(text);
}
export const FIGMA_URL_MAX_LENGTH = 2048;
// Hanya file desain milik sendiri: /design/, /file/ (nama lama), /proto/. Tautan komunitas (/community/…)
// ditolak: isinya karya orang lain dengan lisensinya sendiri, persis yang dijaga poin 1 persetujuan.
const FIGMA_URL = /^https:\/\/(?:www\.)?figma\.com\/(?:design|file|proto)\/[A-Za-z0-9]{10,64}(?:[/?#][^\s]*)?$/;
/** Link Figma yang diterima: https, figma.com, file desain/prototipe. Spasi di ujung dibuang; lainnya apa adanya. */
export function normalizeFigmaUrl(raw) {
    if (typeof raw !== "string" || raw.trim() === "")
        return { ok: false, reason: "Link Figma wajib diisi" };
    const value = raw.trim();
    if (value.length > FIGMA_URL_MAX_LENGTH)
        return { ok: false, reason: "Link Figma terlalu panjang" };
    if (/\/community\//i.test(value)) {
        return { ok: false, reason: "Link komunitas Figma tidak bisa dipakai. Kirim link file desainmu sendiri." };
    }
    if (!FIGMA_URL.test(value)) {
        return {
            ok: false,
            reason: "Link Figma tidak dikenali. Contoh: https://www.figma.com/design/AbCdEf1234567890/Undangan",
        };
    }
    return { ok: true, value };
}
export const DESIGN_REQUEST_STATUSES = ["received", "in_progress", "done", "cancelled"];
export const DESIGN_REQUEST_STATUS_LABEL = Object.freeze({
    received: "Masuk",
    in_progress: "Dikerjakan",
    done: "Selesai",
    cancelled: "Dibatalkan",
});
export function isDesignRequestStatus(value) {
    return typeof value === "string" && DESIGN_REQUEST_STATUSES.includes(value);
}
