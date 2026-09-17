/** Placeholder stand-in for the real D1 binding type until BE-mono-13 lands. */
export type PlaceholderD1Binding = unknown;
/**
 * Placeholder stub for the real `getDb(binding, app)` guard wrapper (BE-mono-13).
 * Currently just returns the binding unchanged — this is NOT a real ownership guard.
 */
export declare function getDb(binding: PlaceholderD1Binding, _app: string): PlaceholderD1Binding;
