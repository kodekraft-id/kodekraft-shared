// Password sementara dari reset panel admin (doc 30, BE-mono-41).
//
// worker-admin MEMBUAT password ini dan worker-landing mengirimnya ke WhatsApp pelanggan; worker-user MENGENALINYA saat
// login (lalu meminta pelanggan membuat password sendiri) dan MENOLAKNYA saat pelanggan membuat password. Alfabet dan
// formatnya ada di sini supaya ketiga sisi tidak bisa berbeda pendapat tentang apa yang disebut password sementara.
//
// Kenapa dikenali dari FORMAT, bukan dari kolom penanda di `clients`: kolom baru berarti migrasi lockstep di keempat repo
// untuk satu bit informasi. Format ini tidak akan diketik pelanggan secara kebetulan (tiga kelompok empat karakter dari
// alfabet tanpa huruf mirip, dipisah strip), dan worker-user menolaknya saat pelanggan membuat password sendiri. Jadi
// "masuk dengan password berformat ini" sama artinya dengan "masuk dengan password dari reset admin".

/**
 * Huruf dan angka yang tidak mudah tertukar saat dibaca dari layar HP: tanpa `0`/`O`/`o` dan `1`/`l`/`I`. 56 karakter:
 * 24 huruf besar, 24 huruf kecil, 8 angka.
 */
export const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export const TEMP_PASSWORD_GROUPS = 3;
export const TEMP_PASSWORD_GROUP_LENGTH = 4;
export const TEMP_PASSWORD_SEPARATOR = "-";

/** Panjang total, termasuk strip: 3 × 4 + 2 = 14. */
export const TEMP_PASSWORD_LENGTH =
  TEMP_PASSWORD_GROUPS * TEMP_PASSWORD_GROUP_LENGTH + (TEMP_PASSWORD_GROUPS - 1) * TEMP_PASSWORD_SEPARATOR.length;

const GROUP = "[A-HJ-NP-Za-km-np-z2-9]{4}";

/** `Hq4m-P9xK-r7Tz`. Kelas karakternya persis TEMP_PASSWORD_ALPHABET (dikunci tes). */
export const TEMP_PASSWORD_PATTERN = new RegExp(`^${GROUP}-${GROUP}-${GROUP}$`);

/** Sumber byte acak. Bawaannya Web Crypto; tes boleh menyuntikkan urutan tetap. */
export type RandomBytes = (length: number) => Uint8Array;

const webCryptoRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

// Rejection sampling: 256 tidak habis dibagi 56, jadi byte >= 224 dibuang. Tanpa ini, `byte % 56` akan sedikit lebih
// sering memilih 32 karakter pertama.
const ACCEPT_BELOW = 256 - (256 % TEMP_PASSWORD_ALPHABET.length);

const CHARS = TEMP_PASSWORD_GROUPS * TEMP_PASSWORD_GROUP_LENGTH;
const MAX_ATTEMPTS = 64;

/**
 * Password sementara baru, ±70 bit acak (12 karakter × log2 56). Selalu memuat huruf besar, huruf kecil, dan angka,
 * dan strip menjadi simbolnya, jadi lolos aturan password dashboard (min. 8, huruf besar/kecil, angka, simbol).
 */
export function generateTemporaryPassword(random: RandomBytes = webCryptoRandom): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const chars: string[] = [];
    while (chars.length < CHARS) {
      const bytes = random(32);
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error("generateTemporaryPassword: sumber acak kosong");
      for (const byte of bytes) {
        if (byte >= ACCEPT_BELOW) continue;
        chars.push(TEMP_PASSWORD_ALPHABET[byte % TEMP_PASSWORD_ALPHABET.length]);
        if (chars.length === CHARS) break;
      }
    }
    const groups: string[] = [];
    for (let i = 0; i < CHARS; i += TEMP_PASSWORD_GROUP_LENGTH) groups.push(chars.slice(i, i + TEMP_PASSWORD_GROUP_LENGTH).join(""));
    const candidate = groups.join(TEMP_PASSWORD_SEPARATOR);
    if (/[A-Z]/.test(candidate) && /[a-z]/.test(candidate) && /[0-9]/.test(candidate)) return candidate;
  }
  throw new Error("generateTemporaryPassword: sumber acak tidak menghasilkan campuran huruf besar, huruf kecil, dan angka");
}

/** True bila `value` berformat password sementara. Tidak memangkas spasi: password diperiksa persis seperti diketik. */
export function isTemporaryPassword(value: unknown): boolean {
  return typeof value === "string" && TEMP_PASSWORD_PATTERN.test(value);
}
