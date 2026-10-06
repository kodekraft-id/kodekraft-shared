/** Jendela hitung kegagalan dan umur baris di `login_failures`. Baris yang lebih tua dibuang saat kegagalan berikutnya dicatat. */
export declare const LOGIN_FAILURE_WINDOW_MINUTES = 15;
/** Ambang dari yang terbesar: kegagalan >= `failures` menunda `delaySeconds` sejak kegagalan terakhir. */
export declare const LOGIN_DELAY_TIERS: ReadonlyArray<Readonly<{
    failures: number;
    delaySeconds: number;
}>>;
/** Siapa yang masuk: pelanggan di dashboard (`client`, worker-user) atau admin di panel (`admin`, worker-admin). */
export type LoginScope = "client" | "admin";
/**
 * Berapa detik penundaan untuk jumlah kegagalan ini (0 bila belum sampai ambang). Angka bukan bilangan bulat positif
 * dianggap 0 kegagalan.
 */
export declare function loginDelaySeconds(failures: number): number;
/**
 * Sisa detik sebelum percobaan berikutnya diizinkan, dibulatkan ke atas; 0 bila boleh mencoba sekarang. `lastFailedAt`
 * yang kosong atau tak terbaca berarti tidak ada penundaan (jangan mengunci pemilik karena data rusak).
 */
export declare function loginRetryAfterSeconds(state: {
    failures: number;
    lastFailedAt: string | Date | null | undefined;
}, now?: Date): number;
/**
 * Bahan yang di-hash menjadi kunci akun atau kunci IP di `login_failures` (SHA-256 heksa, dibuat tiap Worker dengan
 * helper hash miliknya). Email dinormalkan ke huruf kecil tanpa spasi di ujung, supaya `Budi@x.id` dan `budi@x.id`
 * tidak menjadi dua akun; scope ikut di dalamnya supaya akun pelanggan dan akun admin yang kebetulan beremail sama
 * tidak berbagi hitungan. Tanpa pepper: tabelnya tidak pernah keluar dari D1, dan hash IP/email di sini hanya menjaga
 * supaya cadangan atau log tidak memuat alamat mentah.
 */
export declare function loginKeyMaterial(scope: LoginScope, kind: "account" | "ip", value: string): string;
/** Pesan 429 untuk pengguna; `seconds` dibulatkan ke atas dan minimal 1. */
export declare function loginThrottleMessage(seconds: number): string;
