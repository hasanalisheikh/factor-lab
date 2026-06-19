# FactorLab Performance Pass

## Goal

Make the app materially faster without weakening run safety.

Primary user-visible pain:

- Active run pages refresh too slowly and make tab switching feel heavy.
- Run creation queues slowly.
- Worker pickup is too serial when multiple backtests are ready.
- Runs linger around persistence progress while the UI keeps fetching large artifacts.
- Compare and Jobs pages pull much more data than their first screen needs.

## Root-Cause Findings

- Active run detail fetched equity, positions, model predictions, reports, job state, and benchmark
  overlap before rendering any status. The poller then repeated those heavy loads while the run was
  still queued or running.
- `createRun` was protected by a server preflight, but the client submit path also called
  `preflightRun` before calling `createRun`, doubling expensive data-readiness work.
- The worker already fetched batches of queued jobs but processed backtest jobs sequentially.
- The worker uses process-wide `SIGALRM` timeouts, so thread-based backtest concurrency would be
  unsafe. Process-based concurrency is the cautious option.
- The Jobs page fetched the whole jobs table and relied on Supabase's implicit API cap.
- The Compare page loaded full paged equity histories for up to 40 completed runs before the user
  could interact with the page.

## Implementation Plan

1. Add worker concurrency tests for default-off behavior, bad env values, clamping, and job
   partitioning.
2. Implement opt-in process-based backtest concurrency guarded by `BACKTEST_WORKER_CONCURRENCY`.
   Keep default `1`, clamp to `8`, and leave ingest jobs sequential.
3. Add a run-detail regression test proving active runs do not call heavy artifact queries.
4. Load only run and job for active run detail pages; hydrate equity, positions, model predictions,
   reports, and overlap only after completion.
5. Add a Jobs page regression test for bounded queue loading, then query only the latest 100 jobs.
6. Add a run-form submit regression test, then remove the duplicate client preflight while keeping
   the server-side `createRun` preflight mandatory.
7. Add a Compare page regression test, then limit initial full-history compare hydration to the two
   runs the current UI selects by default.
8. Document `BACKTEST_WORKER_CONCURRENCY` in env and deployment docs.
9. Run focused tests, formatting, lint, typecheck, and relevant Python checks before completion.

## Risk Controls

- No server-side run validation is removed.
- Worker concurrency is opt-in and defaults to current sequential behavior.
- Backtest concurrency uses processes because the worker's alarm timeouts are process-global.
- Ingest jobs remain sequential to avoid multiple repair paths competing for the same ticker data.
- UI heavy-data gating is status-based and preserves full completed-run behavior.
