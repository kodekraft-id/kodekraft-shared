// Custom-domain name rules for the `domain` add-on (doc 17 §13.0 FR-11) — BE-mono-32.
//
// ONE canonical implementation for the whole system. Before this module there were two:
// worker-landing's `src/lib/domain-name.ts` (checkout, the money path) and worker-user's
// `src/worker/shared/domain/domain-name.ts` (the customer dashboard). They are two doors
// to the SAME registration queue, so any disagreement between them is a real defect —
// and they disagreed twice:
//
//   1. Found 2026-09-20: worker-user had NEITHER the reserved-label list NOR the
//      3-character minimum, so a customer could register `www.my.id` or a 1-character
//      name from the dashboard that checkout would have refused. Patched by hand.
//   2. Found 2026-09-21 while writing this module: the hand-patch only aligned the list
//      and the minimum, NOT the algorithm. worker-landing strips a scheme, a leading
//      `www.` and any path/query/fragment before validating; worker-user split the name
//      into DNS labels and required exactly three. So `www.budi.my.id` was ACCEPTED by
//      checkout (normalised to `budi.my.id`) and REJECTED by the dashboard.
//
// The canonical behaviour here is worker-landing's, deliberately: it is the shipped money
// path, its own header calls this copy authoritative, and it is the more forgiving of the
// two — so adopting it can only make the dashboard accept MORE of what checkout already
// accepts, never less. That direction cannot create a "paid but unregisterable" name.
//
// SYNTACTIC ONLY — no network call, no availability check. Staff verify real availability
// at the registrar AFTER payment (OQ-15).
const DOMAIN_SUFFIX = ".my.id";
/** Shortest label Kodekraft will register. Real `.my.id` limits are UNVERIFIED (doc 17 FR-11.2) — conservative until a registrar confirms. */
export const MIN_LABEL_LENGTH = 3;
export const MAX_LABEL_LENGTH = 63;
const MAX_RAW_INPUT_LENGTH = 255;
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
// Kodekraft-reserved labels (doc 17 FR-11.2). Starter list — NOT exhaustive; `DOC-wl-06`
// tracks finalising it with Pram/staff before go-live.
const RESERVED_LABELS = new Set([
    "www", "admin", "administrator", "kodekraft", "api", "mail", "email",
    "ftp", "webmail", "smtp", "pop", "imap", "ns1", "ns2", "blog", "shop",
    "store", "support", "help", "root", "test", "staging", "dev", "app",
    "dashboard", "cpanel", "webdisk", "autodiscover", "autoconfig",
]);
/** Read-only view of the reserved list, for the storefront's client-side hint. */
export const RESERVED_LABEL_LIST = Object.freeze([...RESERVED_LABELS]);
function invalid(reason) {
    return { ok: false, value: null, reason };
}
/**
 * Lowercase/trim; strip scheme, `www.`, path/query/fragment and a trailing dot;
 * accept a bare `label` or `label.my.id`; reject any other suffix. Charset
 * `a-z0-9-`, no leading/trailing hyphen, no `--` at positions 3-4, length 3..63,
 * and reject Kodekraft-reserved labels. Pure and never throws.
 */
export function normalizeDomainName(raw) {
    if (typeof raw !== "string")
        return invalid("Nama domain wajib diisi");
    const trimmedRaw = raw.trim();
    if (trimmedRaw === "")
        return invalid("Nama domain wajib diisi");
    if (trimmedRaw.length > MAX_RAW_INPUT_LENGTH)
        return invalid("Nama domain terlalu panjang");
    let value = trimmedRaw
        .toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, "") // strip a leading scheme, e.g. https://
        .replace(/^www\./, ""); // strip a leading www.
    value = value.split(/[/?#]/, 1)[0]; // strip path/query/fragment
    value = value.replace(/\.+$/, ""); // strip trailing dot(s)
    let label;
    if (value.endsWith(DOMAIN_SUFFIX)) {
        label = value.slice(0, -DOMAIN_SUFFIX.length);
    }
    else if (value.includes(".")) {
        return invalid("Domain hanya mendukung akhiran .my.id");
    }
    else {
        label = value; // bare label -> "<label>.my.id"
    }
    if (label.length < MIN_LABEL_LENGTH || label.length > MAX_LABEL_LENGTH) {
        return invalid(`Nama domain harus ${MIN_LABEL_LENGTH}-${MAX_LABEL_LENGTH} karakter`);
    }
    if (!LABEL_PATTERN.test(label)) {
        return invalid("Nama domain hanya boleh huruf kecil, angka, dan tanda hubung (tidak di awal/akhir)");
    }
    if (label[2] === "-" && label[3] === "-") {
        return invalid("Nama domain tidak boleh memiliki tanda hubung ganda di posisi ke-3 dan ke-4");
    }
    if (RESERVED_LABELS.has(label)) {
        return invalid("Nama domain ini tidak dapat digunakan, silakan pilih nama lain");
    }
    return { ok: true, value: `${label}${DOMAIN_SUFFIX}`, reason: null };
}
