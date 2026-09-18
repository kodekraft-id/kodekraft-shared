import { type AppName } from "./ownership.js";
/** `"warn"` logs violations and lets the statement proceed; `"throw"` blocks it. */
export type GuardMode = "warn" | "throw";
/** Structured shape logged for every violation, in both warn and throw mode. */
export interface OwnershipViolationDetails {
    readonly app: string;
    readonly table: string;
    readonly column?: string;
    readonly statement: string;
}
/**
 * Thrown (in `"throw"` mode) when a write statement targets a table this app is not a
 * declared writer of, or a column outside its `ownership.json` allowlist on that table —
 * or when a statement that is not a recognizable SELECT could not be parsed as a write
 * either (fail-closed).
 */
export declare class OwnershipViolationError extends Error {
    readonly app: string;
    readonly table: string;
    readonly column?: string;
    readonly statement: string;
    constructor(details: OwnershipViolationDetails);
}
type WriteVerb = "insert" | "update" | "delete";
interface WriteTarget {
    readonly verb: WriteVerb;
    readonly table: string;
    readonly columns: readonly string[];
}
type StatementClassification = {
    readonly kind: "read";
} | {
    readonly kind: "write";
    readonly target: WriteTarget;
} | {
    readonly kind: "unparseable";
};
/**
 * Classifies a raw SQL statement string as a read (SELECT — passes through untouched) or a
 * write (INSERT/UPDATE/DELETE — target table + written columns extracted), or as
 * `"unparseable"` when it is neither a recognized SELECT nor a recognized write shape.
 * Exported for unit testing in isolation from the ownership check.
 */
export declare function classifyStatement(sql: string): StatementClassification;
export interface GuardWriteOptions {
    readonly mode?: GuardMode;
}
/**
 * Applies `mode` to an already-determined violation: logs it in `"warn"` mode (statement
 * proceeds), throws `OwnershipViolationError` in `"throw"` mode (the default). Exported so
 * `client.ts` can report a violation it detected itself — e.g. a `batch()` statement whose
 * SQL text isn't recoverable — through the same single code path as `guardWrite()`, rather
 * than faking a SQL string just to round-trip it back through the regex parser.
 */
export declare function enforceViolation(details: OwnershipViolationDetails, mode?: GuardMode): void;
/**
 * Runs one raw SQL statement through the ownership guard. Reads (SELECT) always pass
 * through with no checks. Writes are checked against `ownership.json`; an unparseable
 * non-SELECT statement is treated as a violation too (fail-closed), carrying the sentinel
 * table name `"<unparseable-write>"`. In `"warn"` mode a violation is logged via
 * `console.error` and the statement is allowed to proceed; in `"throw"` mode (the default)
 * it throws `OwnershipViolationError` before the statement reaches the real D1 binding.
 */
export declare function guardWrite(statement: string, app: AppName, opts?: GuardWriteOptions): void;
export {};
