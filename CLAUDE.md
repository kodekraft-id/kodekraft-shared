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
- Claude (and any subagent it dispatches) may commit locally but must NEVER
  run `git push` — Pram always pushes himself, for every repo, no
  exceptions.
