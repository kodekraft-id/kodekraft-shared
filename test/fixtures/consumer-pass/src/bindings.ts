// R4-exempt: bindings.ts's binding type declaration is not a "raw binding access" — it's
// just naming the shape of Env. Must not trip R4 even though it names "DB".
export interface Env {
  DB: D1Database;
}
