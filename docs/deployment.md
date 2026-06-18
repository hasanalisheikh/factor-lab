# FactorLab Deployment

This is the operator-facing setup and runtime document. It owns local setup, environment variables,
worker hosting, trigger behavior, and scheduled refresh expectations. For the system overview, see
[architecture.md](architecture.md).

## Runtime Model

FactorLab has two runtime responsibilities:

- **Web runtime** serves the dashboard, auth flows, server actions, and report/data endpoints.
- **Background compute** drains queued backtests, repairs missing price coverage, and processes
  scheduled refresh work.

Runs can move through `queued`, `waiting_for_data`, `running`, `completed`, and `failed`.
`waiting_for_data` is not a dead-end state: once the required ingest jobs settle successfully, the
run resumes automatically.

### Primary Compute Expectation

The intended production shape is:

- an **always-on worker service** that continuously polls queued work and exposes `/health` and
  `/trigger`
- an optional **GitHub Actions safety net** that can process queued work on schedule or via
  repository dispatch if the always-on service is unavailable

The repository already contains both pieces:

- [`render.yaml`](../render.yaml) defines an always-on worker service shape
- [`.github/workflows/run-worker.yml`](../.github/workflows/run-worker.yml) defines the scheduled
  and dispatchable fallback worker

Recruiter-facing docs should stay platform-neutral, but operator docs should treat the always-on
worker as the primary queue processor.

## Local Setup

### 1. Install JavaScript dependencies

```bash
npm install
```

### 2. Copy the environment file

```bash
cp .env.example .env.local
```

### 3. Configure Supabase

Minimum required values:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

### 4. Apply the database schema

For local development, install Docker Desktop and start it before using the Supabase CLI:

```bash
supabase start
supabase db reset
```

For a fresh hosted Supabase project, use the migration workflow below instead of pasting ad hoc SQL
into the dashboard.

### 5. Configure Supabase Auth

In Supabase Authentication:

- set the local site URL to `http://localhost:3000`
- add local and production redirect URLs for `/auth/callback`
- choose whether email confirmation is enabled for your environment

### 6. Optional: install the Python engine locally

```bash
cd services/engine
pip install -e ".[dev]"
cd ../..
```

### 7. Start the app

```bash
npm run dev
```

`npm run dev` starts the Next.js app and, when the engine command is available, starts the local
worker automatically. Use `SKIP_FACTORLAB_WORKER=1 npm run dev` if you intentionally want web-only
development.

## Worker Trigger Model

The app can wake background compute after queueing work.

- If `WORKER_TRIGGER_URL` points to a worker base URL, the app posts to `/trigger`.
- If `WORKER_TRIGGER_URL` points to a GitHub repository dispatch endpoint
  (`https://api.github.com/repos/<owner>/<repo>/dispatches`), the app sends a
  `repository_dispatch` event with `event_type: run-worker`.
- `WORKER_TRIGGER_SECRET` is sent as a bearer token for either path and must be configured anywhere
  trigger wake-ups are enabled.

This keeps the application code compatible with both an always-on worker service and the GitHub
fallback workflow without changing product behavior.

## Migration Workflow

Migrations are the source of truth for database changes. `supabase/schema.sql` is a readable schema
snapshot for humans, while `supabase/migrations/` is what local and remote database setup should
apply.

### Local or Fresh-Project Validation

Use this safe sequence for local validation and brand-new Supabase projects:

```bash
supabase start
supabase db reset
```

For a brand-new hosted project with no existing FactorLab schema or migration ledger, link the
project, confirm the target, and then apply migrations with `supabase db push`.

### Existing Remote Projects

Do not push this repository's baseline and timestamp-normalized migration history directly to a
non-empty remote project. This repository includes a baseline migration and timestamp-renamed
versions of older date-only migrations. Existing hosted projects may already have those schema
changes recorded under the old version names, so Supabase can treat the new filenames as unapplied.

Before any remote push to an existing project:

```bash
supabase projects list
supabase migration list --linked
```

Then complete all of the following:

- Take a database backup or confirm a recoverable restore point.
- Compare the linked migration ledger against the old date-only versions and the new timestamped
  versions in this repo.
- Verify the baseline schema objects already exist before marking the baseline applied.
- Repair only verified historical entries with `supabase migration repair --status applied
<version>`.
- Re-run `supabase migration list --linked` and confirm only genuinely new migrations are pending.

Only after that reconciliation should you run `supabase db push`. Never run `supabase db push`
against an unknown or unreconciled target. Record the target project, backup status, migration-ledger
comparison, repair commands, and push result in `docs/codebase-audit.md` when schema changes are
applied.

## Supported Production Paths

### Always-on worker service

Use this as the primary production compute path.

- Keep the worker process running continuously.
- It polls the queue, exposes `/health`, and accepts `/trigger` wake-ups only when the request uses
  the configured bearer token. If `WORKER_TRIGGER_SECRET` is unset, `/trigger` fails closed.
- The repo includes a Render blueprint in [`render.yaml`](../render.yaml), but any equivalent host
  is acceptable.

### GitHub Actions fallback

Use this as a backup path, not the main one.

- [`.github/workflows/run-worker.yml`](../.github/workflows/run-worker.yml) supports both scheduled
  execution and repository dispatch wake-ups.
- It runs the worker in `RUN_ONCE=1` mode.
- This path is useful for safety-net processing and emergency recovery, but it introduces higher
  queue latency than an always-on worker.

## Scheduled Refreshes

FactorLab supports two refresh mechanisms:

- **App-hosted cron routes** at `/api/cron/monthly-refresh` and `/api/cron/daily-refresh`
- **GitHub workflows** in `.github/workflows/` that can act as backup or maintenance jobs

Operational expectations:

- monthly refresh advances the stable Backtest-ready dataset
- daily refresh keeps the cutoff current when enabled
- backtests and coverage checks use the shared cutoff date rather than uncapped live data

`ENABLE_DAILY_UPDATES` defaults to `true` in the current codebase. Set it to `false` only if you
intentionally want the daily route to no-op.

## Environment Variables

See [`.env.example`](../.env.example) for a starter file. The variables below are the ones operators
should care about.

### Core application

| Variable                         | Required    | Notes                                                                                         |
| -------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`       | Yes         | Supabase project URL for web and worker code.                                                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Yes         | Public Supabase key for browser and server usage.                                             |
| `SUPABASE_SERVICE_ROLE_KEY`      | Yes         | Service-role key for privileged server and worker operations. Never expose it to the browser. |
| `NEXT_PUBLIC_SITE_URL`           | Recommended | Canonical site URL used for auth links in production.                                         |
| `SUPABASE_REPORTS_BUCKET`        | No          | Defaults to `reports`.                                                                        |
| `CRON_SECRET`                    | Conditional | Required when app-hosted cron routes are enabled.                                             |
| `SHOW_INTERNAL_DATA_DIAGNOSTICS` | No          | Defaults to `false`; exposes internal data diagnostics when set to `true`.                    |
| `SHOW_BACKTEST_WINDOW_AUDIT`     | No          | Defaults to `false`; exposes backtest-window audit details on the jobs page.                  |
| `SUPABASE_FETCH_TIMEOUT_MS`      | No          | Supabase server fetch timeout. Default `15000`.                                               |

### Worker and triggers

| Variable                                | Required    | Notes                                                            |
| --------------------------------------- | ----------- | ---------------------------------------------------------------- |
| `WORKER_TRIGGER_URL`                    | No          | Direct worker URL or GitHub repository dispatch endpoint.        |
| `WORKER_TRIGGER_SECRET`                 | Conditional | Required when trigger wake-ups are enabled.                      |
| `SKIP_FACTORLAB_WORKER`                 | No          | Local dev escape hatch for web-only startup.                     |
| `RUN_ONCE`                              | No          | Runs a single worker pass, used by GitHub Actions fallback jobs. |
| `POLL_INTERVAL_SECONDS`                 | No          | Worker poll interval. Default `5`.                               |
| `JOB_BATCH_SIZE`                        | No          | Maximum jobs claimed per poll cycle. Default `3`.                |
| `JOB_STALL_MINUTES`                     | No          | Stalled-job recovery threshold. Default `15`.                    |
| `JOB_QUEUED_TIMEOUT_MINUTES`            | No          | Queued-job timeout threshold. Default `10`.                      |
| `JOB_TIMEOUT_SECONDS`                   | No          | Default per-job execution timeout. Default `600`.                |
| `JOB_TIMEOUT_SECONDS_ML_RIDGE`          | No          | Ridge ML job timeout. Default `900`.                             |
| `JOB_TIMEOUT_SECONDS_ML_LIGHTGBM`       | No          | LightGBM job timeout. Default `1800`.                            |
| `PERSIST_TIMEOUT_SECONDS`               | No          | Timeout for result persistence. Default `600`.                   |
| `INGEST_MAX_RUNTIME_SECONDS`            | No          | Max ingest helper runtime per pass. Default `300`.               |
| `PORT`                                  | No          | Worker HTTP port. Default `8000`.                                |
| `SUPABASE_TRANSIENT_RETRY_ATTEMPTS`     | No          | Worker Supabase transient retry attempts. Default `3`.           |
| `SUPABASE_TRANSIENT_RETRY_BASE_SECONDS` | No          | Worker Supabase retry backoff base. Default `0.5`.               |

### Data and model tuning

| Variable                      | Required | Notes                                                                      |
| ----------------------------- | -------- | -------------------------------------------------------------------------- |
| `ENABLE_DAILY_UPDATES`        | No       | Defaults to `true`. Set to `false` to disable the daily refresh route.     |
| `FACTORLAB_FALLBACK_PROVIDER` | No       | Set to `stooq` to enable the fallback market-data source.                  |
| `FACTORLAB_UNIVERSE`          | No       | Optional comma-separated universe override for worker runs.                |
| `FACTORLAB_BENCHMARK`         | No       | Worker benchmark fallback. Default `SPY`.                                  |
| `ML_MIN_TRAIN_DAYS`           | No       | Minimum ML training history. Default `252`.                                |
| `ML_TRAIN_WINDOW_DAYS`        | No       | Rolling ML training window. Default `504`.                                 |
| `ML_REFIT_FREQ_DAYS`          | No       | ML refit cadence. Default `5`.                                             |
| `ML_WARMUP_YEARS`             | No       | Price-history fetch lookback for ML runs. Default `5`.                     |
| `ML_TOP_N`                    | No       | Default ML portfolio size when a run does not override it. Default `5`.    |
| `ML_COST_BPS`                 | No       | Default ML transaction cost when a run does not override it. Default `10`. |

### Optional platform integrations

| Variable                   | Required    | Notes                                                                          |
| -------------------------- | ----------- | ------------------------------------------------------------------------------ |
| `UPSTASH_REDIS_REST_URL`   | Recommended | Enables auth-related and manual ingest rate limiting. Configure in production. |
| `UPSTASH_REDIS_REST_TOKEN` | Recommended | Token for the Upstash Redis instance. Configure in production.                 |

## Engine Commands

Engine-local commands are documented in [services/engine/README.md](../services/engine/README.md).
Use that file for command-level usage and this file for repo-level deployment truth.
