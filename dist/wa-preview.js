// Berkas gambar pratinjau link undangan di WhatsApp (landing doc 39, BE-mono-48).
//
// Sampul undangan disimpan besar (WebP, sisi pendek 2160 px, ±0,5–0,6 MB, biasanya potret) supaya tajam di layar HP.
// WhatsApp sering tidak menampilkan gambar pratinjau di atas ±300 KB, dan gambar potret jadi kotak kecil. Jadi tiap
// sampul punya berkas kedua: JPEG lebar 1200×630 di sebelahnya di R2.
//
// Tiga pihak harus sepakat soal berkas itu: dashboard worker-user yang MEMBUATNYA saat sampul di-upload, worker-undangan
// yang MENULIS tag `og:image` bila berkasnya ada, dan skrip backfill yang membuatnya untuk sampul lama. Kunci, ukuran,
// dan rumus potongannya ada di sini supaya ketiganya tidak bisa berbeda pendapat.
//
// Kenapa kunci diturunkan dari kunci sampul, bukan disimpan di kolom baru: kolom baru berarti migrasi lockstep di keempat
// repo. worker-undangan cukup mengecek keberadaan berkasnya di R2.
/** Ukuran berkas WA: rasio ±1.91:1, yang ditampilkan WhatsApp sebagai gambar besar di atas judul. */
export const WA_PREVIEW_WIDTH = 1200;
export const WA_PREVIEW_HEIGHT = 630;
export const WA_PREVIEW_CONTENT_TYPE = "image/jpeg";
/** Batas yang diterima worker-user. Di atas ini WhatsApp sering tidak menampilkan gambarnya. */
export const WA_PREVIEW_MAX_BYTES = 300 * 1024;
/** Target saat membuat berkas: kualitas diturunkan bertahap sampai hasilnya tidak lebih dari ini. */
export const WA_PREVIEW_TARGET_BYTES = 250 * 1024;
/** Urutan kualitas JPEG yang dicoba. Yang terakhir dipakai walau masih di atas target. */
export const WA_PREVIEW_QUALITIES = [0.8, 0.7, 0.6, 0.5];
/**
 * Titik tengah potongan secara tegak, sebagai bagian dari tinggi gambar (0 = atas, 1 = bawah). Untuk foto potret
 * yang dipotong jadi lebar, wajah biasanya di bagian atas, jadi potongannya digeser sedikit ke atas dari tengah.
 */
export const WA_PREVIEW_FOCUS_Y = 0.4;
/** Akhiran kunci berkas WA, menggantikan ekstensi kunci sampul. */
export const WA_PREVIEW_SUFFIX = ".wa.jpg";
// `inv/<id>/<folder>/<nama>.<ext>`: bentuk kunci media undangan (buildKey di worker-user). Hanya ekstensi terakhir
// yang diganti.
const COVER_KEY = /^(inv\/[^/]+\/.+)\.[A-Za-z0-9]+$/;
/**
 * Kunci berkas WA untuk satu kunci sampul: `inv/inv_x/section/<uuid>.webp` → `inv/inv_x/section/<uuid>.wa.jpg`.
 * `null` bila kuncinya kosong, bukan kunci media undangan, atau sudah berupa kunci berkas WA.
 */
export function waPreviewKey(coverKey) {
    if (!coverKey || coverKey.endsWith(WA_PREVIEW_SUFFIX))
        return null;
    const m = COVER_KEY.exec(coverKey);
    return m ? m[1] + WA_PREVIEW_SUFFIX : null;
}
/**
 * Potongan gambar sumber berukuran `width`×`height` yang, diperkecil (atau diperbesar) ke 1200×630, menutupi bidang
 * itu tanpa distorsi. Gambar yang lebih lebar dipotong kiri-kanannya sama banyak; yang lebih tinggi dipotong atas-bawah
 * dengan titik tengah WA_PREVIEW_FOCUS_Y, tanpa keluar dari gambar.
 */
export function waPreviewCrop(width, height) {
    if (!(width > 0) || !(height > 0))
        throw new RangeError(`Ukuran gambar tidak valid: ${width}×${height}`);
    const target = WA_PREVIEW_WIDTH / WA_PREVIEW_HEIGHT;
    if (width / height > target) {
        const sw = Math.max(1, Math.min(width, Math.round(height * target)));
        return { sx: Math.floor((width - sw) / 2), sy: 0, sw, sh: height };
    }
    const sh = Math.max(1, Math.min(height, Math.round(width / target)));
    const sy = Math.round(Math.min(Math.max(height * WA_PREVIEW_FOCUS_Y - sh / 2, 0), height - sh));
    return { sx: 0, sy, sw: width, sh };
}
