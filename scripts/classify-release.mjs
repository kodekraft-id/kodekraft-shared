#!/usr/bin/env node
// classify-release.mjs (OPS-shared-20) — pragmatic, diff-based release classifier.
//
// Takes two git refs (e.g. the previous tag and HEAD, or two commit SHAs) and diffs
// `ownership.json`, package.json's `exports` map, and `migrations.lock.json` between them,
// to report which class of change this release is:
//
//   WIDENING  — a table/app gained a write or read grant, an allowlist grew, a new table
//               was added, or a new export was added. Only the app that needs the new
//               capability has to bump. No lockstep.
//   NARROWING — a table/app lost a write or read grant, an allowlist shrank, or an export
//               was removed. The narrowed app must bump AND deploy first, or the revoked
//               permission exists on paper only.
//   LOCKSTEP  — migrations.lock.json changed. The new/changed migration file(s) must land
//               in all 4 apps' migrations/ folders before any of them can bump past this
//               version, or their own check-ownership R7 fails.
//
// See RELEASING.md for the full policy this script mechanises. Not exhaustive/bulletproof —
// a pragmatic regex/JSON-diff tool in the style of bin/check-ownership.mjs and
// invitation-worker-landing/scripts/check-site-literals.mjs, not a fully general one.
//
// Usage:
//   node scripts/classify-release.mjs <from-ref> <to-ref>
//   pnpm classify-release <from-ref> <to-ref>
//
// Exit code: 0 on a successful report (regardless of classification — this is an advisory
// report, not a CI gate). 1 on a usage error or a git failure (bad ref, not a git repo, etc).

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function usageError(message) {
  console.error(`classify-release: ${message}`);
  console.error("usage: node scripts/classify-release.mjs <from-ref> <to-ref>");
  process.exit(1);
}

/**
 * Reads `path` as it existed at `ref` via `git show <ref>:<path>`, resolved against `cwd`.
 * Returns `null` if the file did not exist at that ref (a brand-new file — not a git error).
 */
function readFileAtRef(cwd, ref, path) {
  const result = spawnSync("git", ["show", `${ref}:${path}`], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    const stderr = result.stderr ?? "";
    if (/does not exist|exists on disk, but not in/.test(stderr)) return null;
    // Any other git failure (bad ref, not a repo, etc) is a hard error worth surfacing.
    throw new Error(`git show ${ref}:${path} failed: ${stderr.trim() || "unknown git error"}`);
  }
  return result.stdout;
}

function readJsonAtRef(cwd, ref, path) {
  const raw = readFileAtRef(cwd, ref, path);
  if (raw === null) return null;
  return JSON.parse(raw);
}

function finding(kind, area, message) {
  return { kind, area, message };
}

// ---------------------------------------------------------------------------------------
// ownership.json diff
// ---------------------------------------------------------------------------------------
function columnsToKey(columns) {
  return columns === "*" ? "*" : [...columns].sort().join(",");
}

function diffWriterColumns(table, app, before, after) {
  if (before === undefined && after !== undefined) {
    const cols = after === "*" ? "unrestricted (*)" : after.join(", ");
    return [finding("WIDENING", "ownership", `table "${table}": app "${app}" gained write access (columns: ${cols}).`)];
  }
  if (before !== undefined && after === undefined) {
    return [finding("NARROWING", "ownership", `table "${table}": app "${app}" lost write access entirely (was: ${before === "*" ? "unrestricted (*)" : before.join(", ")}).`)];
  }
  if (before === undefined && after === undefined) return [];
  if (columnsToKey(before) === columnsToKey(after)) return [];

  const results = [];
  if (before === "*" && after !== "*") {
    results.push(finding("NARROWING", "ownership", `table "${table}": app "${app}"'s write access tightened from unrestricted (*) to a specific column allowlist (${after.join(", ")}).`));
    return results;
  }
  if (before !== "*" && after === "*") {
    results.push(finding("WIDENING", "ownership", `table "${table}": app "${app}"'s write access widened from a column allowlist to unrestricted (*).`));
    return results;
  }
  // Both arrays, different sets.
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((c) => !beforeSet.has(c));
  const removed = before.filter((c) => !afterSet.has(c));
  if (added.length) {
    results.push(finding("WIDENING", "ownership", `table "${table}": app "${app}" gained write access to column(s): ${added.join(", ")}.`));
  }
  if (removed.length) {
    results.push(finding("NARROWING", "ownership", `table "${table}": app "${app}"'s write allowlist tightened — lost column(s): ${removed.join(", ")}.`));
  }
  return results;
}

function diffReaders(table, before, after) {
  const beforeSet = new Set(before ?? []);
  const afterSet = new Set(after ?? []);
  const results = [];
  for (const app of afterSet) {
    if (!beforeSet.has(app)) results.push(finding("WIDENING", "ownership", `table "${table}": app "${app}" gained read access.`));
  }
  for (const app of beforeSet) {
    if (!afterSet.has(app)) results.push(finding("NARROWING", "ownership", `table "${table}": app "${app}" lost read access.`));
  }
  return results;
}

function diffOwnership(before, after) {
  const results = [];
  if (before === null && after === null) return results;
  const beforeTables = before?.tables ?? {};
  const afterTables = after?.tables ?? {};
  const allTables = new Set([...Object.keys(beforeTables), ...Object.keys(afterTables)]);

  for (const table of [...allTables].sort()) {
    const beforeEntry = beforeTables[table];
    const afterEntry = afterTables[table];

    if (!beforeEntry && afterEntry) {
      const writers = Object.keys(afterEntry.writers ?? {});
      results.push(finding("WIDENING", "ownership", `table "${table}" added (new writer(s): ${writers.join(", ") || "none"}).`));
      continue;
    }
    if (beforeEntry && !afterEntry) {
      results.push(finding("NARROWING", "ownership", `table "${table}" removed entirely.`));
      continue;
    }
    if (!beforeEntry || !afterEntry) continue;

    const beforeWriters = beforeEntry.writers ?? {};
    const afterWriters = afterEntry.writers ?? {};
    const allApps = new Set([...Object.keys(beforeWriters), ...Object.keys(afterWriters)]);
    for (const app of [...allApps].sort()) {
      results.push(...diffWriterColumns(table, app, beforeWriters[app], afterWriters[app]));
    }

    results.push(...diffReaders(table, beforeEntry.readers, afterEntry.readers));
  }

  return results;
}

// ---------------------------------------------------------------------------------------
// package.json exports-map diff — "a new export was added" (widening) / removed (narrowing)
// ---------------------------------------------------------------------------------------
function diffExports(before, after) {
  const results = [];
  const beforeKeys = new Set(Object.keys(before?.exports ?? {}));
  const afterKeys = new Set(Object.keys(after?.exports ?? {}));
  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) results.push(finding("WIDENING", "exports", `new export added: "${key}".`));
  }
  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) results.push(finding("NARROWING", "exports", `export removed: "${key}".`));
  }
  return results;
}

// ---------------------------------------------------------------------------------------
// migrations.lock.json diff — any change at all is a lockstep DDL obligation (doc 12 §5.6)
// ---------------------------------------------------------------------------------------
function diffMigrationsLock(before, after) {
  const results = [];
  const beforeMap = before ?? {};
  const afterMap = after ?? {};
  const allFiles = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)]);
  const changedFiles = [];

  for (const file of [...allFiles].sort()) {
    if (!(file in beforeMap) && file in afterMap) changedFiles.push(`${file} (added)`);
    else if (file in beforeMap && !(file in afterMap)) changedFiles.push(`${file} (removed)`);
    else if (beforeMap[file] !== afterMap[file]) changedFiles.push(`${file} (hash changed)`);
  }

  if (changedFiles.length) {
    results.push(
      finding(
        "LOCKSTEP",
        "migrations.lock.json",
        `changed: ${changedFiles.join(", ")}. The migration file(s) above must land in all 4 apps' ` +
          `migrations/ folders before any consumer can bump past this version, or their own ` +
          `check-ownership R7 fails (RELEASING.md, "migrations.lock.json is a lockstep DDL obligation").`,
      ),
    );
  }
  return results;
}

// ---------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------
function printReport(fromRef, toRef, findings) {
  console.log(`classify-release: ${fromRef} -> ${toRef}\n`);

  if (findings.length === 0) {
    console.log("No changes detected in ownership.json, package.json exports, or migrations.lock.json between these refs.");
    return { widening: 0, narrowing: 0, lockstep: 0 };
  }

  for (const f of findings) {
    console.log(`  [${f.kind}] (${f.area}) ${f.message}`);
  }

  const widening = findings.filter((f) => f.kind === "WIDENING").length;
  const narrowing = findings.filter((f) => f.kind === "NARROWING").length;
  const lockstep = findings.filter((f) => f.kind === "LOCKSTEP").length;

  console.log("\nSummary:");
  console.log(`  widening change(s): ${widening}`);
  console.log(`  narrowing change(s): ${narrowing}`);
  console.log(`  migrations.lock.json change(s): ${lockstep}`);

  if (narrowing > 0 || lockstep > 0) {
    console.log("\n  => THIS RELEASE NEEDS LOCKSTEP COORDINATION.");
    if (narrowing > 0) {
      console.log("     Narrowing change(s) present — the narrowed app(s) must bump and deploy FIRST.");
    }
    if (lockstep > 0) {
      console.log("     migrations.lock.json change(s) present — the new migration file(s) must land in");
      console.log("     all 4 apps' migrations/ folders before any of them bump past this version.");
    }
  } else {
    console.log("\n  => Pure widening release. No lockstep required — only the app(s) that need the new");
    console.log("     capability must bump; other repos may stay pinned to the old tag indefinitely.");
  }

  return { widening, narrowing, lockstep };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    usageError(`expected exactly 2 arguments (from-ref, to-ref), got ${args.length}.`);
  }
  const [fromRef, toRef] = args;
  const cwd = resolve(process.cwd());

  let ownershipBefore;
  let ownershipAfter;
  let pkgBefore;
  let pkgAfter;
  let lockBefore;
  let lockAfter;
  try {
    ownershipBefore = readJsonAtRef(cwd, fromRef, "ownership.json");
    ownershipAfter = readJsonAtRef(cwd, toRef, "ownership.json");
    pkgBefore = readJsonAtRef(cwd, fromRef, "package.json");
    pkgAfter = readJsonAtRef(cwd, toRef, "package.json");
    lockBefore = readJsonAtRef(cwd, fromRef, "migrations.lock.json");
    lockAfter = readJsonAtRef(cwd, toRef, "migrations.lock.json");
  } catch (err) {
    console.error(`classify-release: ${err.message}`);
    process.exit(1);
  }

  const findings = [
    ...diffOwnership(ownershipBefore, ownershipAfter),
    ...diffExports(pkgBefore, pkgAfter),
    ...diffMigrationsLock(lockBefore, lockAfter),
  ];

  printReport(fromRef, toRef, findings);
  process.exit(0);
}

main();
