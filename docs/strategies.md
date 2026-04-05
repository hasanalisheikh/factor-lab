# FactorLab Strategy Reference

FactorLab ships six strategies. All share a common framework, then diverge in their selection signal.

---

## Common Framework

| Dimension                  | Value                                                                       |
| -------------------------- | --------------------------------------------------------------------------- |
| **Rebalance frequency**    | Monthly (calendar month boundaries), except ML strategies which trade daily |
| **Portfolio construction** | Equal weight — each selected asset receives 1/k                             |
| **Transaction cost model** | `cost = (costs_bps / 10,000) × turnover` deducted at each rebalance         |
| **Default costs**          | 10 bps per rebalance (configurable per run)                                 |
| **Starting NAV**           | $100,000 for portfolio and benchmark                                        |
| **Benchmark**              | User-selected; rebased to $100,000                                          |

**Universe resolution** (priority order):

1. `runs.universe_symbols` snapshot — the source of truth once a run is created
2. Named preset: ETF8, SP100, or NASDAQ100
3. Env var `FACTORLAB_UNIVERSE`
4. Default: ETF8

---

## 1. Equal Weight (`equal_weight`)

**In plain English:** Hold every asset in the universe at equal weight. No filtering, no signal.

### Selection Logic

At each monthly rebalance, assign weight `1/N` to all `N` assets in the universe. All assets are held regardless of recent performance.

### How It Works

Weights drift as prices move through the month. At the start of each new month, the portfolio resets to `1/N` for every asset. This systematic sell-high/buy-low drift correction provides a mild contrarian tilt at no extra complexity.

### Assumptions

- Fully invested at all times
- No short selling
- All assets in the universe are tradeable on every rebalance date

### Strengths

- Maximum diversification within the universe
- Low turnover when holdings and target weights remain stable under the rebalance-target convention
- No look-ahead bias; no parameters to overfit
- Well-established academic baseline (DeMiguel et al., 2009)

### Weaknesses

- Pure beta exposure — no alpha generation
- No downside protection in bear markets
- Performance depends heavily on universe composition

### Warmup Requirement

None. Can start from the first available trading day.

---

## 2. Momentum 12-1 (`momentum_12_1`)

**In plain English:** Buy recent winners. Rank assets by their 12-month return (skipping the last month), then hold the top half with a positive score.

### Selection Logic

At each monthly rebalance:

1. Score each asset: `score = price(t−21) / price(t−252) − 1`
2. Keep only assets with `score > 0`
3. Select the top 50% by score
4. Equal-weight the selected assets

The 1-month skip (`price(t−21)` rather than `price(t)`) avoids the well-documented short-term reversal effect — using the most recent month's price would contaminate the signal.

### Assumptions

- 12-month price history required before first rebalance (≈390 calendar days of warmup)
- Lookback is purely price-based; no fundamental data

### Strengths

- Captures the well-documented cross-sectional momentum premium (Jegadeesh & Titman, 1993)
- Tends to outperform in trending, low-volatility bull markets
- Simple, transparent, and auditable

### Weaknesses

- Momentum crashes: strategy suffers sharp drawdowns during rapid regime reversals (e.g., crisis recoveries)
- Higher turnover than equal weight when rankings change significantly month to month
- May hold concentrated positions if only a few assets have positive momentum

### Warmup Requirement

**390 calendar days** before the run start date (needed for the 252-day price lookback).

---

## 3. Low Volatility (`low_vol`)

**In plain English:** Buy the quietest assets. Each month, rank by 60-day realized volatility and hold the least volatile top-N.

### Selection Logic

At each monthly rebalance:

1. Compute 60-day rolling realized volatility for each asset: `std(daily_returns, window=60)`
2. Sort ascending (lowest vol first)
3. Select the top-N least volatile assets
4. Equal-weight the selected assets

### Assumptions

- At least 60 daily data points required before first rebalance
- Volatility is unconditional (no correlation adjustment)

### Strengths

- Historically delivers risk-adjusted returns competitive with or better than the market (the low-volatility anomaly)
- Provides natural downside protection — low-vol assets tend to fall less in drawdowns
- Simple, stable signal that changes slowly month to month

### Weaknesses

- Can concentrate in defensive sectors (utilities, consumer staples, bonds in ETF8 context)
- May underperform in sharp momentum-driven rallies
- Does not explicitly optimize portfolio-level correlation

### Warmup Requirement

**90 calendar days** before the run start date (needed for the 60-day vol window).

---

## 4. Trend Filter (`trend_filter`)

**In plain English:** Use the benchmark's 200-day moving average as a market regime signal. Go risk-on (momentum selection from the universe) when the market is trending up; go all-in on bonds (TLT) when the market is trending down.

### Selection Logic

At each monthly rebalance:

1. Compare benchmark price to its 200-day simple moving average (SMA-200)
2. **Risk-on** (benchmark > SMA-200): apply Momentum 12-1 logic — select top-N assets from the universe with positive momentum scores, equal-weighted
3. **Risk-off** (benchmark ≤ SMA-200): allocate 100% to TLT (long-dated Treasury ETF)
   - If TLT is unavailable for the date range, falls back to BIL (T-Bill proxy)

### Fallback Behavior

- If no universe asset has a positive momentum score in risk-on mode, the strategy falls back to equal-weight across all universe assets for that month
- TLT must be ingested for the run date range; if missing, the job fails with a descriptive error

### Assumptions

- Benchmark data is required for the full run window (plus 200-day SMA warmup)
- TLT (or BIL as fallback) must be in the price dataset for risk-off periods
- The benchmark is **not** drawn from the investable universe

### Strengths

- Reduces drawdown during sustained bear markets (switches to bonds)
- Simple, intuitive regime-switching mechanism
- Inherits the momentum premium in bull markets

### Weaknesses

- Whipsawing in choppy, sideways markets (frequent regime switches, higher turnover)
- 100% bond allocation during extended risk-off periods means zero equity participation
- Performance is sensitive to the SMA window length (200 days is the canonical choice but not universal)

### Warmup Requirement

**390 calendar days** before the run start date (200-day SMA + momentum lookback).

---

## 5. ML Ridge — Walk-Forward (`ml_ridge`)

**In plain English:** Use machine learning (regularized linear regression) to predict each asset's next-day return, then hold the top-N predicted winners. Retrained weekly on expanding history.

### Selection Logic

Daily walk-forward:

1. Build a feature matrix: one row per (date, symbol) using 8 leakage-safe features (see below)
2. At each weekly refit boundary, train a Ridge regression model on all available history
3. Each day, predict next-day returns for all universe assets using the current model
4. Rank by predicted return; hold the top-N equal-weighted

### Features (8 total)

| Feature         | Definition                              |
| --------------- | --------------------------------------- |
| `mom_5d`        | 5-day trailing return                   |
| `mom_20d`       | 20-day trailing return                  |
| `mom_60d`       | 60-day trailing return                  |
| `mom_252d`      | 252-day trailing return                 |
| `vol_20d`       | Annualized 20-day rolling volatility    |
| `vol_60d`       | Annualized 60-day rolling volatility    |
| `drawdown_252d` | Max drawdown over the trailing 252 days |
| `beta_60d`      | Rolling 60-day beta to the benchmark    |

All features are computed from prices available up to date `t` only — no look-ahead.

### Model Specification

| Parameter             | Value                                                 |
| --------------------- | ----------------------------------------------------- |
| Model                 | `Ridge(α=1.0)` with `StandardScaler`                  |
| Training window       | Rolling 504-day minimum (expanding after 504 days)    |
| Minimum training days | 252 days of history before first prediction           |
| Refit frequency       | Weekly (every 5 trading days, `ML_REFIT_FREQ_DAYS=5`) |
| Annualization         | √252 (daily)                                          |

### ML Insights Tab

For ML runs, the run detail page shows an **ML Insights** tab with:

- Feature importance (model coefficients scaled as % contribution)
- Most recent predicted picks with rank and predicted return
- Realized vs. predicted return comparison

### Trainability Constraints

The model refuses to run (and the job fails with a diagnostic message) if:

- Fewer than 252 training days available at the first refit
- Average number of symbols per trading day is less than `max(top_n, 2)`
- Total training rows fall below `252 × top_n`

### Warmup Requirement

**730 calendar days** before the run start date.

### Strengths

- Combines multiple momentum/volatility signals into a single ranked prediction
- Walk-forward discipline eliminates look-ahead bias
- Interpretable: feature importances show which signals are driving picks

### Weaknesses

- Linear model — cannot capture non-linear factor interactions
- Small universe or short date ranges may not meet trainability thresholds
- Daily trading means higher turnover than monthly strategies

---

## 6. ML LightGBM — Walk-Forward (`ml_lightgbm`)

**In plain English:** Same framework as ML Ridge, but uses gradient-boosted trees instead of linear regression. May capture non-linear factor relationships.

### Differences from ML Ridge

| Aspect       | ml_ridge                      | ml_lightgbm                                                                       |
| ------------ | ----------------------------- | --------------------------------------------------------------------------------- |
| Model        | Ridge regression              | LightGBM gradient-boosted trees                                                   |
| Parameters   | `α=1.0`, StandardScaler       | `n_estimators=200`, `learning_rate=0.05`, `num_leaves=31`, `min_child_samples=20` |
| Failure mode | Fails if minimum data not met | Fails loudly if LightGBM not installed — no fallback to Ridge                     |
| Job timeout  | 15 min default                | 30 min default (configurable via `JOB_TIMEOUT_SECONDS_ML_LIGHTGBM`)               |

All other aspects (features, walk-forward schedule, refit frequency, warmup, ML Insights tab, trainability constraints) are identical to ML Ridge.

### Strengths

- Can learn non-linear interactions between features
- Gradient boosting often outperforms linear models when the training set is large enough

### Weaknesses

- More sensitive to small dataset sizes than Ridge
- Longer runtime — budget up to 30 minutes per run
- LightGBM must be installed in the worker environment (`pip install lightgbm`)

---

## Benchmark Overlap Warning

When the selected benchmark ticker (e.g., SPY) is also a member of the investable universe (e.g., ETF8 includes SPY), the run detail page shows a **benchmark overlap** warning. This is expected behavior — the strategy genuinely holds the benchmark asset — and does not invalidate results. The overlay simply notes that the portfolio return and benchmark return share a component.

---

## Metrics Glossary

| Metric              | Definition                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------- |
| **CAGR**            | `(final_NAV / 100,000)^(252/n_days) − 1`. Compound annual growth rate.                                                                               |
| **Sharpe**          | `(mean_daily_return / std_daily_return) × √252`. Risk-adjusted return; >1.0 is considered strong.                                                    |
| **Max Drawdown**    | Largest peak-to-trough NAV decline (%). Lower magnitude is better.                                                                                   |
| **Turnover (Ann.)** | `mean(rebalance_turnover after initial establishment) × periods/year`, using one-way turnover per rebalance date. No-change rebalances count as `0`. |
| **Volatility**      | `std(daily_returns) × √252`. Annualized total risk.                                                                                                  |
| **Win Rate**        | Fraction of trading days with a positive return. >50% means more up days than down.                                                                  |
| **Profit Factor**   | Total gains ÷ total losses. >1.0 means gains exceed losses in aggregate.                                                                             |
| **Calmar**          | `CAGR /                                                                                                                                              | Max Drawdown | `. Return per unit of maximum drawdown risk. |

> **Annualization note:** Monthly strategies annualize turnover by multiplying by 12; ML strategies (daily) use 252. Initial portfolio establishment is excluded from turnover, and no-change rebalance dates are included as `0`. All volatility and Sharpe calculations use √252 regardless of strategy.

---

## Research Disclaimer

All strategies are historical simulations using adjusted closing prices from Yahoo Finance. Results do not account for:

- **Survivorship bias** — universe presets are static and do not remove assets delisted during the backtest window
- **Market impact** — the cost model applies a flat `bps × turnover` rate; it does not model bid-ask spread, slippage, or short-selling costs
- **Tax drag** — no tax considerations are modeled

FactorLab is a research tool. Nothing here constitutes financial advice or a guarantee of future returns.
