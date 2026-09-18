// Real implementation (BE-mono-13). `getDb(binding, app)` wraps a D1 binding in a Proxy
// intercepting `prepare`/`batch`/`exec` — the three ways D1 statements get executed — and
// runs every statement through `guard.ts`'s `guardWrite()` before it reaches the real
// binding. See project-docs/12-cross-repo-integration-design.md §5.4 for the intended
// consumer wiring (one `db(env)` composition root per repo).
//
// This package does not depend on `@cloudflare/workers-types` (kept dependency-free per
// doc 12 §5.4's "no secrets, minimal footprint" framing), so the D1 shapes below are a
// minimal structural subset of the real `D1Database`/`D1PreparedStatement` types. Every
// consumer's own generated Worker types are structurally compatible with these — no cast
// beyond the generic `TBinding` return type is needed at the call site.

import type { AppName } from "./ownership.js";
import { enforceViolation, type GuardMode, guardWrite } from "./guard.js";

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

/** Sentinel table name used by the guard when a batch() statement's SQL can't be recovered. */
const UNTRACKED_BATCH_STATEMENT_TABLE = "<untracked-batch-statement>";

/**
 * Wraps a real (or host-provided) function value so it always runs against `target`, never
 * against whatever `this` the caller invoked it through. Proxying a native/host object (D1's
 * real binding, backed by workerd internals) and returning its methods unbound risks an
 * "illegal invocation"-style failure if a caller ever does `const f = db.someMethod; f()` or
 * if the runtime relies on private internal slots only present on the real instance — this
 * keeps every passthrough method safe regardless of how it's later called.
 */
function bindToTarget<T extends object>(target: T, value: unknown): unknown {
  return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
}

function wrapPreparedStatement(
  real: D1PreparedStatementLike,
  sql: string,
  sqlByStatement: WeakMap<object, string>,
  realByStatement: WeakMap<object, D1PreparedStatementLike>,
): D1PreparedStatementLike {
  const proxy = new Proxy(real, {
    get(target, prop, _receiver) {
      if (prop === "bind") {
        return (...args: unknown[]) => {
          const bound = target.bind(...args);
          return wrapPreparedStatement(bound, sql, sqlByStatement, realByStatement);
        };
      }
      return bindToTarget(target, Reflect.get(target, prop, target));
    },
  }) as D1PreparedStatementLike;

  sqlByStatement.set(proxy, sql);
  realByStatement.set(proxy, real);
  return proxy;
}

/** Splits a multi-statement `exec()` query into the individual statements D1 executes. */
function splitExecStatements(query: string): string[] {
  return query
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Returns `binding` wrapped in a Proxy that guards every write statement against
 * `ownership.json` before it reaches D1. Reads pass through untouched. Intended to be the
 * only place a consuming repo's composition root names `env.DB` — construct Drizzle over
 * the returned handle (`drizzle(getDb(env.DB, "worker-landing"), { schema })`), not the raw
 * binding, so every statement Drizzle emits is checked.
 */
export function getDb<TBinding extends D1DatabaseLike>(
  binding: TBinding,
  app: AppName,
  opts: GetDbOptions = {},
): TBinding {
  const mode = opts.mode;
  const sqlByStatement = new WeakMap<object, string>();
  const realByStatement = new WeakMap<object, D1PreparedStatementLike>();

  return new Proxy(binding, {
    get(target, prop, _receiver) {
      if (prop === "prepare") {
        return (query: string): D1PreparedStatementLike => {
          guardWrite(query, app, { mode });
          const real = target.prepare(query);
          return wrapPreparedStatement(real, query, sqlByStatement, realByStatement);
        };
      }

      if (prop === "batch") {
        return (statements: D1PreparedStatementLike[]) => {
          const realStatements = statements.map((statement) => {
            const sql = sqlByStatement.get(statement);
            if (sql === undefined) {
              // Not created via this guarded prepare() — we cannot recover its SQL text to
              // classify it as a read or a write, so fail closed rather than let an
              // unchecked statement through batch(). Reported directly (not round-tripped
              // through guardWrite's regex parser, since there is no real SQL text here).
              enforceViolation(
                {
                  app,
                  table: UNTRACKED_BATCH_STATEMENT_TABLE,
                  statement: "<unavailable: statement not created via this guarded prepare()>",
                },
                mode,
              );
              return statement;
            }
            return realByStatement.get(statement) ?? statement;
          });
          return target.batch(realStatements);
        };
      }

      if (prop === "exec") {
        return (query: string) => {
          for (const statement of splitExecStatements(query)) {
            guardWrite(statement, app, { mode });
          }
          return target.exec(query);
        };
      }

      return bindToTarget(target, Reflect.get(target, prop, target));
    },
  }) as TBinding;
}
