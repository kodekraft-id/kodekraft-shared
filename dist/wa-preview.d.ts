/** Ukuran berkas WA: rasio ±1.91:1, yang ditampilkan WhatsApp sebagai gambar besar di atas judul. */
export declare const WA_PREVIEW_WIDTH = 1200;
export declare const WA_PREVIEW_HEIGHT = 630;
export declare const WA_PREVIEW_CONTENT_TYPE = "image/jpeg";
/** Batas yang diterima worker-user. Di atas ini WhatsApp sering tidak menampilkan gambarnya. */
export declare const WA_PREVIEW_MAX_BYTES: number;
/** Target saat membuat berkas: kualitas diturunkan bertahap sampai hasilnya tidak lebih dari ini. */
export declare const WA_PREVIEW_TARGET_BYTES: number;
/** Urutan kualitas JPEG yang dicoba. Yang terakhir dipakai walau masih di atas target. */
export declare const WA_PREVIEW_QUALITIES: readonly number[];
/**
 * Titik tengah potongan secara tegak, sebagai bagian dari tinggi gambar (0 = atas, 1 = bawah). Untuk foto potret
 * yang dipotong jadi lebar, wajah biasanya di bagian atas, jadi potongannya digeser sedikit ke atas dari tengah.
 */
export declare const WA_PREVIEW_FOCUS_Y = 0.4;
/** Akhiran kunci berkas WA, menggantikan ekstensi kunci sampul. */
export declare const WA_PREVIEW_SUFFIX = ".wa.jpg";
/**
 * Kunci berkas WA untuk satu kunci sampul: `inv/inv_x/section/<uuid>.webp` → `inv/inv_x/section/<uuid>.wa.jpg`.
 * `null` bila kuncinya kosong, bukan kunci media undangan, atau sudah berupa kunci berkas WA.
 */
export declare function waPreviewKey(coverKey: string | null | undefined): string | null;
/** Bagian gambar sumber yang dipakai, dalam piksel sumber. */
export interface WaPreviewCrop {
    sx: number;
    sy: number;
    sw: number;
    sh: number;
}
/**
 * Potongan gambar sumber berukuran `width`×`height` yang, diperkecil (atau diperbesar) ke 1200×630, menutupi bidang
 * itu tanpa distorsi. Gambar yang lebih lebar dipotong kiri-kanannya sama banyak; yang lebih tinggi dipotong atas-bawah
 * dengan titik tengah WA_PREVIEW_FOCUS_Y, tanpa keluar dari gambar.
 */
export declare function waPreviewCrop(width: number, height: number): WaPreviewCrop;
