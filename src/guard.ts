// Real implementation (BE-mono-13). The core enforcement logic behind `client.ts`'s
// `getDb()` Proxy: classify a raw SQL statement string as a read or a write, and for
// writes, check the target table (and, where the app's `writableColumns` entry is not
// `"*"`, the columns it SETs) against `ownership.json` via `ownership.ts`'s helpers.
//
// This module is intentionally NOT part of the package's exports map (see doc 12 §5.4) —
// it is consumed internally by `client.ts` only.
//
// Parsing approach: pragmatic regex over Drizzle/D1-generated SQL, not a general SQL
// parser. Confirmed against drizzle-orm's sqlite-core dialect (v0.44, the version pinned
// by the sibling app repos): identifiers are always double-quoted (`escapeName` returns
// `"${name}"`), and INSERT/UPDATE/DELETE statements always start with their verb — no
// leading whitespace-only surprises, no vendor-specific `INSERT OR REPLACE` in this
// codebase's usage. `WITH …` (CTE-prefixed) statements are deliberately NOT parsed as a
// distinct case — they fail closed via the `unparseable` branch below. See the shape notes
// in this file's exported functions for the exact patterns matched.
//
// Explicitly out of scope (decided 2026-09-17, architecture §1 "Creator-only columns"):
// no verb-scoped or per-column special cases (e.g. "worker-landing may write
// invitations.package_tier only in an INSERT"). This guard checks table + column against
// the static ownership.json matrix and nothing more; anything runtime/temporal belongs to
// the consuming repo's own service layer (worker-landing's BE-wl-10), not here.

import { type AppName, writableColumns, writersOf } from "./ownership.js";

/** `"warn"` logs violations and lets the statement proceed; `"throw"` blocks it. */
export type GuardMode = "warn" | "throw";

const DEFAULT_GUARD_MODE: GuardMode = "throw";

/** Sentinel table name used when a write statement could not be parsed at all. */
const UNPARSEABLE_WRITE_TABLE = "<unparseable-write>";

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
export class OwnershipViolationError extends Error {
  readonly app: string;
  readonly table: string;
  readonly column?: string;
  readonly statement: string;

  constructor(details: OwnershipViolationDetails) {
    super(describeViolation(details));
    this.name = "OwnershipViolationError";
    this.app = details.app;
    this.table = details.table;
    this.column = details.column;
    this.statement = details.statement;
  }
}

function describeViolation(details: OwnershipViolationDetails): string {
  if (details.table === UNPARSEABLE_WRITE_TABLE) {
    return `App "${details.app}" issued a write statement that could not be parsed as a recognized INSERT/UPDATE/DELETE — failing closed`;
  }
  if (details.column) {
    return `App "${details.app}" is not allowed to write column "${details.column}" of table "${details.table}"`;
  }
  return `App "${details.app}" is not allowed to write table "${details.table}"`;
}

type WriteVerb = "insert" | "update" | "delete";

interface WriteTarget {
  readonly verb: WriteVerb;
  readonly table: string;
  readonly columns: readonly string[];
}

type StatementClassification =
  | { readonly kind: "read" }
  | { readonly kind: "write"; readonly target: WriteTarget }
  | { readonly kind: "unparseable" };

// A double-quoted, backtick-quoted, bracket-quoted, or bare SQLite identifier. Drizzle's
// sqlite-core dialect always emits double-quoted identifiers (`escapeName`); the other
// forms are accepted defensively for any hand-written SQL that might flow through here.
const IDENTIFIER_SOURCE = `(?:"([^"]+)"|\`([^\`]+)\`|\\[([^\\]]+)\\]|([A-Za-z_]\\w*))`;

const SELECT_PATTERN = /^\s*select\b/i;
const INSERT_PATTERN = new RegExp(`^\\s*insert\\s+into\\s+${IDENTIFIER_SOURCE}\\s*\\(([^)]*)\\)`, "i");
const UPDATE_PATTERN = new RegExp(
  `^\\s*update\\s+${IDENTIFIER_SOURCE}\\s+set\\s+([\\s\\S]*?)(?:\\swhere\\b|\\sreturning\\b|$)`,
  "i",
);
const DELETE_PATTERN = new RegExp(`^\\s*delete\\s+from\\s+${IDENTIFIER_SOURCE}`, "i");

// `INSERT … ON CONFLICT DO UPDATE SET …` also writes the columns in its SET clause — those
// are unioned into the write target's columns. Per the architecture note above, this is
// still a plain table+column check, not a verb-scoped rule: an app allowed to write a
// column via INSERT is checked the same way whether it arrives via the INSERT's own column
// list or an ON CONFLICT upsert clause.
const ON_CONFLICT_UPDATE_PATTERN = new RegExp(
  `on\\s+conflict[\\s\\S]*?do\\s+update\\s+set\\s+([\\s\\S]*?)(?:\\swhere\\b|\\sreturning\\b|$)`,
  "i",
);

const SET_COLUMN_PATTERN = new RegExp(`(?:^|,)\\s*${IDENTIFIER_SOURCE}\\s*=`, "gi");
const BARE_IDENTIFIER_PATTERN = new RegExp(`^${IDENTIFIER_SOURCE}$`, "i");

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined);
}

function identifierFromMatch(match: RegExpMatchArray, groupOffset: number): string | undefined {
  return firstDefined(
    match[groupOffset],
    match[groupOffset + 1],
    match[groupOffset + 2],
    match[groupOffset + 3],
  );
}

function stripIdentifierQuotes(raw: string): string {
  const match = raw.match(BARE_IDENTIFIER_PATTERN);
  if (!match) return raw;
  return identifierFromMatch(match, 1) ?? raw;
}

/** Parses a `("id", "name", "email")`-style INSERT column list into bare column names. */
function parseInsertColumnList(rawColumnList: string): string[] {
  return rawColumnList
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(stripIdentifierQuotes);
}

/** Parses a `"col1" = ?, "col2" = ?`-style SET clause into the bare column names it sets. */
function parseSetClauseColumns(setClause: string): string[] {
  const columns: string[] = [];
  for (const match of setClause.matchAll(SET_COLUMN_PATTERN)) {
    const column = identifierFromMatch(match, 1);
    if (column) columns.push(column);
  }
  return columns;
}

/**
 * Classifies a raw SQL statement string as a read (SELECT — passes through untouched) or a
 * write (INSERT/UPDATE/DELETE — target table + written columns extracted), or as
 * `"unparseable"` when it is neither a recognized SELECT nor a recognized write shape.
 * Exported for unit testing in isolation from the ownership check.
 */
export function classifyStatement(sql: string): StatementClassification {
  if (SELECT_PATTERN.test(sql)) {
    return { kind: "read" };
  }

  const insertMatch = sql.match(INSERT_PATTERN);
  if (insertMatch) {
    const table = identifierFromMatch(insertMatch, 1);
    if (!table) return { kind: "unparseable" };
    const insertColumns = parseInsertColumnList(insertMatch[5] ?? "");
    const onConflictMatch = sql.match(ON_CONFLICT_UPDATE_PATTERN);
    const upsertColumns = onConflictMatch ? parseSetClauseColumns(onConflictMatch[1] ?? "") : [];
    return {
      kind: "write",
      target: { verb: "insert", table, columns: [...new Set([...insertColumns, ...upsertColumns])] },
    };
  }

  const updateMatch = sql.match(UPDATE_PATTERN);
  if (updateMatch) {
    const table = identifierFromMatch(updateMatch, 1);
    if (!table) return { kind: "unparseable" };
    const columns = parseSetClauseColumns(updateMatch[5] ?? "");
    return { kind: "write", target: { verb: "update", table, columns } };
  }

  const deleteMatch = sql.match(DELETE_PATTERN);
  if (deleteMatch) {
    const table = identifierFromMatch(deleteMatch, 1);
    if (!table) return { kind: "unparseable" };
    return { kind: "write", target: { verb: "delete", table, columns: [] } };
  }

  return { kind: "unparseable" };
}

/** `null` if the table has no `ownership.json` entry at all (a different failure mode than "not this app"). */
function resolveWriters(table: string): string[] | null {
  try {
    return writersOf(table);
  } catch {
    return null;
  }
}

function findColumnViolation(table: string, app: AppName, columns: readonly string[]): string | undefined {
  const allowed = writableColumns(table, app);
  if (allowed === "*") return undefined;
  return columns.find((column) => !allowed.includes(column));
}

function findOwnershipViolation(
  app: AppName,
  target: WriteTarget,
): { table: string; column?: string } | null {
  const writers = resolveWriters(target.table);
  if (writers === null || !writers.includes(app)) {
    return { table: target.table };
  }

  const disallowedColumn = findColumnViolation(target.table, app, target.columns);
  if (disallowedColumn) {
    return { table: target.table, column: disallowedColumn };
  }

  return null;
}

function logViolation(error: OwnershipViolationError, mode: GuardMode): void {
  // No shared logging middleware (per this task's scope note) — structured console.error,
  // one event per violation, mirrored by each consuming repo's own db.ownership.violation
  // handling around the thrown/observed OwnershipViolationError.
  console.error({
    event: "db.ownership.violation",
    mode,
    app: error.app,
    table: error.table,
    column: error.column,
    statement: error.statement,
  });
}

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
export function enforceViolation(
  details: OwnershipViolationDetails,
  mode: GuardMode = DEFAULT_GUARD_MODE,
): void {
  const error = new OwnershipViolationError(details);

  if (mode === "warn") {
    logViolation(error, mode);
    return;
  }

  throw error;
}

/**
 * Runs one raw SQL statement through the ownership guard. Reads (SELECT) always pass
 * through with no checks. Writes are checked against `ownership.json`; an unparseable
 * non-SELECT statement is treated as a violation too (fail-closed), carrying the sentinel
 * table name `"<unparseable-write>"`. In `"warn"` mode a violation is logged via
 * `console.error` and the statement is allowed to proceed; in `"throw"` mode (the default)
 * it throws `OwnershipViolationError` before the statement reaches the real D1 binding.
 */
export function guardWrite(statement: string, app: AppName, opts: GuardWriteOptions = {}): void {
  const mode = opts.mode ?? DEFAULT_GUARD_MODE;
  const classification = classifyStatement(statement);

  if (classification.kind === "read") return;

  const violation =
    classification.kind === "unparseable"
      ? { table: UNPARSEABLE_WRITE_TABLE, column: undefined }
      : findOwnershipViolation(app, classification.target);

  if (!violation) return;

  enforceViolation({ app, table: violation.table, column: violation.column, statement }, mode);
}
