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
const R4_METHOD_CALL_RE = /\.(?:prepare|batch|exec)\s*\(/;

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
  if (!existsSync(resolve(cwd, kodekraft.dbCompositionRoot))) {
    violations.push(violation("package.json", 1, "R4", `kodekraft.dbCompositionRoot "${kodekraft.dbCompositionRoot}" does not exist.`));
  }

  for (const abs of walkFiles(cwd, { extensions: CODE_EXTENSIONS })) {
    const rel = normalizeRel(relative(cwd, abs));
    if (isR4Exempt(rel, compositionRootRel)) continue;

    const lines = readFileSync(abs, "utf8").split("\n");
    lines.forEach((line, idx) => {
      if (R4_BINDING_ACCESS_RE.test(line)) {
        violations.push(
          violation(rel, idx + 1, "R4", `raw D1 binding access ("env.DB") outside kodekraft.dbCompositionRoot ("${kodekraft.dbCompositionRoot}").`),
        );
      } else if (R4_METHOD_CALL_RE.test(line)) {
        violations.push(
          violation(
            rel,
            idx + 1,
            "R4",
            `.prepare()/.batch()/.exec() call outside kodekraft.dbCompositionRoot ("${kodekraft.dbCompositionRoot}") — only the composition root may talk to the raw D1 handle.`,
          ),
        );
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
      violations.push(violation(`${relDir}/${name}`, 1, "R7", "sha256 mismatch — file content has drifted from migrations.lock.json."));
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
