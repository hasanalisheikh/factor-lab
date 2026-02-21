# FactorLab

FactorLab is a hybrid quant research product with:
- Next.js dashboard (`app/`, `components/`)
- Supabase state/results/storage (`supabase/`)
- Python compute engine + worker (`services/engine/`)

## Core Product Scope

- Queue a run from `/runs/new`
- Track job lifecycle in `/jobs` (`queued/running/completed/failed`)
- Inspect results in `/dashboard`, `/runs`, `/runs/[id]`
- Compare strategy snapshots in `/compare`
- Download HTML tearsheets from run detail

## Architecture

- Frontend: Next.js App Router + TypeScript + Tailwind + shadcn/ui
- Database: Supabase Postgres
- Reports: Supabase Storage bucket (`reports`)
- Compute: Python worker polling `jobs`, writing `equity_curve` + `run_metrics`

## Job Lifecycle

- `jobs.status`: `queued | running | completed | failed`
- `jobs.stage`: `ingest | features | train | backtest | report`
- `jobs.progress`: `0..100`
- `jobs.error_message`: persisted worker error for debugging

Worker claims jobs with a conditional status transition (`queued -> running`) to prevent duplicate processing.

## Run Reproducibility

`runs` stores:
- `strategy_id`
- `benchmark_ticker`
- `costs_bps`
- `top_n`
- `run_params` (JSON)
- date range and status

## Known Limitations

- Universe selection can include survivorship bias depending on chosen tickers.
- Data quality/coverage depends on the ingestion source and available history.
- Transaction cost model is simplified (`costs_bps * turnover`) and does not model full execution microstructure.
- No live brokerage integration (research/backtest only).

## Local Setup

1. Install JS deps: `npm install`
2. Configure env vars (`.env.local`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Apply SQL:
   - `supabase/schema.sql`
   - `supabase/seed.sql`
   - migrations in `supabase/migrations/`
4. Run app: `npm run dev`
5. Run worker (from `services/engine` environment):
   - `factorlab-engine-worker`

## Test Commands

- Web typecheck: `npm run typecheck`
- Web lint: `npm run lint`
- Web tests: `npm run test:run`
- Engine tests: `PYTHONPATH=services/engine python3 -m pytest services/engine/tests -q`
