// The real table-ownership matrix (BE-mono-12). Typed view over `ownership.json`
// (the source of truth — see project-docs/12-cross-repo-integration-design.md §5.1/§5.4
// and project-docs/03-architecture-design.md §1). Data, not tables: this module is safe
// for every app to import, including worker-undangan.
import ownershipData from "../ownership.json" with { type: "json" };
export const ownershipMatrix = ownershipData;
function requireTable(table) {
    const entry = ownershipMatrix.tables[table];
    if (!entry) {
        throw new Error(`ownership.json has no entry for table "${table}"`);
    }
    return entry;
}
/** Which app(s) may write this table. Empty array if the table has no declared writer. */
export function writersOf(table) {
    return Object.keys(requireTable(table).writers);
}
/**
 * What columns this app may write on this table.
 * - `"*"` if the app is a writer with no column restriction.
 * - `string[]` (possibly empty) of the exact columns the app may write.
 * - Empty array if the app is not a writer of this table at all (fails closed).
 */
export function writableColumns(table, app) {
    const columns = requireTable(table).writers[app];
    return columns ?? [];
}
/** Reverse lookup: which tables can this app read or write. */
export function tablesFor(app, kind) {
    const entries = Object.entries(ownershipMatrix.tables);
    const matches = kind === "writer"
        ? entries.filter(([, ownership]) => app in ownership.writers)
        : entries.filter(([, ownership]) => ownership.readers.includes(app));
    return matches.map(([table]) => table);
}
