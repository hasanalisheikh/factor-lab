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

Product requirements and stabilization history are tracked in [docs/prd.md](docs/prd.md) and
[docs/codebase-audit.md](docs/codebase-audit.md). Contributor and coding-agent rules live in
[AGENTS.md](AGENTS.md).

The repository layout guide lives in [docs/repository-structure.md](docs/repository-structure.md);
it explains which root files are required by tools and which generated folders should stay hidden or
ignored. For the cleanest VS Code explorer view, open
[factor-lab.code-workspace](factor-lab.code-workspace).

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

## Validation

Run the standard web checks before committing code changes:

```bash
npm run format
npm run lint
npm run typecheck
```

Run the full local validation suite before release or broad refactors:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run check:file-length
```

For Python engine changes:

```bash
cd services/engine
ruff format .
ruff check .
pytest
```

## Documentation

- [docs/user-guide.md](docs/user-guide.md) — user-facing workflow and product behavior
- [docs/strategies.md](docs/strategies.md) — strategy methodology and metrics reference
- [docs/architecture.md](docs/architecture.md) — system-level product architecture
- [docs/deployment.md](docs/deployment.md) — local setup, worker hosting, triggers, and operations
- [docs/repository-structure.md](docs/repository-structure.md) — folder layout and root-file policy
- [docs/agents/README.md](docs/agents/README.md) — agent entrypoint and explorer hygiene notes
- [docs/prd.md](docs/prd.md) — product requirements and implementation status
- [docs/codebase-audit.md](docs/codebase-audit.md) — stabilization audit, migration notes, and
  security findings
- [AGENTS.md](AGENTS.md) — contributor and automated-agent rules
- [services/engine/README.md](services/engine/README.md) — engine-local commands
