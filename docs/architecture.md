# FactorLab Architecture

This document is the stable, high-level system view for FactorLab. For setup, hosting, and
environment variables, see [deployment.md](deployment.md). For user-facing behavior, see
[user-guide.md](user-guide.md).

## System Overview

FactorLab is organized around four layers:

- **Next.js dashboard** for authentication, run creation, result views, Compare, Data, and report
  actions
- **Supabase platform services** for Postgres, Auth, Storage, and row-level security
- **Background Python compute** for queued backtests, price ingestion, and scheduled refresh work
- **Presentation outputs** including equity curves, metrics, holdings, trades, ML insights, and
  HTML reports

## Request Flow

1. A user creates a run from the dashboard by choosing a strategy, universe, benchmark, and date
   range.
2. Server-side preflight checks validate the request, snapshot the run configuration, and inspect
   required price coverage.
3. If coverage is healthy, the run is queued immediately. If coverage is incomplete, the run moves
   to `waiting_for_data` while ingestion jobs repair the missing window.
4. Background compute claims queued work, loads the required prices, runs the strategy, computes the
   result set, and persists the outputs.
5. The dashboard reads those stored outputs to render the run detail page, Compare view, Jobs page,
   and downloadable report actions.

## Run Lifecycle

FactorLab exposes a small user-visible run state machine:

| Status             | Meaning                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `queued`           | The run is ready for compute and waiting to be claimed.            |
| `waiting_for_data` | Missing price coverage is being repaired before the run can start. |
| `running`          | Background compute is executing the run.                           |
| `completed`        | Outputs are available in the dashboard.                            |
| `failed`           | The run stopped with an unrecoverable error.                       |

This is the core product story. Internal job stages and deployment mechanics are intentionally kept
out of recruiter-facing surfaces and documented in [deployment.md](deployment.md) only where needed.

## Backtest-Ready Data Model

FactorLab centers the public data story on a single shared dataset boundary:

- The platform tracks a global **Current through** cutoff date.
- Backtests and coverage checks are evaluated against that cutoff, not against arbitrary newer data.
- The public/default Data page focuses on **Backtest-ready** coverage for required research windows
  and supported ticker sets.
- Scheduled refreshes and preflight-triggered ingestion jobs move the dataset forward in the
  background.

Internal diagnostics may exist behind deployment gates, but they are not part of the normal
product-facing flow and should not shape recruiter-facing documentation.

## Source-of-Truth Boundaries

- Use [user-guide.md](user-guide.md) for the normal product workflow.
- Use [strategies.md](strategies.md) for strategy methodology, warmups, and metrics definitions.
- Use [deployment.md](deployment.md) for environment variables, worker hosting, triggers, and
  scheduled operations.
