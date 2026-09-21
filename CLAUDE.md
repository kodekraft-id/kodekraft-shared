# kodekraft online-invitation — kodekraft-shared

This repo is one of 5 siblings in the kodekraft online-invitation system —
the shared npm package (`@kodekraft/shared`), consumed by the other 4 app
repos as a git-protocol pnpm dependency, tag-pinned. The master planning hub
and cross-repo progress tracker live in the sibling repo
`invitation-worker-landing`:

- `../invitation-worker-landing/project-docs/14-progress-tracker.md` —
  **read this first**, in any session, before starting or resuming any task
  work in this system.
- `../invitation-worker-landing/project-docs/13-project-structure-and-local-setup.md` —
  full repo layout / fresh-machine setup for all 5 repos.
- `../invitation-worker-landing/project-docs/12-cross-repo-integration-design.md` —
  this package's own design (scope, exports map, ownership matrix, release
  policy).

This package has no task breakdown of its own — its tasks are tracked
inside `invitation-worker-landing`'s breakdown as `BE-mono-*`/`OPS-mono-*`/
`OPS-shared-*` task IDs (see the tracker above for current status).

Release process: see `RELEASING.md` and `scripts/classify-release.mjs` in
this repo. Semver policy: `0.x`, minor = matrix/export-surface change,
patch = implementation-only fix, no `1.0.0` until stable across one full
feature cycle across all 4 app repos.

## Standing project rules (apply to every repo in this system)

- Never add a `Co-Authored-By: Claude` or any other Claude/Anthropic
  attribution line to any commit message — commits are authored solely by
  Pram.
- **Subagents** may commit locally but must NEVER run `git push` — a
  subagent's work is pushed only by the orchestrating session, after that
  session has independently verified it.
- The **main session** may push to the app repos and `kodekraft-shared`
  (Pram granted this on 2026-09-20, replacing the earlier "never push"
  rule), and may create and push **tags** (Pram granted this on 2026-09-21
  and confirmed it is **permanent**, replacing the earlier "tags are Pram's
  alone" rule). Follow `kodekraft-shared/RELEASING.md` §3 for which version
  a change warrants, and remember the lockstep-DDL rule: a
  `migrations.lock.json` change is a minor bump, and the 4 app repos' pins
  move with it.
- Still Pram's alone, never Claude's: anything touching **production** —
  `wrangler deploy`, `wrangler secret put`, and any D1 command with
  `--remote`.
