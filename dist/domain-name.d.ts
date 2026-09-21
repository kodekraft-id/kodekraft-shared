/** Shortest label Kodekraft will register. Real `.my.id` limits are UNVERIFIED (doc 17 FR-11.2) — conservative until a registrar confirms. */
export declare const MIN_LABEL_LENGTH = 3;
export declare const MAX_LABEL_LENGTH = 63;
/** Read-only view of the reserved list, for the storefront's client-side hint. */
export declare const RESERVED_LABEL_LIST: readonly string[];
export interface DomainNameResult {
    ok: boolean;
    /** Normalized `<label>.my.id`, only set when `ok`. */
    value: string | null;
    /** Indonesian message for the customer, only set when `!ok`. */
    reason: string | null;
}
/**
 * Lowercase/trim; strip scheme, `www.`, path/query/fragment and a trailing dot;
 * accept a bare `label` or `label.my.id`; reject any other suffix. Charset
 * `a-z0-9-`, no leading/trailing hyphen, no `--` at positions 3-4, length 3..63,
 * and reject Kodekraft-reserved labels. Pure and never throws.
 */
export declare function normalizeDomainName(raw: string | null | undefined): DomainNameResult;
