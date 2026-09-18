import type { AppName } from "./ownership.js";
import { type GuardMode } from "./guard.js";
export { OwnershipViolationError } from "./guard.js";
export type { GuardMode } from "./guard.js";
/**
 * Minimal structural subset of Cloudflare's `D1PreparedStatement`. Not generic over a row
 * type — real D1's `run<T>()`/`all<T>()`/`raw<T>()` generics are a caller-side type hint
 * with no runtime effect, and a non-generic `unknown`-returning shape here is still
 * structurally assignable from (and to) the real, generic-typed methods.
 */
export interface D1PreparedStatementLike {
    bind(...values: unknown[]): D1PreparedStatementLike;
    first(colName?: string): Promise<unknown>;
    run(): Promise<unknown>;
    all(): Promise<unknown>;
    raw(): Promise<unknown[]>;
}
/** Minimal structural subset of Cloudflare's `D1Database`. */
export interface D1DatabaseLike {
    prepare(query: string): D1PreparedStatementLike;
    batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
    exec(query: string): Promise<unknown>;
}
export interface GetDbOptions {
    /** `"throw"` (default) blocks violating statements; `"warn"` logs and lets them proceed. */
    readonly mode?: GuardMode;
}
/**
 * Returns `binding` wrapped in a Proxy that guards every write statement against
 * `ownership.json` before it reaches D1. Reads pass through untouched. Intended to be the
 * only place a consuming repo's composition root names `env.DB` — construct Drizzle over
 * the returned handle (`drizzle(getDb(env.DB, "worker-landing"), { schema })`), not the raw
 * binding, so every statement Drizzle emits is checked.
 */
export declare function getDb<TBinding extends D1DatabaseLike>(binding: TBinding, app: AppName, opts?: GetDbOptions): TBinding;
