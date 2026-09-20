#!/usr/bin/env node
// The real check-ownership rule engine (OPS-mono-14). Dependency-free, regex-based
// (not AST), sub-second. Ships as this package's `bin` entry — NEVER copied into the 4
// consuming repos. See project-docs/12-cross-repo-integration-design.md §5.5 in the
// consuming repos for the full rule derivation this file implements.
//
// Two modes, auto-detected from where the CLI is run FROM (process.cwd()), not from a flag:
//
//   1. "own repo" mode — cwd IS this package's root (kodekraft-shared's own CI runs the
//      bin from its own checkout). Runs R1 (exports map intact) and R6 (OWNERSHIP.md is a
//      fresh render of ownership.json). These two rules are about THIS package's own
//      integrity, never about a consumer, per doc 12 §5.5's "relocated" notes on R1/R6.
//
//   2. "consumer" mode — cwd is anything else (an app repo that depends on
//      "@kodekraft/shared" and runs `kodekraft-check-ownership` from its own root). Runs
//      R2' (app identity declared), R3 (no deep-import escapes), R4 (raw D1 binding
//      containment, with the mandatory R4-exempt carve-outs), R5 (schema mirror conforms
//      to the matrix), and R7 (migrations lock). R2 (cross-app repo imports) and the
//      "drizzle-orm banned" rule are deliberately NOT implemented — both are void with no
//      monorepo (doc 12 §5.5: R2-dropped, R4-void). R8 (schema<->migrations drift) is v0.2
//      optional and also not implemented here.
//
// Every violation is printed as "file:line — [Rule] description" and the process exits 1
// if there is at least one. A regex false positive (e.g. a commented-out import matching a
// pattern) fails loudly, which doc 12 §5.5 calls the right direction for a security control.
//
// Flags:
//   --fix    Only meaningful in "own repo" mode: (re)writes OWNERSHIP.md from
//            ownership.json instead of just checking it is up to date.
//   --check  No-op / explicit alias for the default (check-only) behaviour — accepted so
//            CI configs can spell out intent (see .github/workflows/ci.yml).

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".wrangler",
  ".output",
  "coverage",
]);

const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

// R4: raw D1 binding access. Matches both "env.DB" and "c.env.DB" (the latter contains the
// former as a substring, and \b before "env" still matches right after the preceding ".").
const R4_BINDING_ACCESS_RE = /\benv\.DB\b/;
// R4: a D1 handle's statement-execution methods, called anywhere outside the composition root.
//
// This intentionally does NOT flag every ".prepare("/".batch("/".exec(" call on any receiver —
// bare method-name matching produced real false positives (found during BE-undangan-07, the
// first real consumer integration): `RegExp.prototype.exec()` on a regex literal
// (`/foo/i.exec(...)`) and on a module-level `const OPEN = /foo/; OPEN.exec(...)` variable.
// `.exec()` in particular is a very common JS/TS regex idiom unrelated to D1 that will appear
// in almost any real codebase, unlike `.prepare()`/`.batch()`, which have no common non-D1 API
// using those exact names.
//
// A match only counts as a possible D1 binding call if the identifier chain immediately before
// the method name looks binding-shaped: it contains "db", "database", or "binding" as a whole,
// camelCase-aware word segment — e.g. "env.DB", "db", "this.dbBinding", "getDb(env)" all match;
// "OPEN", "pattern", a bare regex literal's flags do not. A match is also excluded outright if
// the character immediately preceding it is "/" (an unambiguous regex-literal closing slash,
// e.g. `/foo/.exec(...)` with no flags).
//
// Trade-off (this is a pragmatic, regex-based, sub-second tool per the file header — not an
// AST parser): this can still false-NEGATIVE if a real D1 handle is named something containing
// none of db/database/binding — acceptable, since R4 is defense-in-depth on top of guard.ts's
// runtime Proxy, which is what actually blocks a bad write regardless of what this static check
// catches. It can also still theoretically false-POSITIVE on something like a variable literally
// named `dbPattern` holding a RegExp — a far rarer collision than "any .exec() call whatsoever",
// which is what actually broke in practice.
//
// One further false-positive class remains after the binding-word narrowing above: this regex
// still can't resolve a receiver's STATIC TYPE, so a real `.batch()`/`.prepare()` call on an
// ALREADY-GUARDED Drizzle instance (received via dependency injection, typed as the composition
// root's own exported return type) still matches, even though it isn't a second path to the raw
// binding. See `getCompositionRootGuardedTypeNames`/`getLocallyGuardedReceiverNames` below
// (OPS-shared-21 part b) for the separate, additional narrowing that suppresses exactly that
// case without weakening this one.
const R4_METHOD_CALL_RE = /\.(?:prepare|batch|exec)\s*\(/g;
const R4_BINDING_WORDS = new Set(["db", "database", "binding"]);
// Matches the dotted identifier/call chain immediately preceding a position in a line, e.g.
// "env.DB", "db", "this.dbBinding", "getDb(env)" — allows one shallow (non-nested) "(...)" call
// per segment so "getDb(env).prepare(" resolves its receiver chain correctly.
const R4_RECEIVER_CHAIN_RE = /([A-Za-z_$][\w$]*(?:\s*\([^()]*\))?(?:\.[A-Za-z_$][\w$]*(?:\s*\([^()]*\))?)*)$/;

function splitIntoWords(segment) {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

// Decides whether a ".prepare("/".batch("/".exec(" match at `matchIndex` in `line` looks like a
// real D1 binding call, per the trade-off documented above R4_METHOD_CALL_RE.
function looksLikeD1BindingCall(line, matchIndex) {
  if (line[matchIndex - 1] === "/") return false; // regex-literal closing slash, e.g. /foo/.exec(...)

  const prefix = line.slice(0, matchIndex);
  const chainMatch = R4_RECEIVER_CHAIN_RE.exec(prefix);
  if (!chainMatch) return false;

  const words = chainMatch[1].split(/[.()]+/).flatMap((part) => splitIntoWords(part));
  return words.some((word) => R4_BINDING_WORDS.has(word.toLowerCase()));
}

// R4 false-positive fix (OPS-shared-21, v0.1.2): blank out comment text before matching, so a
// doc comment that merely MENTIONS "env.DB"/".batch("/".prepare("/".exec(" in prose (e.g.
// "buat akun klien ... dalam SATU db.batch (atomik)") doesn't register as a real call. This is a
// simple stateful strip — line comments truncate the rest of the line, block comments blank
// out everything between "/*" and "*/" (tracked across lines) — not a full tokenizer, so a "//"
// or "/*" inside a string literal can still over-strip. That is an accepted trade-off in the
// safe direction: it can only cause a false NEGATIVE, which R4 already tolerates since it is
// defense-in-depth on top of guard.ts's runtime Proxy, never the sole enforcement.
function stripCommentsForR4(rawLines) {
  const out = [];
  let inBlock = false;
  for (const line of rawLines) {
    let result = "";
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf("*/", i);
        if (end === -1) break;
        inBlock = false;
        i = end + 2;
        continue;
      }
      const lineIdx = line.indexOf("//", i);
      const blockIdx = line.indexOf("/*", i);
      if (lineIdx === -1 && blockIdx === -1) {
        result += line.slice(i);
        break;
      }
      if (blockIdx === -1 || (lineIdx !== -1 && lineIdx < blockIdx)) {
        result += line.slice(i, lineIdx);
        break;
      }
      result += line.slice(i, blockIdx);
      inBlock = true;
      i = blockIdx + 2;
    }
    out.push(result);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// R4 precision fix (OPS-shared-21 part b): guarded-receiver detection.
//
// Problem: R4_METHOD_CALL_RE + looksLikeD1BindingCall correctly flag a ".prepare()"/".batch()"/
// ".exec()" call on anything binding-shaped, but neither can resolve what a receiver's STATIC
// TYPE actually is — so `this.db.batch(...)` on an already-guarded Drizzle instance (typed as
// the composition root's own return type, handed to a repository via dependency injection)
// fires exactly the same as a real raw-binding call would. Confirmed empirically: 35 false
// positives in invitation-worker-user (every `*.repository.ts` factory function takes a
// `db: DB` parameter, per its layering refactor) and 1 in invitation-worker-admin
// (`constructor(private readonly db: DB)`) — never a raw `env.DB`/`D1Database` in either.
//
// Fix, chosen deliberately over resolving this via the TypeScript compiler API (out of
// proportion for a "dependency-free, sub-second" static check per this file's own header — it
// would need every consuming repo's tsconfig to resolve cleanly, and full-program type-checking
// is not a sub-second operation): a narrower, still text-based two-step trace, computed once per
// run —
//
//   1. Read `kodekraft.dbCompositionRoot` once and collect every `export type <Name> = ...
//      ReturnType<...>` alias it declares ("DB" in worker-user/worker-admin/worker-landing,
//      "Db" in worker-undangan — the capture is name-agnostic on purpose). This IS "the
//      composition root's return type", read directly off the one file R4 already trusts as
//      ground truth for where the raw binding may be touched.
//   2. In each OTHER scanned file, resolve every named import against the composition root's
//      own absolute path (by import provenance, not by name alone — a coincidentally-same-named
//      local `type DB` declared elsewhere must NOT count, or this would trivially defeat R4) to
//      find any local alias bound to one of those guarded type names, then look for a
//      parameter, TS constructor-parameter-property, class field, or variable declared with
//      that alias as its EXPLICIT type annotation. Only an explicit `: DB`-shaped annotation
//      counts — `const db = getDb(env)` with no annotation does not, so this can't be defeated
//      by simply omitting a type; such a call was never one of the confirmed false positives
//      and stays flagged, unchanged.
//
// A `.prepare()`/`.batch()`/`.exec()` match is only suppressed when its receiver's own base
// identifier (the LAST segment of the dotted chain — "db" in both "db.batch(" and
// "this.db.batch(") is one of these confirmed-guarded names for that file.
//
// Explicitly NOT weakened by this: `R4_BINDING_ACCESS_RE` ("env.DB" literal text) is untouched —
// "env" is always the raw Worker bindings object by construction, never an alias for a guarded
// handle, so no guarded-receiver carve-out applies to it. A raw `D1Database`-typed parameter, or
// any receiver whose declared type does not trace back to the composition root's own
// return-type alias, is still flagged exactly as before (confirmed empirically: grepping all 4
// consuming repos found zero `: D1Database` parameters outside `bindings.ts`/composition roots,
// and zero call site anywhere that calls `.prepare()/.batch()/.exec()` directly on a bare,
// unannotated `getDb(env)` result).
//
// Scoping: guarded names are resolved per TOP-LEVEL DECLARATION (function or class), not
// blanket per file. An earlier version of this fix tracked one flat guarded-name set per file,
// which was verified (during this same change, by deliberately planting the counter-example) to
// let one legitimately-guarded `db: DB` parameter in one function silently shield an unrelated,
// genuinely-raw, same-named parameter in a DIFFERENT top-level function/class in the same file —
// a real false negative, not just a theoretical one. `splitIntoTopLevelChunks` below closes that
// gap with a brace-depth pass (still no AST): each top-level function/class body — including
// everything nested inside it, e.g. a factory function's returned object-literal methods, or
// every method of a class whose guarded parameter lives only in its constructor's signature —
// is its own chunk, and a receiver is only treated as guarded if its OWN chunk contains a
// matching declaration. Import resolution stays file-wide on purpose (JS/TS imports are not
// block-scoped, so that part of the trace is correctly file-wide, not chunk-scoped).
// ---------------------------------------------------------------------------------------
function getCompositionRootGuardedTypeNames(compositionRootAbs) {
  const names = new Set();
  if (!existsSync(compositionRootAbs)) return names;
  const lines = stripCommentsForR4(readFileSync(compositionRootAbs, "utf8").split("\n"));
  const EXPORTED_RETURN_TYPE_ALIAS_RE = /^\s*export\s+type\s+([A-Za-z_$][\w$]*)\s*=.*\bReturnType\s*</;
  for (const line of lines) {
    const match = EXPORTED_RETURN_TYPE_ALIAS_RE.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

const R4_IMPORT_NAMED_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

// Splits a named-import clause ("A, type B, C as D") into { imported, local } pairs, stripping
// an inline "type" modifier and resolving an "as" alias to its local binding name.
function parseNamedImportClause(rawClause) {
  return rawClause
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const withoutInlineType = part.replace(/^type\s+/, "");
      const aliasMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(withoutInlineType);
      return aliasMatch
        ? { imported: aliasMatch[1], local: aliasMatch[2] }
        : { imported: withoutInlineType, local: withoutInlineType };
    });
}

function stripKnownExtension(p) {
  return p.replace(/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i, "");
}

// True only if `specifier`, resolved relative to the importing file's own directory, points at
// exactly the same file as the declared composition root (extension-insensitively, the same way
// TypeScript resolves an extensionless relative specifier). Bare/package specifiers (no leading
// ".") can never be the composition root and are rejected outright — R3 already governs
// "@kodekraft/shared" imports separately.
function specifierResolvesToCompositionRoot(fileDirAbs, specifier, compositionRootAbs) {
  if (!specifier.startsWith(".")) return false;
  return stripKnownExtension(resolve(fileDirAbs, specifier)) === stripKnownExtension(compositionRootAbs);
}

// A parameter (plain, or a TS constructor-parameter-property carrying accessibility/readonly
// modifiers) typed as one of this file's confirmed-guarded aliases, e.g. "db: DB" in
// "createFoo(db: DB)" or "constructor(private readonly db: DB)". Runs against the WHOLE
// (comment-stripped) file text rather than per line, so a parameter list a formatter wrapped
// across multiple lines is still matched ("\s" matches newlines too).
function buildGuardedParamRe(aliasNames) {
  const typeAlternation = aliasNames.map(escapeRegExp).join("|");
  return new RegExp(
    `[(,]\\s*(?:(?:public|private|protected|readonly)\\s+)*([A-Za-z_$][\\w$]*)\\s*:\\s*(?:${typeAlternation})\\b`,
    "g",
  );
}

// Same idea for a class field or local variable carrying an explicit guarded-type annotation,
// e.g. "private db: DB;" or "const db: DB = ...;" — not observed in any of the 4 repos today
// (constructor-parameter-properties and factory-function parameters cover every real case seen
// so far), kept for robustness since it costs nothing extra and follows the same
// declaration-based rule.
function buildGuardedDeclarationRe(aliasNames) {
  const typeAlternation = aliasNames.map(escapeRegExp).join("|");
  return new RegExp(
    `(?:^|;)\\s*(?:(?:public|private|protected|readonly|const|let|var)\\s+)*([A-Za-z_$][\\w$]*)\\s*:\\s*(?:${typeAlternation})\\b`,
    "gm",
  );
}

// File-wide: the set of local identifier names that resolve — via a relative import genuinely
// pointing at the composition root — to one of its guarded return-type aliases. Correctly
// file-wide, not chunk-scoped: an import binding is visible throughout the whole module
// regardless of where a given top-level declaration sits relative to it.
function getLocallyGuardedAliasNames(fileText, fileDirAbs, compositionRootAbs, guardedTypeNames) {
  const localAliases = new Set();
  for (const [, clause, specifier] of fileText.matchAll(R4_IMPORT_NAMED_RE)) {
    if (!specifierResolvesToCompositionRoot(fileDirAbs, specifier, compositionRootAbs)) continue;
    for (const { imported, local } of parseNamedImportClause(clause)) {
      if (guardedTypeNames.has(imported)) localAliases.add(local);
    }
  }
  return localAliases;
}

// Splits `fileText` into contiguous, non-overlapping top-level chunks by brace depth: each
// chunk ends exactly where brace depth returns to 0 (a top-level function/class/interface body,
// with everything nested inside it, however deep), and picks up wherever the previous chunk
// left off (so leading imports/types and any depth-0 text between declarations are swept into
// whichever chunk follows them — harmless, since such interstitial text is never itself a
// function/class body carrying a guarded parameter). This is a brace-counting approximation,
// not a tokenizer — a "{"/"}" inside a string, template literal, or regex literal throws the
// count off — a known, accepted limit shared with `stripCommentsForR4`'s own comment-only
// scope, used ONLY to decide which declarations are "in scope" for a given receiver, never to
// decide whether a call is a violation at all.
function splitIntoTopLevelChunks(fileText) {
  const boundaries = [0];
  let depth = 0;
  for (let i = 0; i < fileText.length; i++) {
    if (fileText[i] === "{") {
      depth++;
    } else if (fileText[i] === "}") {
      if (depth > 0) depth--;
      if (depth === 0) boundaries.push(i + 1);
    }
  }
  if (boundaries[boundaries.length - 1] !== fileText.length) boundaries.push(fileText.length);

  const chunks = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    chunks.push({ start: boundaries[i], end: boundaries[i + 1] });
  }
  return chunks;
}

// Annotates each top-level chunk with the receiver names IT ITSELF declares (parameter,
// constructor-parameter-property, field, or variable) using one of `aliasNames` as an explicit
// type annotation — scoping guarded names to "this receiver's own enclosing top-level
// function/class", not the whole file (see the block comment above for why that matters).
function getGuardedReceiverNamesByChunk(fileText, aliasNames) {
  const chunks = splitIntoTopLevelChunks(fileText);
  if (aliasNames.length === 0) return chunks.map((chunk) => ({ ...chunk, names: new Set() }));

  const paramRe = buildGuardedParamRe(aliasNames);
  const declRe = buildGuardedDeclarationRe(aliasNames);
  return chunks.map((chunk) => {
    const chunkText = fileText.slice(chunk.start, chunk.end);
    const names = new Set();
    for (const re of [paramRe, declRe]) {
      for (const match of chunkText.matchAll(re)) names.add(match[1]);
    }
    return { start: chunk.start, end: chunk.end, names };
  });
}

function guardedNamesAtOffset(chunksWithNames, offset) {
  const chunk = chunksWithNames.find((c) => offset >= c.start && offset < c.end);
  return chunk ? chunk.names : new Set();
}

// The identifier immediately holding the method being called — the LAST segment of the dotted
// receiver chain ("db" in both "db.batch(" and "this.db.batch("; "dbBinding" in
// "ctx.dbBinding.exec("). Deliberately the same chain `looksLikeD1BindingCall` already extracts,
// just narrowed to its final segment, since that is the actual property/parameter that would
// carry the guarded type annotation — "this"/"ctx" are just the containing object.
function receiverBaseIdentifier(line, matchIndex) {
  const prefix = line.slice(0, matchIndex);
  const chainMatch = R4_RECEIVER_CHAIN_RE.exec(prefix);
  if (!chainMatch) return null;
  const segments = chainMatch[1].split(".");
  const identifierMatch = /^[A-Za-z_$][\w$]*/.exec(segments[segments.length - 1].trim());
  return identifierMatch ? identifierMatch[0] : null;
}

function isGuardedReceiver(line, matchIndex, guardedReceiverNames) {
  if (guardedReceiverNames.size === 0) return false;
  const base = receiverBaseIdentifier(line, matchIndex);
  return base !== null && guardedReceiverNames.has(base);
}

// R3: any specifier that reaches around the package's `exports` map into its internals.
const R3_PATTERNS = [
  { re: /@kodekraft\/shared\/src(?:[/'"`]|$)/, label: "@kodekraft/shared/src" },
  { re: /@kodekraft\/shared\/dist(?:[/'"`]|$)/, label: "@kodekraft/shared/dist" },
  { re: /node_modules\/@kodekraft\/shared\//, label: "a relative path into node_modules/@kodekraft/shared" },
];

const R5_SQLITE_TABLE_RE = /sqliteTable\(\s*["'`]([A-Za-z0-9_]+)["'`]/g;

function normalizeRel(p) {
  return p.split(sep).join("/");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineOf(text, regex) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) return i + 1;
  }
  return 1;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// R7 message quality-of-life only (raised during OPS-shared-21, not itself that task's scope —
// see R7's own call site below for why this is diagnostic text only, never a behavior change):
// true if `path`'s content, with CRLF line endings normalized to LF, hashes to `expectedHash` —
// i.e. the ONLY difference from the locked content is line-ending style. Read-only: never
// touches/renormalizes the working-tree file, and never changes whether R7 reports a violation
// — it only makes the printed message more actionable when this specific shape of "drift" is
// actually a Windows checkout artifact (e.g. core.autocrlf) rather than a real migration edit.
function matchesWhenCrlfNormalized(path, expectedHash) {
  const normalizedToLf = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalizedToLf).digest("hex") === expectedHash;
}

function* walkFiles(root, { excludeDirs = DEFAULT_EXCLUDE_DIRS, extensions } = {}) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!excludeDirs.has(entry.name)) stack.push(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const full = join(dir, entry.name);
      if (!extensions || extensions.some((ext) => entry.name.endsWith(ext))) {
        yield full;
      }
    }
  }
}

function violation(file, line, rule, message) {
  return { file, line, rule, message };
}

// ---------------------------------------------------------------------------------------
// R1 — exports map intact. Package's own CI rule (doc 12 §5.5: "relocated"). Checks this
// package's OWN package.json: no root "." export (doc 12 §5.4 — "every import is explicit
// about what it pulls in"), and every declared subpath's target file actually exists
// (catches a stale entry left after a rename, or a `pnpm build` that was never run).
// ---------------------------------------------------------------------------------------
function checkR1ExportsIntact(packageRoot) {
  const violations = [];
  const pkgPath = join(packageRoot, "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  const exportsMap = pkg.exports ?? {};

  if (Object.prototype.hasOwnProperty.call(exportsMap, ".")) {
    violations.push(
      violation(
        "package.json",
        lineOf(raw, /"\."\s*:/),
        "R1",
        'exports map declares a root "." export — doc 12 §5.4 requires every consumer import to name its subpath explicitly.',
      ),
    );
  }

  for (const [subpath, target] of Object.entries(exportsMap)) {
    if (subpath === ".") continue;
    const targets = typeof target === "string" ? [target] : Object.values(target ?? {});
    for (const t of targets) {
      if (typeof t !== "string") continue;
      if (!existsSync(join(packageRoot, t))) {
        violations.push(
          violation(
            "package.json",
            lineOf(raw, new RegExp(escapeRegExp(`"${subpath}"`))),
            "R1",
            `exports["${subpath}"] points at "${t}", which does not exist on disk (stale entry, or "pnpm build" was never run).`,
          ),
        );
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------------------
// R6 — OWNERSHIP.md is a fresh, checked-in render of ownership.json. Package's own CI rule
// (doc 12 §5.5: "relocated" — "regenerates OWNERSHIP.md from ownership.json"). `--fix`
// writes the file; without it, a stale/missing OWNERSHIP.md is a violation.
// ---------------------------------------------------------------------------------------
function renderOwnershipMarkdown(matrix) {
  const rows = Object.keys(matrix.tables)
    .sort((a, b) => a.localeCompare(b))
    .map((table) => {
      const entry = matrix.tables[table];
      const writers =
        Object.entries(entry.writers)
          .map(([app, cols]) => (cols === "*" ? app : `${app} (${cols.join(", ")})`))
          .join("; ") || "—";
      const readers = entry.readers.length ? entry.readers.join(", ") : "—";
      return `| \`${table}\` | \`${entry.module}\` | ${writers} | ${readers} |`;
    });

  return (
    [
      "<!-- GENERATED FILE — do not hand-edit. Run `node bin/check-ownership.mjs --fix` to regenerate from ownership.json. -->",
      "",
      "# OWNERSHIP.md",
      "",
      "Human-readable render of `ownership.json`, the table-ownership matrix shared by the 4",
      "`invitation-worker-*` repos. `writers` lists, per table, which app(s) may write it and",
      "which columns (`*` = unrestricted). `readers` is a ceiling, not an obligation — see",
      "`project-docs/12-cross-repo-integration-design.md` §5.4/§5.5 (rules R5-R7) in each",
      "consuming repo for how this matrix is enforced against real code.",
      "",
      "| Table | Schema module | Writers (writable columns) | Readers |",
      "|---|---|---|---|",
      ...rows,
      "",
    ].join("\n")
  );
}

function checkR6OwnershipMdSync(packageRoot, matrix, fix) {
  const violations = [];
  const mdPath = join(packageRoot, "OWNERSHIP.md");
  const rendered = renderOwnershipMarkdown(matrix);
  const current = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : null;

  if (fix) {
    if (current !== rendered) {
      writeFileSync(mdPath, rendered, "utf8");
      console.log("check-ownership: regenerated OWNERSHIP.md from ownership.json.");
    } else {
      console.log("check-ownership: OWNERSHIP.md already up to date.");
    }
    return violations;
  }

  if (current === null) {
    violations.push(violation("OWNERSHIP.md", 1, "R6", "does not exist. Run `node bin/check-ownership.mjs --fix` to generate it from ownership.json."));
  } else if (current !== rendered) {
    violations.push(violation("OWNERSHIP.md", 1, "R6", "is stale relative to ownership.json. Run `node bin/check-ownership.mjs --fix` to regenerate."));
  }
  return violations;
}

// ---------------------------------------------------------------------------------------
// R2' — app identity declared. Without a valid `kodekraft.app`, there is no matrix row to
// enforce anything else against, so this short-circuits the rest of the consumer checks.
// ---------------------------------------------------------------------------------------
function checkR2PrimeAppIdentity(pkg, raw, matrix) {
  const violations = [];
  const kodekraft = pkg.kodekraft && typeof pkg.kodekraft === "object" ? pkg.kodekraft : null;

  if (!kodekraft) {
    violations.push(
      violation(
        "package.json",
        1,
        "R2'",
        'missing required "kodekraft" block ({ app, dbCompositionRoot, schemaMirror, migrationsDir }) — see doc 12 §5.4.',
      ),
    );
    return { violations, kodekraft: null };
  }

  const line = lineOf(raw, /"app"\s*:/);
  if (!kodekraft.app) {
    violations.push(violation("package.json", line, "R2'", '"kodekraft.app" is not declared.'));
  } else if (!matrix.apps.includes(kodekraft.app)) {
    violations.push(
      violation(
        "package.json",
        line,
        "R2'",
        `"kodekraft.app" is "${kodekraft.app}", which is not present in ownership.json's "apps" array (${matrix.apps.join(", ")}).`,
      ),
    );
  }

  return { violations, kodekraft };
}

// ---------------------------------------------------------------------------------------
// R3 — no deep-import escapes around the exports map.
// ---------------------------------------------------------------------------------------
function checkR3NoDeepImportEscapes(cwd) {
  const violations = [];
  for (const abs of walkFiles(cwd, { extensions: CODE_EXTENSIONS })) {
    const rel = normalizeRel(relative(cwd, abs));
    const lines = readFileSync(abs, "utf8").split("\n");
    lines.forEach((line, idx) => {
      for (const { re, label } of R3_PATTERNS) {
        if (re.test(line)) {
          violations.push(
            violation(rel, idx + 1, "R3", `deep-import escape around the "@kodekraft/shared" exports map (matched ${label}).`),
          );
        }
      }
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------------------
// R4 — raw binding containment, with the mandatory R4-exempt carve-outs:
//   - kodekraft.dbCompositionRoot itself (the one file allowed to touch the raw handle)
//   - bindings.ts's `DB: D1Database` type declaration (doc 12 §5.5, R4-exempt)
//   - test/** and *.test.ts / *.spec.ts (mandatory — worker-undangan's gate-ordering.test.ts
//     spies on env.DB.prepare() by design; without this exemption a green suite breaks day one)
// ---------------------------------------------------------------------------------------
function isR4Exempt(rel, compositionRootRel) {
  if (rel === compositionRootRel) return true;
  if (rel.endsWith("bindings.ts")) return true;
  if (/(^|\/)test\//.test(rel)) return true;
  if (/\.(?:test|spec)\.ts$/.test(rel)) return true;
  return false;
}

function checkR4RawBindingContainment(cwd, kodekraft) {
  const violations = [];
  if (!kodekraft.dbCompositionRoot) {
    violations.push(violation("package.json", 1, "R4", '"kodekraft.dbCompositionRoot" is not declared.'));
    return violations;
  }

  const compositionRootRel = normalizeRel(kodekraft.dbCompositionRoot);
  const compositionRootAbs = resolve(cwd, kodekraft.dbCompositionRoot);
  if (!existsSync(compositionRootAbs)) {
    violations.push(violation("package.json", 1, "R4", `kodekraft.dbCompositionRoot "${kodekraft.dbCompositionRoot}" does not exist.`));
  }

  // Computed ONCE per run, not per scanned file — see the block comment above
  // getCompositionRootGuardedTypeNames for the full rationale (OPS-shared-21 part b).
  const guardedTypeNames = getCompositionRootGuardedTypeNames(compositionRootAbs);

  for (const abs of walkFiles(cwd, { extensions: CODE_EXTENSIONS })) {
    const rel = normalizeRel(relative(cwd, abs));
    if (isR4Exempt(rel, compositionRootRel)) continue;

    const lines = stripCommentsForR4(readFileSync(abs, "utf8").split("\n"));
    const fileText = lines.join("\n");

    // Per-chunk (not per-file) guarded-receiver names — see splitIntoTopLevelChunks/
    // getGuardedReceiverNamesByChunk above for why this must be scoped narrower than the whole
    // file. lineStartOffsets maps a (line, column) match position back to its absolute offset
    // in `fileText` so the right chunk can be looked up.
    let chunksWithNames = [];
    if (guardedTypeNames.size) {
      const aliasNames = [...getLocallyGuardedAliasNames(fileText, dirname(abs), compositionRootAbs, guardedTypeNames)];
      if (aliasNames.length) chunksWithNames = getGuardedReceiverNamesByChunk(fileText, aliasNames);
    }
    const lineStartOffsets = [];
    for (let cursor = 0, i = 0; i < lines.length; i++) {
      lineStartOffsets.push(cursor);
      cursor += lines[i].length + 1; // +1 for the "\n" joining character
    }

    lines.forEach((line, idx) => {
      if (R4_BINDING_ACCESS_RE.test(line)) {
        violations.push(
          violation(rel, idx + 1, "R4", `raw D1 binding access ("env.DB") outside kodekraft.dbCompositionRoot ("${kodekraft.dbCompositionRoot}").`),
        );
        return;
      }

      for (const match of line.matchAll(R4_METHOD_CALL_RE)) {
        if (!looksLikeD1BindingCall(line, match.index)) continue;
        if (chunksWithNames.length) {
          const guardedReceiverNames = guardedNamesAtOffset(chunksWithNames, lineStartOffsets[idx] + match.index);
          if (isGuardedReceiver(line, match.index, guardedReceiverNames)) continue;
        }
        violations.push(
          violation(
            rel,
            idx + 1,
            "R4",
            `.prepare()/.batch()/.exec() call outside kodekraft.dbCompositionRoot ("${kodekraft.dbCompositionRoot}") — only the composition root may talk to the raw D1 handle.`,
          ),
        );
        break;
      }
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------------------
// R5 — schema mirror conforms to the matrix: every sqliteTable("<name>", …) in
// kodekraft.schemaMirror must name a table this app is a writer OR reader of.
// ---------------------------------------------------------------------------------------
function checkR5SchemaMirrorConformance(cwd, kodekraft, matrix) {
  const violations = [];
  const { app, schemaMirror } = kodekraft;

  if (!schemaMirror) {
    violations.push(violation("package.json", 1, "R5", '"kodekraft.schemaMirror" is not declared.'));
    return violations;
  }

  const abs = resolve(cwd, schemaMirror);
  const rel = normalizeRel(schemaMirror);
  if (!existsSync(abs)) {
    violations.push(violation(rel, 1, "R5", "kodekraft.schemaMirror file does not exist."));
    return violations;
  }

  const content = readFileSync(abs, "utf8");
  R5_SQLITE_TABLE_RE.lastIndex = 0;
  let match;
  while ((match = R5_SQLITE_TABLE_RE.exec(content))) {
    const table = match[1];
    const line = content.slice(0, match.index).split("\n").length;
    const entry = matrix.tables[table];
    const isWriter = entry ? Object.prototype.hasOwnProperty.call(entry.writers, app) : false;
    const isReader = entry ? entry.readers.includes(app) : false;

    if (!entry) {
      violations.push(violation(rel, line, "R5", `sqliteTable("${table}") has no entry in ownership.json at all.`));
    } else if (!isWriter && !isReader) {
      violations.push(
        violation(rel, line, "R5", `sqliteTable("${table}") defined, but "${app}" is neither a writer nor a reader of "${table}" per ownership.json.`),
      );
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------------------
// R7 — migrations lock: sha256 of every file in kodekraft.migrationsDir must match
// migrations.lock.json exactly (a new or missing file also fails). migrations.lock.json
// ships at this package's root (doc 12 §5.4); resolved relative to this script's own
// location so it works whether this file is running from a consumer's
// node_modules/@kodekraft/shared/bin/ or from this repo's own bin/ during its own CI.
//
// KODEKRAFT_SHARED_TEST_LOCK_PATH is a test-only escape hatch (see test/check-ownership.test.ts)
// used because migrations.lock.json does not exist in this package yet (flagged in
// OPS-mono-14's report; lands via OPS-shared-05). Consumers must never set this.
// ---------------------------------------------------------------------------------------
function checkR7MigrationsLock(cwd, kodekraft, packageRoot) {
  const violations = [];
  const lockPath = process.env.KODEKRAFT_SHARED_TEST_LOCK_PATH
    ? resolve(process.env.KODEKRAFT_SHARED_TEST_LOCK_PATH)
    : join(packageRoot, "migrations.lock.json");

  if (!existsSync(lockPath)) {
    console.warn(
      `check-ownership: R7 SKIPPED — migrations.lock.json not found at "${lockPath}". This is ` +
        "expected until it ships inside @kodekraft/shared's own package root (OPS-shared-05); " +
        "R7 becomes enforced automatically once that file lands, no consumer change needed.",
    );
    return violations;
  }

  if (!kodekraft.migrationsDir) {
    violations.push(violation("package.json", 1, "R7", '"kodekraft.migrationsDir" is not declared.'));
    return violations;
  }

  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const dirAbs = resolve(cwd, kodekraft.migrationsDir);
  const relDir = normalizeRel(kodekraft.migrationsDir);

  if (!existsSync(dirAbs)) {
    violations.push(violation(relDir, 1, "R7", "kodekraft.migrationsDir does not exist."));
    return violations;
  }

  const actualHashes = {};
  for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    actualHashes[entry.name] = sha256File(join(dirAbs, entry.name));
  }

  for (const [name, expectedHash] of Object.entries(lock)) {
    if (!(name in actualHashes)) {
      violations.push(violation(`${relDir}/${name}`, 1, "R7", "missing — present in migrations.lock.json but not found in migrationsDir."));
    } else if (actualHashes[name] !== expectedHash) {
      const crlfArtifact = matchesWhenCrlfNormalized(join(dirAbs, name), expectedHash);
      const message = crlfArtifact
        ? "sha256 mismatch — file content has drifted from migrations.lock.json. This file's content " +
          "matches the locked hash once CRLF line endings are normalized to LF, which looks like a " +
          "Windows working-tree checkout artifact (e.g. core.autocrlf converting a committed LF blob on " +
          "checkout), not real content drift — compare against the committed blob (e.g. `git show " +
          "HEAD:<path>`) before treating this as a real migration edit."
        : "sha256 mismatch — file content has drifted from migrations.lock.json.";
      violations.push(violation(`${relDir}/${name}`, 1, "R7", message));
    }
  }
  for (const name of Object.keys(actualHashes)) {
    if (!(name in lock)) {
      violations.push(violation(`${relDir}/${name}`, 1, "R7", "unexpected file — not present in migrations.lock.json (new/renamed migration not yet locked)."));
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------
function runConsumerChecks(cwd, packageRoot, matrix) {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    return [violation("package.json", 1, "R2'", "no package.json found in the current directory. Run kodekraft-check-ownership from a consumer repo's root.")];
  }

  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  const { violations: r2primeViolations, kodekraft } = checkR2PrimeAppIdentity(pkg, raw, matrix);

  if (!kodekraft) {
    // No usable kodekraft block at all — nothing else can be checked against a matrix row.
    return r2primeViolations;
  }

  return [
    ...r2primeViolations,
    ...checkR3NoDeepImportEscapes(cwd),
    ...checkR4RawBindingContainment(cwd, kodekraft),
    ...checkR5SchemaMirrorConformance(cwd, kodekraft, matrix),
    ...checkR7MigrationsLock(cwd, kodekraft, packageRoot),
  ];
}

function printReport(violations) {
  if (violations.length === 0) {
    console.log("check-ownership: no violations found.");
    return;
  }
  console.error(`check-ownership: ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.error(`${v.file}:${v.line} — [${v.rule}] ${v.message}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const fix = args.includes("--fix");

  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const matrix = JSON.parse(readFileSync(join(packageRoot, "ownership.json"), "utf8"));
  const cwd = resolve(process.cwd());
  // realpathSync resolves symlinks/junctions (e.g. Windows' AppData\Local\Temp junction) so
  // "own repo" detection is robust to the OS handing back a differently-resolved cwd than the
  // literal path this script was invoked from.
  const isOwnRepo = realpathSync(cwd) === realpathSync(packageRoot);

  let violations;
  if (isOwnRepo) {
    // Package's own CI: R1 (exports map intact) + R6 (OWNERSHIP.md sync). R2'/R3/R4/R5/R7
    // are consumer rules and don't apply — this repo has no "kodekraft" block of its own.
    violations = [...checkR1ExportsIntact(packageRoot), ...checkR6OwnershipMdSync(packageRoot, matrix, fix)];
  } else {
    if (fix) {
      console.warn(
        "check-ownership: --fix only regenerates OWNERSHIP.md, which only applies when run from " +
          "kodekraft-shared's own repo root; ignoring --fix for this consumer check.",
      );
    }
    violations = runConsumerChecks(cwd, packageRoot, matrix);
  }

  printReport(violations);
  process.exit(violations.length ? 1 : 0);
}

main();
