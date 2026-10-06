// Penundaan tebakan password per (akun, IP) untuk login dashboard pelanggan (worker-user) dan login panel admin
// (worker-admin): doc 33 §5.3, jawaban Pram 6 Okt 2026 ("tanpa Turnstile; perlambat tebakan password").
//
// Kebijakannya ada di sini supaya kedua Worker tidak bisa berbeda pendapat. Ia murni: tanpa D1, tanpa HttpError, tanpa
// jaringan. Penyimpanannya (tabel `login_failures`, migrasi 0037) dan penolakan 429 ditulis tiap Worker di repo masing-masing.
//
// Aturan:
//   • Yang dihitung: password SALAH pada satu akun dari satu IP, dalam jendela LOGIN_FAILURE_WINDOW_MINUTES (15 menit),
//     sejak login sukses terakhir (Worker menghapus baris akun+IP itu saat login sukses).
//   • 5 sampai 9 salah: percobaan berikutnya dari IP itu pada akun itu ditunda 30 detik sejak kegagalan TERAKHIR.
//   • 10 atau lebih salah: ditunda 5 menit sejak kegagalan terakhir.
//   • Percobaan yang ditunda TIDAK dicatat (hitungan tidak naik selama menunggu) dan TIDAK memakan CPU hash password.
//   • Pemilik yang masuk dari IP lain tidak terhambat: kuncinya akun + IP, bukan akun saja.

import { parseTimestampMs } from "./tier.js";

/** Jendela hitung kegagalan dan umur baris di `login_failures`. Baris yang lebih tua dibuang saat kegagalan berikutnya dicatat. */
export const LOGIN_FAILURE_WINDOW_MINUTES = 15;

/** Ambang dari yang terbesar: kegagalan >= `failures` menunda `delaySeconds` sejak kegagalan terakhir. */
export const LOGIN_DELAY_TIERS: ReadonlyArray<Readonly<{ failures: number; delaySeconds: number }>> = Object.freeze([
  Object.freeze({ failures: 10, delaySeconds: 300 }),
  Object.freeze({ failures: 5, delaySeconds: 30 }),
]);

/** Siapa yang masuk: pelanggan di dashboard (`client`, worker-user) atau admin di panel (`admin`, worker-admin). */
export type LoginScope = "client" | "admin";

/**
 * Berapa detik penundaan untuk jumlah kegagalan ini (0 bila belum sampai ambang). Angka bukan bilangan bulat positif
 * dianggap 0 kegagalan.
 */
export function loginDelaySeconds(failures: number): number {
  if (typeof failures !== "number" || !Number.isFinite(failures) || failures < 1) return 0;
  for (const tier of LOGIN_DELAY_TIERS) {
    if (failures >= tier.failures) return tier.delaySeconds;
  }
  return 0;
}

/**
 * Sisa detik sebelum percobaan berikutnya diizinkan, dibulatkan ke atas; 0 bila boleh mencoba sekarang. `lastFailedAt`
 * yang kosong atau tak terbaca berarti tidak ada penundaan (jangan mengunci pemilik karena data rusak).
 */
export function loginRetryAfterSeconds(
  state: { failures: number; lastFailedAt: string | Date | null | undefined },
  now: Date = new Date(),
): number {
  const delay = loginDelaySeconds(state.failures);
  if (delay === 0) return 0;
  const lastMs = parseTimestampMs(state.lastFailedAt ?? null);
  if (lastMs === null) return 0;
  const remainingMs = lastMs + delay * 1000 - now.getTime();
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

/**
 * Bahan yang di-hash menjadi kunci akun atau kunci IP di `login_failures` (SHA-256 heksa, dibuat tiap Worker dengan
 * helper hash miliknya). Email dinormalkan ke huruf kecil tanpa spasi di ujung, supaya `Budi@x.id` dan `budi@x.id`
 * tidak menjadi dua akun; scope ikut di dalamnya supaya akun pelanggan dan akun admin yang kebetulan beremail sama
 * tidak berbagi hitungan. Tanpa pepper: tabelnya tidak pernah keluar dari D1, dan hash IP/email di sini hanya menjaga
 * supaya cadangan atau log tidak memuat alamat mentah.
 */
export function loginKeyMaterial(scope: LoginScope, kind: "account" | "ip", value: string): string {
  return `${scope}|${kind}|${String(value).trim().toLowerCase()}`;
}

/** Pesan 429 untuk pengguna; `seconds` dibulatkan ke atas dan minimal 1. */
export function loginThrottleMessage(seconds: number): string {
  const wait = Math.max(1, Math.ceil(Number.isFinite(seconds) ? seconds : 1));
  return wait >= 120
    ? `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(wait / 60)} menit.`
    : `Terlalu banyak percobaan. Coba lagi dalam ${wait} detik.`;
}
