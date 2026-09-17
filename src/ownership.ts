// The real table-ownership matrix (BE-mono-12). Typed view over `ownership.json`
// (the source of truth — see project-docs/12-cross-repo-integration-design.md §5.1/§5.4
// and project-docs/03-architecture-design.md §1). Data, not tables: this module is safe
// for every app to import, including worker-undangan.

import ownershipData from "../ownership.json" with { type: "json" };

/** The 4 valid app identifiers. Consumers declare one of these in their own `package.json`'s `kodekraft.app` field. */
export type AppName = "worker-landing" | "worker-user" | "worker-undangan" | "worker-admin";

/** Which columns of a table a given writer app may write. `"*"` = no column restriction. */
export type WriterColumns = "*" | readonly string[];

/** Ownership entry for a single table. */
export interface TableOwnership {
  /** Which schema-mirror grouping this table conceptually belongs to (e.g. `schema/clients.ts`). */
  readonly module: string;
  /** Map of writer app -> the columns that app may write on this table. */
  readonly writers: Readonly<Record<string, WriterColumns>>;
  /** Apps allowed to read this table. A ceiling, not an obligation. */
  readonly readers: readonly AppName[];
  /** Free-text nuance: column-scoping rationale, planned-vs-live status, judgment calls. */
  readonly note?: string;
}

/** The full machine-readable ownership matrix. */
export interface OwnershipMatrix {
  readonly apps: readonly AppName[];
  readonly tables: Readonly<Record<string, TableOwnership>>;
}

export const ownershipMatrix: OwnershipMatrix = ownershipData as unknown as OwnershipMatrix;

function requireTable(table: string): TableOwnership {
  const entry = ownershipMatrix.tables[table];
  if (!entry) {
    throw new Error(`ownership.json has no entry for table "${table}"`);
  }
  return entry;
}

/** Which app(s) may write this table. Empty array if the table has no declared writer. */
export function writersOf(table: string): string[] {
  return Object.keys(requireTable(table).writers);
}

/**
 * What columns this app may write on this table.
 * - `"*"` if the app is a writer with no column restriction.
 * - `string[]` (possibly empty) of the exact columns the app may write.
 * - Empty array if the app is not a writer of this table at all (fails closed).
 */
export function writableColumns(table: string, app: AppName): WriterColumns {
  const columns = requireTable(table).writers[app];
  return columns ?? [];
}

/** Reverse lookup: which tables can this app read or write. */
export function tablesFor(app: AppName, kind: "reader" | "writer"): string[] {
  const entries = Object.entries(ownershipMatrix.tables);
  const matches =
    kind === "writer"
      ? entries.filter(([, ownership]) => app in ownership.writers)
      : entries.filter(([, ownership]) => ownership.readers.includes(app));
  return matches.map(([table]) => table);
}
