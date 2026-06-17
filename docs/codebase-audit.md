# FactorLab Codebase Audit

## Status

This ledger tracks stabilization findings and their disposition. Secret values are intentionally not
recorded here; environment checks should confirm key presence only.

## Structural findings

| Area              | Finding                                                                     | Status      | Evidence / next action                                                                                                                                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent policy      | `CLAUDE.md` duplicated shared policy while `AGENTS.md` was untracked.       | Resolved    | Task 1 replaces `AGENTS.md` as the canonical source and reduces `CLAUDE.md` to a pointer.                                                                                                                                                                                                               |
| PRD               | PRD lived outside the repo at `/Users/hasansheikh/Downloads/Factor Lab.md`. | Resolved    | Task 1 imports the PRD into `docs/prd.md`; expected heading `FactorLab — Product Requirements Document (PRD)` is present in the source document.                                                                                                                                                        |
| Generated files   | `services/engine/factorlab_engine.egg-info/` is tracked generated output.   | Planned     | Task 2 should ignore and remove generated package metadata from the git index without deleting local artifacts.                                                                                                                                                                                         |
| File size         | Multiple hand-written source files exceed the 500-line hard maximum.        | In progress | Current measurements: `lib/supabase/queries.ts` 2852, `services/engine/factorlab_engine/supabase_io.py` 2158, `services/engine/factorlab_engine/worker.py` 2102, `app/actions/runs.ts` 1694, `lib/coverage-check.ts` 1386, `components/auth/login-form.tsx` 1200, `components/run-form.tsx` 1173 lines. |
| File-length guard | No automated source line-count guard exists yet.                            | Planned     | `AGENTS.md` now lists `npm run check:file-length` as part of the full suite once Task 2 adds the guard; until large-file refactors land, the guard is expected to fail on current oversized files.                                                                                                      |

## Performance findings

| Area             | Finding                                                                    | Status      | Evidence / next action                                                                                          |
| ---------------- | -------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| Query fan-out    | Dashboard and run views depend on large shared query/action modules.       | In progress | Oversized modules listed above should be split first so performance work can be measured and optimized locally. |
| Worker latency   | Python worker and Supabase I/O modules are too large to audit efficiently. | In progress | Characterization and timing measurements are needed before changing worker behavior.                            |
| Baseline metrics | No fresh performance baseline is recorded in this audit yet.               | Planned     | Add route/query/job timing after Task 1 so optimization changes have before/after evidence.                     |

## Migration and environment findings

| Area              | Finding                                                                         | Status                   | Evidence / next action                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker            | Initial audit found Supabase blocked because Docker was unavailable.            | Resolved                 | Context update confirms Docker Desktop is installed and running; local check reports Docker server version `29.5.3`.                                                             |
| Local Supabase    | Initial audit could not run local Supabase setup.                               | Resolved                 | Context update confirms Supabase local setup now runs and `supabase db reset` completed successfully from scratch.                                                               |
| Migration order   | Earlier migration filenames lacked full timestamp ordering.                     | In progress              | Current working tree contains timestamped migration files such as `20260221070000_phase7_reporting.sql`; these setup changes are outside Task 1 commit scope.                    |
| Local env         | Local environment needs core Supabase, worker trigger, cron, and site URL keys. | Resolved for local setup | Context update confirms `.env.local` has core keys plus generated local `CRON_SECRET`, `WORKER_TRIGGER_SECRET`, and `NEXT_PUBLIC_SITE_URL`; values are not printed or committed. |
| Remote migrations | Remote Supabase migration target must be confirmed before applying changes.     | Planned                  | Future remote migration work must capture the target project and migration list before applying migrations.                                                                      |

## Security findings

| Area                  | Finding                                                            | Status      | Evidence / next action                                                                              |
| --------------------- | ------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------- |
| Secret handling       | Agents need explicit rules to avoid leaking env and service keys.  | Resolved    | Task 1 adds environment safety rules to `AGENTS.md`; audit records key presence only, never values. |
| RLS and isolation     | RLS, guest isolation, and report ownership need a focused review.  | Planned     | Audit migrations and Supabase access paths after setup stabilization.                               |
| Service-role boundary | Service-role usage must stay server-only and narrowly scoped.      | Planned     | Review Next.js actions, route handlers, and worker code in later security tasks.                    |
| Cron and worker auth  | Cron and worker trigger secrets must be required and rate-limited. | In progress | Local secrets are reported generated by context; code-level enforcement still needs review.         |
