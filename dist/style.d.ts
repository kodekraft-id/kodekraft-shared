/** Pilihan ukuran teks di panel admin, dalam persen. 100 = bawaan template (disimpan sebagai NULL). */
export declare const STAFF_TEXT_SCALES: readonly [80, 85, 90, 95, 100, 105, 110, 115, 120];
/** Panjang maksimum CSS khusus, dalam karakter. */
export declare const STAFF_CSS_MAX_LENGTH = 20000;
export declare function isStaffTextScale(value: unknown): value is number;
/** Warna `#rrggbb`. Bentuk lain (nama warna, `rgb()`, `#rgb`) ditolak: nilainya masuk ke atribut `style`. */
export declare function isHexColor(value: unknown): value is string;
export type StaffCssCheck = {
    ok: true;
    css: string;
} | {
    ok: false;
    reason: string;
};
/**
 * Periksa CSS khusus staf. Spasi di awal/akhir dibuang; string kosong sah (berarti "tanpa CSS khusus").
 * Tidak mencoba mem-parse CSS: CSS yang tidak valid hanya diabaikan browser di dalam elemennya sendiri, dan
 * tidak bisa merusak CSS template karena berada di elemen `<style>` terpisah.
 */
export declare function checkStaffCss(raw: string): StaffCssCheck;
