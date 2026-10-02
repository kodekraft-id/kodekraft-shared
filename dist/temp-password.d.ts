/**
 * Huruf dan angka yang tidak mudah tertukar saat dibaca dari layar HP: tanpa `0`/`O`/`o` dan `1`/`l`/`I`. 56 karakter:
 * 24 huruf besar, 24 huruf kecil, 8 angka.
 */
export declare const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export declare const TEMP_PASSWORD_GROUPS = 3;
export declare const TEMP_PASSWORD_GROUP_LENGTH = 4;
export declare const TEMP_PASSWORD_SEPARATOR = "-";
/** Panjang total, termasuk strip: 3 × 4 + 2 = 14. */
export declare const TEMP_PASSWORD_LENGTH: number;
/** `Hq4m-P9xK-r7Tz`. Kelas karakternya persis TEMP_PASSWORD_ALPHABET (dikunci tes). */
export declare const TEMP_PASSWORD_PATTERN: RegExp;
/** Sumber byte acak. Bawaannya Web Crypto; tes boleh menyuntikkan urutan tetap. */
export type RandomBytes = (length: number) => Uint8Array;
/**
 * Password sementara baru, ±70 bit acak (12 karakter × log2 56). Selalu memuat huruf besar, huruf kecil, dan angka,
 * dan strip menjadi simbolnya, jadi lolos aturan password dashboard (min. 8, huruf besar/kecil, angka, simbol).
 */
export declare function generateTemporaryPassword(random?: RandomBytes): string;
/** True bila `value` berformat password sementara. Tidak memangkas spasi: password diperiksa persis seperti diketik. */
export declare function isTemporaryPassword(value: unknown): boolean;
