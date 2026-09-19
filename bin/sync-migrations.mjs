#!/usr/bin/env node
// sync-migrations (OPS-shared-07): copies one new `00NN_*.sql` migration into the `migrations/`
// folder of all 4 app repos (byte-identical) and regenerates this package's
// `migrations.lock.json`. Replaces the old monorepo `db:sync` script. Dependency-free.
//
// Usage (run from anywhere):
//   node bin/sync-migrations.mjs <path/to/00NN_name.sql> [--root <dir>] [--lock <file>] [--dry-run]
//
//   --root     Directory holding the 4 sibling app repos (default: the parent of this package).
//   --lock     migrations.lock.json to (re)write (default: this package's own).
//   --dry-run  Report what would change; write nothing.
//
// Safety rules (each aborts BEFORE anything is written, so a failed run leaves no partial state):
//   - the filename must be `NNNN_lower_snake.sql` and its number must be higher than every
//     migration already in the lock (migrations are append-only; R7 forbids editing old ones),
//   - a repo that already has a file of that name with DIFFERENT bytes is a conflict, never
//     silently overwritten (identical bytes are simply skipped, so re-running is idempotent),
//   - all 4 repos must hold the same set of migration files once the copy is done (lockstep DDL),
//   - all 4 repo folders must exist.
// After a run, review the lock diff, then follow RELEASING.md (minor/patch bump + tag) yourself:
// this script never bumps versions, commits, tags, or pushes.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_REPOS = [
  "invitation-worker-landing",
  "invitation-worker-user",
  "invitation-worker-admin",
  "invitation-worker-undangan",
];
const MIGRATIONS_DIR = "migrations";
const MIGRATION_NAME_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

class SyncError extends Error {}

// Hashes with CRLF normalized to LF: git stores these files as LF, and the lock must match what
// Linux CI checks out. On a Windows checkout with core.autocrlf the working copy is CRLF, and a
// raw-byte hash would record a lock value CI can never reproduce.
function sha256(path) {
  const normalized = readFileSync(path).toString("latin1").replace(/\r\n/g, "\n");
  return createHash("sha256").update(Buffer.from(normalized, "latin1")).digest("hex");
}

function parseArgs(argv) {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const options = { source: null, root: resolve(packageRoot, ".."), lock: join(packageRoot, "migrations.lock.json"), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--root" || arg === "--lock") {
      const value = argv[++i];
      if (!value) throw new SyncError(`${arg} requires a value.`);
      if (arg === "--root") options.root = resolve(value);
      else options.lock = resolve(value);
    } else if (arg.startsWith("--")) throw new SyncError(`unknown flag "${arg}".`);
    else if (options.source) throw new SyncError("only one migration file may be synced per run.");
    else options.source = resolve(arg);
  }
  if (!options.source) throw new SyncError("usage: sync-migrations <path/to/00NN_name.sql> [--root <dir>] [--lock <file>] [--dry-run]");
  return options;
}

function readLock(lockPath) {
  if (!existsSync(lockPath)) throw new SyncError(`lock file not found: ${lockPath}`);
  return JSON.parse(readFileSync(lockPath, "utf8"));
}

function migrationNumber(name) {
  return Number(MIGRATION_NAME_RE.exec(name)[1]);
}

/** Validates the source file and returns its name; throws SyncError on any rule violation. */
function validateSource(source, lock) {
  if (!existsSync(source)) throw new SyncError(`source file not found: ${source}`);
  const name = source.split(/[\\/]/).pop();
  if (!MIGRATION_NAME_RE.test(name)) {
    throw new SyncError(`"${name}" is not a valid migration name (expected NNNN_lower_snake.sql).`);
  }
  const lockedNames = Object.keys(lock);
  if (name in lock) {
    if (lock[name] !== sha256(source)) {
      throw new SyncError(`"${name}" is already locked with a different hash — migrations are append-only, never edit an existing one.`);
    }
    return name; // identical to the locked one: an idempotent re-run
  }
  const highest = Math.max(0, ...lockedNames.map(migrationNumber));
  if (migrationNumber(name) <= highest) {
    throw new SyncError(`"${name}" is numbered at or below the highest locked migration (${highest}); a new migration must sort last.`);
  }
  return name;
}

function planCopies(root, source, name) {
  const sourceHash = sha256(source);
  return APP_REPOS.map((repo) => {
    const dir = join(root, repo, MIGRATIONS_DIR);
    if (!existsSync(dir)) throw new SyncError(`migrations folder not found: ${dir}`);
    const target = join(dir, name);
    if (!existsSync(target)) return { repo, dir, target, action: "copy" };
    if (sha256(target) !== sourceHash) throw new SyncError(`conflict: ${target} already exists with different content.`);
    return { repo, dir, target, action: "skip" };
  });
}

function hashDirectory(dir) {
  const hashes = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) hashes[entry.name] = sha256(join(dir, entry.name));
  }
  return hashes;
}

/** Returns the common name->hash map, or throws if the repos have diverged from each other. */
function assertLockstep(perRepoHashes) {
  const [first, ...rest] = perRepoHashes;
  const canonical = JSON.stringify(sortedEntries(first.hashes));
  for (const other of rest) {
    if (JSON.stringify(sortedEntries(other.hashes)) !== canonical) {
      throw new SyncError(`lockstep broken: ${other.repo}/migrations differs from ${first.repo}/migrations (file set or content).`);
    }
  }
  return Object.fromEntries(sortedEntries(first.hashes));
}

function sortedEntries(hashes) {
  return Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b));
}

function run(argv) {
  const { source, root, lock: lockPath, dryRun } = parseArgs(argv);
  const lock = readLock(lockPath);
  const name = validateSource(source, lock);
  const plan = planCopies(root, source, name);

  for (const { repo, action } of plan) console.log(`sync-migrations: ${repo}: ${action === "copy" ? "will copy" : "already present"} ${name}`);

  // Verify lockstep on what the folders WILL contain, without writing yet.
  const projected = plan.map(({ repo, dir, action }) => {
    const hashes = hashDirectory(dir);
    if (action === "copy") hashes[name] = sha256(source);
    return { repo, hashes };
  });
  const nextLock = assertLockstep(projected);

  if (dryRun) {
    console.log("sync-migrations: --dry-run, nothing written.");
    return;
  }

  for (const { target, action } of plan) if (action === "copy") copyFileSync(source, target);
  writeFileSync(lockPath, `${JSON.stringify(nextLock, null, 2)}\n`, "utf8");
  console.log(`sync-migrations: wrote ${lockPath} (${Object.keys(nextLock).length} migrations).`);
  console.log("sync-migrations: next, review the lock diff and cut a release per RELEASING.md (this script never commits/tags/pushes).");
}

try {
  run(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof SyncError)) throw error;
  console.error(`sync-migrations: ${error.message}`);
  process.exit(1);
}
