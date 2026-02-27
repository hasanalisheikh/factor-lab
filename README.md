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
- Browse strategy methodology and metrics glossary at `/strategies`
- Download HTML tearsheets from run detail

## Architecture

- Frontend: Next.js App Router + TypeScript + Tailwind + shadcn/ui
- Database: Supabase Postgres
- Reports: Supabase Storage bucket (`reports`)
- Compute: Python worker polling `jobs`, writing `equity_curve` + `run_metrics` + `positions`

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
- `universe` (preset label)
- `universe_symbols` (snapshotted symbol list — source of truth for execution)
- `run_params` (JSON)
- date range and status

At execution time the worker snapshots the resolved universe to `runs.universe_symbols`. This prevents config drift between the UI label and actual execution.

---

## Strategy Glossary & Methodology

### Common Framework

All strategies share the following framework:

| Dimension | Value |
|-----------|-------|
| **Rebalance frequency** | Monthly (calendar month boundaries) |
| **Portfolio construction** | Equal weight — each selected asset receives weight 1/k |
| **Transaction cost model** | `cost = (costs_bps / 10,000) × turnover`, deducted at each rebalance |
| **Default costs** | 10 bps (configurable per run) |
| **Benchmark** | SPY, rebased to starting NAV of $100,000 |
| **Starting NAV** | $100,000 for both portfolio and benchmark |

**Universe resolution** (priority order):
1. `runs.universe_symbols` snapshot (if already set — the source of truth)
2. Named preset from `runs.universe` (ETF8 / SP100 / NASDAQ100)
3. `FACTORLAB_UNIVERSE` env variable
4. Default: ETF8

**Available universe presets:**
- **ETF8**: 8 cross-asset ETFs — SPY, QQQ, IWM, EFA, EEM, TLT, GLD, VNQ
- **SP100**: 20 large-cap S&P 500 members (AAPL, MSFT, AMZN, GOOGL…)
- **NASDAQ100**: 20 Nasdaq-100 technology leaders (AAPL, MSFT, NVDA, AMZN…)

---

### equal_weight

**Rule:** At each monthly rebalance, assign weight 1/N to all N assets in the universe. No selection filtering — every asset is held.

| Field | Detail |
|-------|--------|
| Selection | All N assets in the universe |
| Weight per asset | 1/N (e.g., 12.5% each for ETF8) |
| Signal | None |
| Monthly turnover | ~8% (small drift correction) |

**How it works:** Weights drift as prices move over the month. On the first day of each new month the portfolio is reset to 1/N for all assets. This systematic buy-low/sell-high behaviour provides a mild contrarian tilt.

**Expectations:** Captures broad market beta. Studies (DeMiguel et al., 2009) show equal weighting often competes with optimized portfolios out-of-sample, particularly in regimes where the covariance matrix is difficult to estimate.

---

### momentum_12_1

**Rule:** At each rebalance, score assets by 12-month return skipping the most recent month, then hold the top 50% with a positive score.

| Field | Detail |
|-------|--------|
| Signal | `score = price(t−21) / price(t−252) − 1` |
| Why skip 1 month? | Short-term price reversal contaminates the signal; momentum is a 2–12 month phenomenon |
| Selection | Top 50% by score, positive scores only |
| Weight per asset | Equal weight among selected assets (1/k) |
| Monthly turnover | Moderate — changes as rankings shift |

**How it works:** `price(t−21)` is the price ~21 trading days ago (≈ 1 month). `price(t−252)` is the price ~252 trading days ago (≈ 12 months). The ratio captures 12-month price appreciation while deliberately excluding the most recent month's return.

**Expectations:** Tends to outperform in trending markets. Suffers in sharp regime reversals (e.g., crisis recoveries) — a known risk of cross-sectional momentum strategies. (Jegadeesh & Titman, 1993.)

---

### ml_ridge (Walk-Forward)

**Rule:** Walk-forward Ridge regression. Retrained monthly on expanding history. Ranks assets by predicted next-month return and holds the top N equal-weighted.

| Field | Detail |
|-------|--------|
| Features | 5 cross-sectional monthly factors (see below) |
| Target | Next month total return |
| Model | `Ridge(α=1.0)` with `StandardScaler` |
| Selection | Top N by predicted return (default N=10) |
| Weight | Equal weight among top N |
| Min training | 24 months before first prediction |
| Price warmup | 5 years before `run.start_date` |

**Features:**
| Name | Definition |
|------|-----------|
| `momentum` | 12-month trailing return |
| `reversal` | Inverted prior-month return (short-term mean reversion) |
| `volatility` | Annualized 6-month rolling standard deviation |
| `beta` | Rolling 12-month beta to benchmark |
| `drawdown` | Rolling 12-month max drawdown (price / rolling-max − 1) |

**Walk-forward discipline:** The model is retrained from scratch at each rebalance date using all available history before that date. There is zero look-ahead bias. This mirrors realistic out-of-sample deployment.

---

### ml_lightgbm (Walk-Forward)

Same framework as `ml_ridge`, substituting gradient-boosted trees for the linear model.

| Field | Detail |
|-------|--------|
| Model | `LGBMRegressor(n_estimators=300, learning_rate=0.05, num_leaves=31, min_child_samples=20)` |
| Fallback | Falls back to `Ridge(α=0.7)` if LightGBM is not installed |
| Features / Target / Walk-Forward | Identical to ml_ridge |

**Expectations:** May outperform Ridge when factor relationships are non-linear or interaction effects matter. More sensitive to small dataset sizes.

---

### How Rebalancing Works (example)

1. **Start of January:** ETF8 at equal weight — 12.5% in each of 8 ETFs.
2. **During January:** QQQ rallies +8%; TLT falls −3%. By month-end, QQQ ≈ 13.5%, TLT ≈ 12.1%.
3. **Month-end rebalance:** Engine computes turnover = sum(|new_weight − old_weight|) / 2. Sell 1% of QQQ, buy 0.4% of TLT (and smaller adjustments for others). Two-way turnover ≈ a few percent.
4. **Transaction cost deducted:** `10 bps × 0.03 turnover = 0.003%` drag on that day's return.
5. **February begins** with all assets back at 12.5%.

For momentum strategies, turnover is higher because the *set* of held assets can change entirely between months.

---

### Metrics Glossary

| Metric | Definition |
|--------|-----------|
| **CAGR** | Compound Annual Growth Rate. `(final_NAV / 100,000)^(252/n_days) − 1`. |
| **Sharpe** | `(mean_daily_return / std_daily_return) × √252`. Risk-adjusted return. > 1.0 is strong. |
| **Max Drawdown** | Largest peak-to-trough NAV decline (expressed as %). Lower magnitude is better. |
| **Turnover (Ann.)** | `mean(rebalance_turnover) × 12`. Annual portfolio replacement rate. 100% = entire book replaced once/year. |
| **Volatility** | `std(daily_returns) × √252`. Annualized total risk. |
| **Win Rate** | Fraction of periods with a positive return. > 50% means more up days than down. |
| **Profit Factor** | Total gains ÷ total losses. > 1.0 means gains exceed losses. |
| **Calmar** | `CAGR / |Max Drawdown|`. Return per unit of drawdown risk. |

---

## Known Limitations

- **Survivorship bias:** Universe presets are static. They do not account for assets delisted or replaced during the backtest window. This may overstate performance for long windows.
- **Simplified costs:** The cost model applies a flat `bps × turnover` rate. It does not model market impact, bid-ask spread, slippage, or short-selling costs.
- **Data quality:** Price data is sourced from Yahoo Finance via `yfinance`. Gaps are forward-filled; significant coverage gaps may affect results.
- **Research only:** No live brokerage integration. Results are historical simulations and should not be taken as a guarantee of future returns.

---

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
