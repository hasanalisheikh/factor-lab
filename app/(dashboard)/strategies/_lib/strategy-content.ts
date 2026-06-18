export const strategies = [
  {
    id: "equal_weight",
    label: "Equal Weight",
    tag: "Baseline",
    tagVariant: "secondary" as const,
    summary:
      "Hold every asset in the universe at equal weight, reset monthly. The simplest possible diversification approach.",
    rule: "At each monthly rebalance, assign weight 1/N to all N assets in the universe.",
    selection: "All assets in the universe — no filtering.",
    weightScheme: "1/N per asset (e.g., 12.5% each for the 8-asset ETF8 universe).",
    turnover:
      "Moderate. Even with a stable universe, monthly price drift causes weights to deviate from 1/N. The drift-reset at each rebalance generates ongoing turnover (~15–30% annualized for a broad ETF universe).",
    signal: null,
    mlDetails: null,
    expectations:
      "Captures broad market beta. The implicit contrarian tilt (buying laggards, trimming winners) can outperform market-cap-weighted benchmarks over long horizons.",
    reference:
      "DeMiguel, Garlappi & Uppal (2009) — '1/N has no reason to underperform optimized portfolios.'",
  },
  {
    id: "momentum_12_1",
    label: "Momentum 12-1",
    tag: "Factor",
    tagVariant: "outline" as const,
    summary:
      "Rank assets by 12-month return excluding the most recent month, then hold the top N (run.top_n) with a positive score.",
    rule: "At each rebalance, score each asset by its 12-1 momentum and select the top N (run.top_n, clamped to universe size) with a positive score.",
    selection:
      "Top N assets (N = run.top_n, clamped to universe size) ranked by momentum score; only assets with a positive score qualify.",
    weightScheme: "Equal weight among selected assets (1/N).",
    turnover:
      "Variable. Measured as one-way weight change between consecutive monthly rebalance targets.",
    signal:
      "score = price(t−21 trading days) / price(t−252 trading days) − 1\n\nThe 1-month skip (t−21) removes short-term price reversal contamination. Momentum is a 2–12 month phenomenon.",
    mlDetails: null,
    expectations:
      "Outperforms in trending markets. Sharp reversals (e.g., crisis recoveries) cause outsized drawdowns — a known property of momentum strategies. When no asset has a positive momentum score, the strategy holds no equities (effectively cash) — flat equity-curve segments in the chart indicate these all-cash periods.",
    reference: "Jegadeesh & Titman (1993); Fama & French (1996).",
  },
  {
    id: "ml_ridge",
    label: "ML Ridge",
    tag: "ML · Walk-Forward",
    tagVariant: "outline" as const,
    summary:
      "Daily walk-forward Ridge regression trained on 8 cross-sectional features using a rolling 2-year training window. Portfolio is rebalanced every trading day; model is refitted every 5 trading days.",
    rule: "Each trading day, rank assets by predicted next-day return and hold the top N equal-weighted. Model refitted every 5 trading days on the most recent 504 trading days of data.",
    selection:
      "Top N assets by predicted return (N = run.top_n). In practice, FactorLab needs roughly 2 years of usable history before the backtest becomes trainable.",
    weightScheme: "Equal weight among the top-N selected assets.",
    turnover: "High. Daily rebalancing drives nominal turnover; annualized at 252 periods/year.",
    signal: null,
    mlDetails: {
      features: [
        {
          name: "mom_5d",
          desc: "5-day momentum: price / price.shift(5) − 1. Short-term price continuation signal.",
        },
        {
          name: "mom_20d",
          desc: "~1-month momentum: price / price.shift(20) − 1.",
        },
        {
          name: "mom_60d",
          desc: "~3-month momentum: price / price.shift(60) − 1.",
        },
        {
          name: "mom_252d",
          desc: "~12-month momentum: price / price.shift(252) − 1. No 1-month skip applied.",
        },
        {
          name: "vol_20d",
          desc: "20-day rolling standard deviation of daily returns. Short-term risk proxy.",
        },
        {
          name: "vol_60d",
          desc: "60-day rolling standard deviation of daily returns. Medium-term risk proxy.",
        },
        {
          name: "drawdown_252d",
          desc: "252-day trailing drawdown: price / rolling_max(252d) − 1. Captures recent price weakness relative to peak.",
        },
        {
          name: "beta_60d",
          desc: "60-day rolling beta to the benchmark. Measures recent systematic risk exposure.",
        },
      ],
      target: "Next-day total return.",
      model:
        "Ridge(α=1.0) with StandardScaler preprocessing. L2 regularization shrinks coefficients to reduce cross-sectional overfitting.",
      warmup:
        "Requires roughly 2 calendar years of usable history before the first stored prediction. FactorLab also fetches a longer pre-run window for feature construction.",
      walkForward:
        "Refitted every 5 trading days using a rolling 504-trading-day (~2-year) window; portfolio selection is performed daily. No look-ahead bias.",
    },
    expectations:
      "Aims to combine multiple factor signals with a regularized model. Performance depends on regime stability; walk-forward discipline ensures realistic out-of-sample simulation.",
    reference: null,
  },
  {
    id: "ml_lightgbm",
    label: "ML LightGBM",
    tag: "ML · Walk-Forward",
    tagVariant: "outline" as const,
    summary:
      "Same daily walk-forward framework as ML Ridge, but uses gradient-boosted trees to capture non-linear feature interactions.",
    rule: "Identical to ML Ridge, substituting a LightGBM regressor for the Ridge model. Refitted every 5 trading days on a rolling 504-day window.",
    selection:
      "Top N assets by predicted next-day return (N = run.top_n). In practice, FactorLab needs roughly 2 years of usable history before the backtest becomes trainable.",
    weightScheme: "Equal weight among selected assets.",
    turnover: "High. Daily rebalancing drives nominal turnover; annualized at 252 periods/year.",
    signal: null,
    mlDetails: {
      features: [
        { name: "mom_5d", desc: "5-day momentum: price / price.shift(5) − 1." },
        { name: "mom_20d", desc: "~1-month momentum: price / price.shift(20) − 1." },
        { name: "mom_60d", desc: "~3-month momentum: price / price.shift(60) − 1." },
        { name: "mom_252d", desc: "~12-month momentum: price / price.shift(252) − 1." },
        { name: "vol_20d", desc: "20-day rolling standard deviation of daily returns." },
        { name: "vol_60d", desc: "60-day rolling standard deviation of daily returns." },
        {
          name: "drawdown_252d",
          desc: "252-day trailing drawdown: price / rolling_max(252d) − 1.",
        },
        { name: "beta_60d", desc: "60-day rolling beta to benchmark." },
      ],
      target: "Next-day total return.",
      model:
        "LGBMRegressor(n_estimators=200, learning_rate=0.05, num_leaves=31, min_child_samples=10). Fails with a clear error if LightGBM is not installed — no silent fallback occurs. Install with: pip install 'lightgbm>=4.5.0'.",
      warmup:
        "Requires roughly 2 calendar years of usable history before the first stored prediction. FactorLab also fetches a longer pre-run window for feature construction.",
      walkForward:
        "Refitted every 5 trading days using a rolling 504-trading-day (~2-year) window; portfolio selection is performed daily. No look-ahead bias.",
    },
    expectations:
      "May outperform Ridge when factor relationships are non-linear or interaction effects are important. More sensitive to small dataset sizes.",
    reference: null,
  },
  {
    id: "low_vol",
    label: "Low Volatility",
    tag: "Factor",
    tagVariant: "outline" as const,
    summary:
      "Rank assets by 60-day realized volatility and hold the lowest-vol names. Targets the low-volatility anomaly: lower-risk assets tend to deliver superior risk-adjusted returns over time.",
    rule: "At each monthly rebalance, compute 60-day realized volatility (std of daily returns) for every asset. Select the top N with the lowest vol and equal-weight the selection.",
    selection:
      "Top N assets by lowest 60-day realized vol (N = run.top_n, clamped to universe size). Requires ≥ 60 daily data points before the first selection.",
    weightScheme: "Equal weight among selected assets (1/N).",
    turnover:
      "Low to moderate. Vol rankings are persistent month-to-month; turnover spikes mainly when a high-vol event shifts the ranking.",
    signal:
      "vol_60 = std(daily_returns, window=60 trading days)\n\nAssets ranked ascending by vol_60. The N lowest-vol names are selected.",
    mlDetails: null,
    expectations:
      "Tends to outperform in choppy or declining markets where low-volatility assets hold up better. Typically lags in strong bull markets when high-beta growth assets surge. Complements momentum-based strategies whose largest drawdowns coincide with volatility spikes.",
    reference:
      "Baker, Bradley & Wurgler (2011) — 'Benchmarks as Limits to Arbitrage: Understanding the Low-Volatility Anomaly.'",
  },
  {
    id: "trend_filter",
    label: "Trend Filter",
    tag: "Macro",
    tagVariant: "outline" as const,
    summary:
      "A regime-switching overlay: hold momentum-selected assets when the benchmark is in an uptrend, and rotate to bonds (TLT) when the benchmark falls below its 200-day moving average.",
    rule: "At each monthly rebalance: if benchmark close > 200-day SMA → risk-on (hold Momentum 12-1 selection from universe); if benchmark close ≤ 200-day SMA → risk-off (100% TLT). Falls back to BIL (cash proxy) if TLT data is unavailable.",
    selection:
      "Risk-on: top N assets (N = run.top_n, clamped to universe size) by Momentum 12-1 score with a positive score (equal-weight universe when no asset qualifies). Risk-off: 100% TLT (BIL fallback). Requires ≥ 200 daily benchmark data points to compute the 200-day SMA.",
    weightScheme:
      "Equal weight among risk-on selected assets. 100% single-asset weight when risk-off.",
    turnover:
      "Variable and regime-dependent. Transitions between risk-on and risk-off generate near-full-portfolio turnover; sustained regimes produce normal momentum turnover.",
    signal:
      "Trend signal: benchmark_close > SMA(benchmark_close, 200)\n\nRisk-on  → Momentum 12-1 selection (top N = run.top_n, positive score only).\nRisk-off → 100% TLT (or BIL if TLT unavailable).\n\nMethodology note: Risk-on when benchmark > 200D SMA; risk-off allocates to TLT.",
    mlDetails: null,
    expectations:
      "Designed to reduce drawdowns during sustained bear markets by rotating into safety. May underperform in whipsaw markets where the 200D SMA triggers false switches. Tends to lag recovery entries after swift reversals, and will underperform buy-and-hold in a straight-up bull market.",
    reference: "Faber (2007) — 'A Quantitative Approach to Tactical Asset Allocation.'",
  },
];

export const metricDefs = [
  {
    name: "CAGR",
    full: "Compound Annual Growth Rate",
    desc: "Annualized total return. Formula: (final_NAV / initial_NAV)^(252 / trading_days) − 1. Higher is better.",
  },
  {
    name: "Sharpe",
    full: "Sharpe Ratio",
    desc: "Risk-adjusted return: (mean_daily_return / std_daily_return) × √252. Measures excess return per unit of daily volatility. > 1.0 is generally considered strong.",
  },
  {
    name: "Max DD",
    full: "Maximum Drawdown",
    desc: "Largest peak-to-trough decline in portfolio NAV, expressed as a percentage. Measures the worst historical loss from any peak. Lower magnitude is better.",
  },
  {
    name: "Turnover (Ann.)",
    full: "Annualized Turnover",
    desc: "Average annual fraction of the portfolio replaced. Computed as mean(one-way turnover over rebalance dates after initial establishment) × periods/year. Monthly strategies use 12; daily ML strategies use 252. No-change rebalances count as 0.",
  },
  {
    name: "Volatility",
    full: "Annualized Volatility",
    desc: "Standard deviation of daily returns × √252. Measures total portfolio risk regardless of direction.",
  },
  {
    name: "Win Rate",
    full: "Win Rate",
    desc: "Fraction of trading days with a positive portfolio return. > 50% means more up days than down days.",
  },
  {
    name: "Profit Factor",
    full: "Profit Factor",
    desc: "Total gains ÷ total losses. > 1.0 means cumulative gains exceed cumulative losses. A value of 1.5 means $1.50 gained for every $1.00 lost.",
  },
  {
    name: "Calmar",
    full: "Calmar Ratio",
    desc: "CAGR ÷ |Max Drawdown|. Measures annualized return per unit of drawdown risk. Higher is better; > 1.0 means annual return exceeds worst drawdown.",
  },
];
