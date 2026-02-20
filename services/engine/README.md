# FactorLab Engine

Python worker that polls queued jobs from Supabase, computes backtest outputs,
and writes `equity_curve` + `run_metrics` rows back to the database.

## Quick start

1. Set environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
2. Install:
   - `pip install -e .`
3. Run:
   - `factorlab-engine-worker`

Optional settings:
- `POLL_INTERVAL_SECONDS` (default: `5`)
- `JOB_BATCH_SIZE` (default: `3`)
- `FACTORLAB_UNIVERSE` comma-separated tickers for baseline strategies
