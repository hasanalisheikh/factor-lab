# FactorLab User Guide

FactorLab is a browser-based quantitative research platform. You queue a backtest run, the Python worker executes it, and results are displayed as interactive charts, tables, and a downloadable HTML tearsheet.

---

## Getting Started

### Accounts and Guest Mode

The app requires authentication. From `/login` you can:

- **Sign in** — email and password
- **Create account** — email and password (rate-limited: 10 per IP per hour)
- **Continue as Guest** — one click, no email required. Creates an isolated private account (`guest_<uuid>@factorlab.local`). Your data is fully private via row-level security.

Guest accounts are full accounts. You can upgrade a guest account to a named account at any time from **Settings → Account**.

All runs, jobs, and results are strictly private. User A cannot see User B's runs, even on a shared deployment.

---

## Creating a Run

Navigate to **New Run** in the sidebar.

### Run Parameters

| Field           | Description                                                                               |
| --------------- | ----------------------------------------------------------------------------------------- |
| **Run name**    | A label you choose for easy identification                                                |
| **Strategy**    | Which strategy to execute (see [Strategy Reference](strategies.md))                       |
| **Universe**    | The investable asset set: ETF8, SP100 subset, or NASDAQ100 subset                         |
| **Benchmark**   | Index for relative performance comparison: SPY, QQQ, IWM, VTI, EFA, EEM, TLT, GLD, or VNQ |
| **Start date**  | First date of the backtest                                                                |
| **End date**    | Last date (capped at the data cutoff — "Current through" date)                            |
| **Top N**       | Number of assets to hold. Capped by universe size and strategy constraints                |
| **Costs (bps)** | Transaction cost per rebalance per unit of turnover. Default: 10 bps                      |

Your default settings are saved in **Settings → Backtest** and pre-populate the form.

### Date Constraints

The earliest allowed start date depends on:

1. **Data availability** — the earliest date with sufficient price history in the database
2. **Strategy warmup** — each strategy requires a look-back window before the first rebalance:
   - `equal_weight`: no warmup
   - `momentum_12_1`: ~390 calendar days
   - `low_vol`: ~90 calendar days
   - `trend_filter`: ~390 calendar days
   - `ml_ridge` / `ml_lightgbm`: ~730 calendar days

The end date is always capped at the **data cutoff date** shown on the Data page.

---

## Preflight Check

When you submit the form, FactorLab runs a **preflight coverage check** before creating the run. This verifies that all required price data is available for the chosen universe, benchmark, and date range.

### Possible Outcomes

| Outcome                            | What Happens                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **All data ready**                 | Run is created with status `queued`; backtest starts immediately                                                                                       |
| **Data partially missing**         | Run is created with status `waiting_for_data`; data ingestion jobs are queued automatically; the backtest chains automatically when ingestion finishes |
| **Ticker inception date too late** | Run form shows an error with the minimum viable start date — no run is created                                                                         |

You never need to manually trigger data ingestion. If data is missing, the system handles it.

### Coverage Thresholds

- Benchmark: ≥ 99% coverage over the warmup-adjusted window
- Universe assets: ≥ 98% coverage (99% for momentum and ML strategies)

---

## Run Statuses

| Status             | Meaning                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `queued`           | Job is waiting for the Python worker to pick it up                               |
| `waiting_for_data` | Price data is being ingested; backtest will start automatically                  |
| `running`          | Worker is actively executing the backtest                                        |
| `completed`        | Backtest finished successfully; results are available                            |
| `failed`           | Job encountered an unrecoverable error (see the Jobs page for the error message) |

---

## Runs Page

The **Runs** page lists all your runs. You can filter by:

- Name (search bar)
- Status
- Strategy
- Universe

Rows with an active status (`queued`, `running`, `waiting_for_data`) show a mini progress bar and percentage under the status badge. The page polls automatically while any run is active.

### Deleting Runs

Each row has a context menu (three-dot icon) with a **Delete** option. Deleting a run removes the run and all associated data (equity curve, metrics, positions, reports). This cannot be undone.

---

## Run Detail Page

Click any completed run to open its detail page. Results are organized into tabs.

### Overview Tab

- **Equity curve** — portfolio NAV vs. benchmark NAV over the full run window, starting at $100,000
- **Key metrics** — CAGR, Sharpe, Max Drawdown (peak-to-trough), Volatility, Turnover (annualized), Win Rate, Profit Factor, Calmar
- **Run configuration card** — strategy, universe, benchmark, date range, costs, and disclaimer

### Holdings Tab

Current portfolio composition as of the most recent rebalance. Shows symbol, weight, and position size.

### Trades Tab

Full rebalance log — one entry per rebalance date showing what was bought and sold (the weight change) and the resulting one-way turnover for that rebalance date.

### ML Insights Tab (ML strategies only)

Shown only for `ml_ridge` and `ml_lightgbm` runs. Contains:

- **Feature importance** — which factors are driving the model's predictions (displayed as % contribution)
- **Predicted picks** — the model's most recent ranked asset list with predicted return
- **Realized vs. predicted** — how well the model's predictions corresponded to actual returns

---

## Downloading the Tearsheet

On any completed run, the Overview tab has a **Download Report** button that delivers a self-contained HTML tearsheet. Open it in any browser — it requires no internet connection.

The tearsheet includes:

- Full equity curve chart
- All performance metrics
- Holdings snapshot
- Strategy and benchmark configuration
- Research disclaimer

If no report has been generated yet (e.g., a newly completed run), click **Generate Report** first; the button appears in place of the download link.

---

## Comparing Runs

The **Compare** page lets you place two completed runs side-by-side: equity curves, metrics tables, and benchmark labels. Select Run A and Run B from the dropdowns.

---

## Data Page

The **Data** page shows the health of the price database. Understanding it helps you interpret why a run might be blocked or degraded.

### Data Cutoff Mode

FactorLab uses a singleton **data cutoff date** as the global dataset boundary:

| Label                             | Meaning                                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current through**               | The effective end date for all data. Backtests and coverage checks cap at this date.                                                           |
| **Backtest-ready** (Monthly mode) | Updated once per month via a scheduled refresh. All coverage checks are relative to the cutoff date. This is the default and most stable mode. |
| **Advanced** (Daily mode)         | Updated daily. Provides more recent data but may have partial ingest coverage until the nightly patch completes.                               |

If `ENABLE_DAILY_UPDATES=false` (the default), the system operates in Backtest-ready / Monthly mode. The daily patch route exists but exits without action.

### Universe Tier Summary

Assets are grouped by their earliest available start date ("tiers"). An asset listed as `2015+` has data going back to 2015. Choosing a run start date before an asset's tier will trigger the preflight WAITING_FOR_DATA flow or an inception-date block.

### Benchmark Coverage

Each supported benchmark has a coverage card showing:

- Ingested date range
- Coverage percentage vs. expected trading days
- Health status

### Benchmark Coverage Job Statuses

| Status                  | Meaning                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Good**                | Coverage ≥ 99% with no gaps > 5 days                                                                                        |
| **Warning**             | Coverage between 95–99% or a gap between 5–10 days                                                                          |
| **Degraded**            | Coverage < 95% or gap > 10 days                                                                                             |
| **Retrying…**           | A failed ingest is scheduled for automatic retry                                                                            |
| **Will retry at HH:MM** | Exponential backoff retry is scheduled                                                                                      |
| **Blocked**             | Permanent failure (e.g., invalid ticker, delisted). Requires manual intervention — click "Retry now" to force a new attempt |

### Diagnostics

The Data page includes an overall health assessment based on:

- Missing data rate across all ingested tickers
- Maximum gap length
- Benchmark-specific coverage

**Important:** The overall health score reflects the entire database window (up to 10 years). A run over a shorter window (e.g., 2020–2025) may pass preflight even if the DB-wide health shows a warning, because the preflight check is window-scoped.

---

## Benchmark Overlap Warning

If the selected benchmark ticker (e.g., SPY) is also an asset in the investable universe (e.g., the ETF8 universe includes SPY), the run detail page shows a **benchmark overlap** notice. This means the portfolio's return and the benchmark's return share a common component. The results are still valid — this is an expected and documented behavior of using broad ETF benchmarks with ETF universes.

---

## Jobs Page

The **Jobs** page shows all jobs associated with your runs:

- Data ingest jobs (status: queued, running, completed, failed, blocked)
- Backtest jobs (status: queued, running, completed, failed)

Each job shows its current stage and progress percentage. Hover over error badges for the full error message.

---

## Settings

### Backtest Defaults (Settings → Backtest)

Set default values for universe, benchmark, costs, top-N, initial capital, rebalance frequency, and date range. These pre-populate the New Run form.

### Account (Settings → Account)

- **Change password** — update your login password
- **Upgrade guest account** — convert a guest account to a named account with a real email address
- **Delete account** — permanently deletes your account and all associated runs and data. This cannot be undone.

---

## Troubleshooting

**Run is stuck in `queued` for a long time**
The Python worker may not be running. Check the Jobs page for error messages. If using Render, verify the background worker service is running.

**Run failed with "LightGBM unavailable"**
LightGBM is not installed in the worker environment. Install it: `pip install lightgbm`.

**Preflight blocks with "not enough training data"**
The ML strategies require ~730 calendar days of warmup. Move the start date earlier or use a longer date range.

**Data page shows "Blocked" for a benchmark**
The benchmark ticker returned a permanent error (invalid ticker, delisted). Click **Retry now** to force a fresh attempt. If it continues to fail, the ticker may need to be removed from the supported list.

**Chart does not render / shows blank**
Equity curve data may be missing for this run. Check the Jobs page for errors during the `persist` stage.

---

## Research Disclaimer

FactorLab generates historical simulations. Results reflect backtested performance of simplified rule-based or ML strategies. They do not constitute financial advice and are not a guarantee of future returns.
