# QA Report

## What I tested

- Booted the app with `npm run dev` and exercised the live app in the browser.
- Loaded `/login`, `/runs`, `/runs/new`, `/runs/[id]`, `/data`, and `/settings`.
- Ran the guest flow end-to-end:
  - guest sign-in
  - run creation
  - waiting-for-data preflight
  - backtest completion
  - guest upgrade in settings with run history preserved
  - guest sign-out warning + sign-out
- Ran auth flows end-to-end with real browser sessions plus Supabase admin-generated links/users where email inbox access was not available:
  - unverified sign-in gating
  - verification link landing flow
  - verified sign-in
  - forgot-password request
  - recovery link -> reset password -> sign in with new password
  - normal sign-out
- Created a completed run with benchmark `QQQ` and verified the UI rendered `vs QQQ` instead of `vs SPY`.
- Loaded the Data page and confirmed the diagnostics toggle rendered and no timeout error surfaced.

## Bugs found

1. `data_ingest_jobs` worker writes were crashing against legacy schemas missing newer columns/status values.
2. Run creation failed instead of entering `waiting_for_data` when ingestion was already in progress.
3. Historical backfill jobs could be skipped as “already current” even when older history was still missing.
4. Backtests only loaded about 1000 price rows from Supabase, truncating multi-year runs to roughly 125 trading days for ETF8.
5. Recovery and verification links were broken because `/auth/callback` only handled query-string code exchange and the app did not hydrate auth sessions from URL hash tokens.
6. `/reset-password` was still protected by the auth proxy, which redirected valid recovery sessions back to `/login`.
7. The topbar user menu could throw transient client auth fetch errors during route changes.

## Fixes applied

- Added compatibility handling for legacy/new `data_ingest_jobs` schemas and status mappings.
- Changed run preflight to create/attach waiting runs instead of failing when active ingestion already exists.
- Fixed incremental ingest window resolution so current latest data does not suppress required historical backfills.
- Paginated `prices` reads in `fetch_prices_frame()` with deterministic ordering so large runs load the full dataset.
- Fixed auth callback + hash-token hydration for verification and password recovery flows.
- Allowed unauthenticated access to `/reset-password` and hydrated the reset session before submitting a new password.
- Guarded transient `supabase.auth.getUser()` failures in the topbar menu.

## Lightweight tests added / updated

- `lib/__tests__/equity-curve.test.ts`
- `lib/__tests__/data-ingest-jobs.test.ts`
- `services/engine/tests/test_worker_ingest_windows.py`
- `services/engine/tests/test_supabase_io.py`
