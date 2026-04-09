# FactorLab User Guide

FactorLab is a browser-based research product for creating historical backtests, monitoring queued
runs, and reviewing results as charts, tables, and downloadable HTML reports.

For strategy methodology, use [docs/strategies.md](strategies.md). For system and deployment detail,
use [docs/architecture.md](architecture.md) and [docs/deployment.md](deployment.md).

## Getting Started

### Accounts and Guest Mode

The app requires authentication. From `/login` you can:

- sign in with email and password
- create an account with email and password
- continue as a guest with one click

Guest accounts are real private accounts with their own isolated data. You can upgrade a guest
account later from **Settings → Account**.

## Creating a Run

Navigate to **New Run** in the sidebar.

### Run Parameters

| Field               | Description                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------- |
| **Run name**        | A label to identify the backtest later.                                                  |
| **Strategy**        | The strategy to execute. See [docs/strategies.md](strategies.md) for methodology.        |
| **Universe**        | The investable asset set: ETF8, SP100 subset, or NASDAQ100 subset.                       |
| **Benchmark**       | The comparison ticker used for relative performance metrics.                             |
| **Start date**      | First date of the requested backtest window.                                             |
| **End date**        | Last date of the requested window, capped at the Data page's **Current through** cutoff. |
| **Top N**           | Maximum number of names to hold for strategies that rank or filter assets.               |
| **Costs (bps)**     | Transaction cost assumption applied to turnover.                                         |
| **Initial capital** | Starting portfolio value used for the run and benchmark series.                          |

Your default values are stored in **Settings → Backtest** and pre-fill the form.

### Date and Data Constraints

- Every run must span at least **730 calendar days**.
- The earliest viable start date also depends on available price history and strategy warmup.
- ML strategies need a longer usable history window than the monthly strategies.
- The end date never extends beyond the shared data cutoff shown on the Data page.

## Preflight and Queue Behavior

When you submit a run, FactorLab performs a preflight coverage check before compute starts.

| Outcome                        | What happens                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **All required data is ready** | The run is created with status `queued`.                                                                                                              |
| **Some data is missing**       | The run is created with status `waiting_for_data`; ingestion jobs are queued automatically, and the run starts when the missing coverage is repaired. |
| **The request is not viable**  | The form returns an error, such as an inception-date or training-history issue, and no run is created.                                                |

You do not manually start ingestion from the normal user flow. The platform handles the repair path
automatically.

## Run Statuses

| Status             | Meaning                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `queued`           | The run is waiting for background compute to claim it.                   |
| `waiting_for_data` | Required price coverage is being repaired before the backtest can start. |
| `running`          | The backtest is executing.                                               |
| `completed`        | Results are available.                                                   |
| `failed`           | The run stopped with an unrecoverable error.                             |

## Runs Page

The **Runs** page lists your runs and supports filtering by name, status, strategy, and universe.

- active runs show a live progress indicator
- the page refreshes automatically while runs are `queued`, `waiting_for_data`, or `running`
- deleting a run removes its associated result data and report

## Run Detail Page

Completed runs open into a tabbed detail view.

### Overview

- equity curve versus the selected benchmark
- drawdown chart
- KPI grid including CAGR, Sharpe, Max Drawdown, Volatility, Turnover, Win Rate, Profit Factor,
  and Calmar
- run configuration summary and research disclaimer

### Holdings

The Holdings tab shows a date-selected snapshot of the portfolio.

- monthly strategies show the stored holdings and weights for the selected rebalance date
- ML strategies show the selected names, weights, rank, predicted return, and realized return for
  the selected prediction date

### Trades

The Trades tab focuses on rebalance activity:

- a per-rebalance constituent turnover chart
- a rebalance log showing which names entered or exited

### ML Insights

ML runs include an **ML Insights** tab with feature importance, predicted picks, and realized versus
predicted return views.

## Reports

Completed runs support HTML report generation.

- if a report already exists, the run detail page shows **Download Report**
- if not, it shows **Generate Report**
- generated reports are self-contained HTML files you can open or share outside the app

## Compare

The **Compare** page lets you review two completed runs side by side.

Use it to compare:

- different strategies
- different Top N settings
- different cost assumptions
- a factor strategy versus a baseline run

## Data Page

The public/default Data page is a **Backtest-ready** view, not an internal maintenance console.

It focuses on:

- the shared **Current through** cutoff date
- overall data health for the monitored research window
- required ticker coverage and true missing days
- universe readiness and top issues that could affect backtests

For standard users, this page is about research readiness, not low-level repair controls or deep
diagnostics. Internal deployments may expose extra diagnostics, but they are not part of the normal
product flow.

## Jobs Page

The **Jobs** page shows the underlying backtest and data-ingest work associated with your runs.

- backtest jobs show status, stage, duration, and progress
- data-ingest jobs explain why a run may still be `waiting_for_data`
- failures surface their error messages here first

## Settings

### Backtest

Use **Settings → Backtest** to save defaults for:

- universe
- benchmark
- costs
- Top N
- initial capital
- preferred date range
- rebalance preference

### Account

Use **Settings → Account** to:

- change your password
- upgrade a guest account to a named account
- delete the account and its associated data

## Troubleshooting

**A run stays in `queued` for a long time**
Background compute may be unavailable. Check the Jobs page first. If you operate the deployment,
see [docs/deployment.md](deployment.md).

**A run stays in `waiting_for_data`**
The platform is still repairing missing coverage. Check the Jobs page and Data page for progress and
readiness context.

**An ML run fails quickly**
The selected window may not have enough usable training history, or the worker environment may not
have ML dependencies installed.

**The report button shows Generate instead of Download**
The run finished before a report was generated. Use **Generate Report** once; the button switches to
**Download Report** when the file is ready.

## Research Disclaimer

FactorLab produces historical simulations. Results are hypothetical, simplified, and not financial
advice.
