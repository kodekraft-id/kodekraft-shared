// Tampilan khusus per undangan (doc 25, BE-mono-38): aturan yang SAMA untuk dua pintu.
//
//   - worker-admin memeriksa sebelum menyimpan, supaya staf langsung tahu kenapa CSS-nya ditolak;
//   - worker-undangan memeriksa lagi sebelum menyisipkan CSS ke halaman tamu, sebagai lapis kedua
//     kalau ada baris yang masuk D1 tanpa lewat panel admin.
//
// Dua salinan aturan yang berbeda di dua repo adalah cacat yang sudah dua kali terjadi di sistem ini
// (lihat domain-name.ts), jadi satu-satunya implementasi ada di sini.
/** Pilihan ukuran teks di panel admin, dalam persen. 100 = bawaan template (disimpan sebagai NULL). */
export const STAFF_TEXT_SCALES = [80, 85, 90, 95, 100, 105, 110, 115, 120];
/** Panjang maksimum CSS khusus, dalam karakter. */
export const STAFF_CSS_MAX_LENGTH = 20_000;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export function isStaffTextScale(value) {
    return typeof value === "number" && STAFF_TEXT_SCALES.includes(value);
}
/** Warna `#rrggbb`. Bentuk lain (nama warna, `rgb()`, `#rgb`) ditolak: nilainya masuk ke atribut `style`. */
export function isHexColor(value) {
    return typeof value === "string" && HEX_COLOR.test(value);
}
// Urutan berarti: alasan pertama yang cocok yang ditampilkan ke staf.
const FORBIDDEN = [
    // Satu-satunya jalan keluar dari elemen <style> adalah urutan `</style`. CSS tidak memerlukan `<`.
    { pattern: /</, reason: "Tanda < tidak boleh dipakai di CSS khusus." },
    // Escape CSS bisa menyamarkan kata yang dilarang di bawah (`u\72l(` dibaca `url(`).
    { pattern: /\\/, reason: "Garis miring terbalik (\\) tidak boleh dipakai. Tulis karakternya langsung." },
    { pattern: /@import\b/i, reason: "@import tidak boleh dipakai: CSS khusus tidak boleh memuat berkas dari luar." },
    {
        pattern: /\b(?:url|image|image-set|cross-fade|element|src)\s*\(/i,
        reason: "url(), image() dan sejenisnya tidak boleh dipakai: CSS khusus tidak boleh memuat berkas dari luar.",
    },
    { pattern: /\bexpression\s*\(|javascript\s*:|\bbehavior\s*:|-moz-binding/i, reason: "CSS khusus tidak boleh menjalankan kode." },
];
/**
 * Periksa CSS khusus staf. Spasi di awal/akhir dibuang; string kosong sah (berarti "tanpa CSS khusus").
 * Tidak mencoba mem-parse CSS: CSS yang tidak valid hanya diabaikan browser di dalam elemennya sendiri, dan
 * tidak bisa merusak CSS template karena berada di elemen `<style>` terpisah.
 */
export function checkStaffCss(raw) {
    const css = raw.trim();
    if (css.length > STAFF_CSS_MAX_LENGTH) {
        return { ok: false, reason: `CSS khusus terlalu panjang: ${css.length} karakter, maksimum ${STAFF_CSS_MAX_LENGTH}.` };
    }
    for (const rule of FORBIDDEN) {
        if (rule.pattern.test(css))
            return { ok: false, reason: rule.reason };
    }
    return { ok: true, css };
}
