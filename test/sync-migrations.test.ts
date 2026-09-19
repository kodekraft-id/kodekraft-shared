// OPS-shared-07: tests for bin/sync-migrations.mjs, run as a real subprocess against a temp
// layout of 4 fake app repos + a temp lock file (never the real repos or the real lock).

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "sync-migrations.mjs");
const REPOS = ["invitation-worker-landing", "invitation-worker-user", "invitation-worker-admin", "invitation-worker-undangan"];
const EXISTING = "CREATE TABLE a (id TEXT PRIMARY KEY);\n";
const NEW_SQL = "ALTER TABLE a ADD COLUMN note TEXT;\n";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("sync-migrations.mjs", () => {
  let root: string;
  let lockPath: string;
  let sourcePath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sync-migrations-"));
    for (const repo of REPOS) {
      mkdirSync(join(root, repo, "migrations"), { recursive: true });
      writeFileSync(join(root, repo, "migrations", "0001_a.sql"), EXISTING);
    }
    lockPath = join(root, "lock.json");
    writeFileSync(lockPath, JSON.stringify({ "0001_a.sql": sha(EXISTING) }));
    mkdirSync(join(root, "incoming"));
    sourcePath = join(root, "incoming", "0002_add_note.sql");
    writeFileSync(sourcePath, NEW_SQL);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function sync(args: string[] = [], source: string = sourcePath) {
    const result = spawnSync(process.execPath, [BIN, source, "--root", root, "--lock", lockPath, ...args], { encoding: "utf8" });
    return { status: result.status ?? 1, output: (result.stdout ?? "") + (result.stderr ?? "") };
  }

  it("copies the file into all 4 repos and regenerates the lock, sorted", () => {
    const result = sync();
    expect(result.status).toBe(0);
    for (const repo of REPOS) {
      expect(readFileSync(join(root, repo, "migrations", "0002_add_note.sql"), "utf8")).toBe(NEW_SQL);
    }
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(lock).toEqual({ "0001_a.sql": sha(EXISTING), "0002_add_note.sql": sha(NEW_SQL) });
    expect(Object.keys(lock)).toEqual(["0001_a.sql", "0002_add_note.sql"]);
  });

  it("hashes CRLF and LF copies of a file identically (Windows autocrlf checkouts)", () => {
    writeFileSync(sourcePath, NEW_SQL.replace(/\n/g, "\r\n"));
    expect(sync().status).toBe(0);
    expect(JSON.parse(readFileSync(lockPath, "utf8"))["0002_add_note.sql"]).toBe(sha(NEW_SQL));
  });

  it("is idempotent: a second identical run succeeds and changes nothing", () => {
    expect(sync().status).toBe(0);
    const lockAfterFirst = readFileSync(lockPath, "utf8");
    const second = sync();
    expect(second.status).toBe(0);
    expect(second.output).toContain("already present");
    expect(readFileSync(lockPath, "utf8")).toBe(lockAfterFirst);
  });

  it("--dry-run writes nothing", () => {
    const result = sync(["--dry-run"]);
    expect(result.status).toBe(0);
    expect(existsSync(join(root, REPOS[0], "migrations", "0002_add_note.sql"))).toBe(false);
    expect(JSON.parse(readFileSync(lockPath, "utf8"))).toEqual({ "0001_a.sql": sha(EXISTING) });
  });

  it("aborts with no partial writes when one repo has a conflicting file of that name", () => {
    writeFileSync(join(root, REPOS[3], "migrations", "0002_add_note.sql"), "-- different\n");
    const result = sync();
    expect(result.status).toBe(1);
    expect(result.output).toContain("conflict");
    expect(existsSync(join(root, REPOS[0], "migrations", "0002_add_note.sql"))).toBe(false);
    expect(JSON.parse(readFileSync(lockPath, "utf8"))).toEqual({ "0001_a.sql": sha(EXISTING) });
  });

  it("aborts when the repos have diverged from each other (lockstep broken)", () => {
    writeFileSync(join(root, REPOS[1], "migrations", "0001_a.sql"), "-- drifted\n");
    const result = sync();
    expect(result.status).toBe(1);
    expect(result.output).toContain("lockstep broken");
    expect(existsSync(join(root, REPOS[0], "migrations", "0002_add_note.sql"))).toBe(false);
  });

  it("rejects a bad filename, and a number not higher than the locked maximum", () => {
    const badName = join(root, "incoming", "add_note.sql");
    writeFileSync(badName, NEW_SQL);
    expect(sync([], badName).output).toContain("not a valid migration name");

    const stale = join(root, "incoming", "0001_other.sql");
    writeFileSync(stale, NEW_SQL);
    const result = sync([], stale);
    expect(result.status).toBe(1);
    expect(result.output).toContain("must sort last");
  });

  it("rejects re-syncing an already-locked name with different content", () => {
    const edited = join(root, "incoming", "0001_a.sql");
    writeFileSync(edited, "-- edited\n");
    const result = sync([], edited);
    expect(result.status).toBe(1);
    expect(result.output).toContain("append-only");
  });

  it("fails clearly when an app repo's migrations folder is missing", () => {
    rmSync(join(root, REPOS[2], "migrations"), { recursive: true });
    const result = sync();
    expect(result.status).toBe(1);
    expect(result.output).toContain("migrations folder not found");
  });
});
