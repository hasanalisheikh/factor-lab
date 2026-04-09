# FactorLab

FactorLab is a quantitative research platform for running, comparing, and exporting
equity factor backtests without writing code.

It combines a polished Next.js dashboard with Supabase-backed storage and a Python compute engine so
users can configure a strategy, queue a run, and review the results as charts, tables, and
downloadable HTML reports.

> **Research only.** FactorLab produces historical simulations, not live trading advice or future
> performance guarantees.

## Why It Stands Out

- **Six built-in strategies** spanning baseline, factor, regime, and walk-forward ML workflows
- **Preflight-first run creation** so missing data is detected before compute starts
- **Automatic data repair flow** that moves runs into `waiting_for_data` and resumes them when
  coverage is ready
- **Compare workbench** for side-by-side equity curves and KPI review across completed runs
- **Self-contained HTML reports** that can be generated and downloaded per run

## What FactorLab Covers

- Create historical backtests across ETF and equity universes
- Compare portfolio performance against a chosen benchmark
- Review holdings, rebalance activity, ML insights, and risk metrics
- Track dataset readiness from a Backtest-ready data page instead of internal maintenance tooling

For the full product walkthrough, see [docs/user-guide.md](docs/user-guide.md). For methodology,
see [docs/strategies.md](docs/strategies.md).

## Architecture At a Glance

- **Web app:** Next.js App Router dashboard for auth, run creation, result views, compare, and data
  readiness
- **Platform data layer:** Supabase Postgres, Auth, Storage, and row-level security
- **Background compute:** Python services process queued runs, data ingestion, and scheduled refresh
  work
- **Outputs:** equity curves, performance metrics, positions, model predictions, and HTML reports

The stable system overview lives in [docs/architecture.md](docs/architecture.md). Deployment and
operations live in [docs/deployment.md](docs/deployment.md).

## Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui
- **Backend:** Supabase Postgres, Auth, Storage, Server Actions
- **Compute:** Python, pandas, scikit-learn, LightGBM
- **Market data:** Yahoo Finance via `yfinance`, with optional Stooq fallback

## Run Locally

1. Install JavaScript dependencies:

   ```bash
   npm install
   ```

2. Copy the environment example:

   ```bash
   cp .env.example .env.local
   ```

3. Fill the required Supabase values in `.env.local`:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

4. Optional: install the Python engine if you want queued runs to execute locally:

   ```bash
   cd services/engine
   pip install -e .
   cd ../..
   ```

5. Start the app:

   ```bash
   npm run dev
   ```

`npm run dev` starts the web app and, when the engine is installed, a local background worker. Use
`SKIP_FACTORLAB_WORKER=1 npm run dev` for web-only development.

For schema setup, environment details, worker hosting, and scheduled refreshes, use
[docs/deployment.md](docs/deployment.md).

## Documentation

- [docs/user-guide.md](docs/user-guide.md) — user-facing workflow and product behavior
- [docs/strategies.md](docs/strategies.md) — strategy methodology and metrics reference
- [docs/architecture.md](docs/architecture.md) — system-level product architecture
- [docs/deployment.md](docs/deployment.md) — local setup, worker hosting, triggers, and operations
- [services/engine/README.md](services/engine/README.md) — engine-local commands
