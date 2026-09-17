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
export declare const ownershipMatrix: OwnershipMatrix;
/** Which app(s) may write this table. Empty array if the table has no declared writer. */
export declare function writersOf(table: string): string[];
/**
 * What columns this app may write on this table.
 * - `"*"` if the app is a writer with no column restriction.
 * - `string[]` (possibly empty) of the exact columns the app may write.
 * - Empty array if the app is not a writer of this table at all (fails closed).
 */
export declare function writableColumns(table: string, app: AppName): WriterColumns;
/** Reverse lookup: which tables can this app read or write. */
export declare function tablesFor(app: AppName, kind: "reader" | "writer"): string[];
