import { AppShell } from "@/components/layout/app-shell";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

// ── Data ──────────────────────────────────────────────────────────────────────

const strategies = [
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
      "Low under the rebalance-target convention. Turnover only appears when holdings or target weights change.",
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
      "Outperforms in trending markets. Sharp reversals (e.g., crisis recoveries) cause outsized drawdowns — a known property of momentum strategies.",
    reference: "Jegadeesh & Titman (1993); Fama & French (1996).",
  },
  {
    id: "ml_ridge",
    label: "ML Ridge",
    tag: "ML · Walk-Forward",
    tagVariant: "outline" as const,
    summary:
      "Walk-forward Ridge regression trained on 7 cross-sectional features. Retrained each month using all available history.",
    rule: "Each month, retrain a Ridge regressor on all past data, rank assets by predicted next-month return, and hold the top N equal-weighted.",
    selection: `Top N assets by predicted return (N = run.top_n, default 10). Requires ≥ 24 months of training history before first prediction.`,
    weightScheme: "Equal weight among the top-N selected assets.",
    turnover:
      "Variable. Daily one-way turnover annualized at 252; initial portfolio establishment is excluded.",
    signal: null,
    mlDetails: {
      features: [
        {
          name: "momentum_12_1",
          desc: "12-month momentum: price(t−1mo) / price(t−12mo) − 1. The 1-month skip removes short-term reversal contamination.",
        },
        {
          name: "momentum_6_1",
          desc: "6-month momentum: price(t−1mo) / price(t−6mo) − 1. Captures intermediate-term trends at a shorter horizon.",
        },
        {
          name: "reversal_1m",
          desc: "Short-term reversal: −(prior-month return). Negative sign exploits mean-reversion of the most recent month.",
        },
        {
          name: "vol_20d",
          desc: "20-day rolling daily return standard deviation, sampled at month-end. Short-term risk proxy.",
        },
        {
          name: "vol_60d",
          desc: "60-day rolling daily return standard deviation, sampled at month-end. Medium-term risk proxy.",
        },
        {
          name: "beta_60d",
          desc: "60-day rolling beta to the benchmark. Measures recent systematic risk exposure.",
        },
        {
          name: "drawdown_6m",
          desc: "6-month (126-day) max drawdown: price / rolling_max(126d) − 1. Captures recent price weakness.",
        },
      ],
      target: "Next month total return.",
      model:
        "Ridge(α=1.0) with StandardScaler preprocessing. L2 regularization shrinks coefficients to reduce cross-sectional overfitting.",
      warmup:
        "Requires ≥ 24 months of training history before the first prediction. Price data is fetched with a 5-year lookback before run.start_date to build the initial training set.",
      walkForward:
        "The model is retrained from scratch at every rebalance date, using all available history up to (but not including) that date. There is no look-ahead bias.",
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
      "Same walk-forward framework as ML Ridge, but uses gradient-boosted trees to capture non-linear feature interactions.",
    rule: "Identical to ML Ridge, substituting a LightGBM regressor for the Ridge model.",
    selection: "Top N assets by predicted return.",
    weightScheme: "Equal weight among selected assets.",
    turnover:
      "Variable. Daily one-way turnover annualized at 252; initial portfolio establishment is excluded.",
    signal: null,
    mlDetails: {
      features: [
        { name: "momentum_12_1", desc: "12-month momentum: price(t−1mo) / price(t−12mo) − 1." },
        { name: "momentum_6_1", desc: "6-month momentum: price(t−1mo) / price(t−6mo) − 1." },
        { name: "reversal_1m", desc: "Short-term reversal: −(prior-month return)." },
        { name: "vol_20d", desc: "20-day rolling daily return std, sampled at month-end." },
        { name: "vol_60d", desc: "60-day rolling daily return std, sampled at month-end." },
        { name: "beta_60d", desc: "60-day rolling beta to benchmark." },
        {
          name: "drawdown_6m",
          desc: "6-month (126-day) max drawdown: price / rolling_max(126d) − 1.",
        },
      ],
      target: "Next month total return.",
      model:
        "LGBMRegressor(n_estimators=300, learning_rate=0.05, num_leaves=31, min_child_samples=20). Fails with a clear error if LightGBM is not installed — no silent fallback occurs. Install with: pip install 'lightgbm>=4.5.0'.",
      warmup:
        "Requires ≥ 24 months of training history before the first prediction. Price data fetched with 5-year lookback before run.start_date.",
      walkForward: "Same expanding-window walk-forward as ML Ridge. No look-ahead bias.",
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

const metricDefs = [
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
    desc: "Fraction of trading days (or months for ML) with a positive return. > 50% means more up days than down days.",
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

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-foreground mb-3 text-[15px] font-semibold">{children}</h2>;
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border/40 flex flex-col gap-0.5 border-b py-2 last:border-0 sm:flex-row sm:gap-3">
      <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase sm:w-28 sm:shrink-0 sm:pt-0.5">
        {label}
      </span>
      <span className="text-foreground/90 flex-1 text-[13px] leading-relaxed">{children}</span>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function StrategiesPage() {
  return (
    <AppShell title="Strategies">
      <PageContainer size="medium">
        {/* Hero */}
        <div className="mb-6">
          <h1 className="text-foreground text-xl font-semibold">
            Strategy Glossary &amp; Methodology
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-[13px]">
            How FactorLab strategies are constructed, executed, and measured. All strategies share a
            common equal-weight, monthly-rebalance framework with configurable transaction costs and
            benchmarks.
          </p>
        </div>

        {/* Common Framework */}
        <section className="mb-8">
          <SectionTitle>Common Framework</SectionTitle>
          <Card className="bg-card border-border">
            <CardContent className="divide-border/40 divide-y px-4 py-3">
              <FieldRow label="Universe">
                Defined at run creation and snapshotted to{" "}
                <code className="bg-secondary rounded px-1 text-[12px]">runs.universe_symbols</code>{" "}
                at execution time. The snapshot is used for all display and audit purposes,
                preventing label drift between the UI and the actual execution.
                <br />
                <span className="text-muted-foreground text-[12px]">
                  Presets — ETF8: 8 cross-asset ETFs (SPY, QQQ, IWM, EFA, EEM, TLT, GLD, VNQ) ·
                  SP100: 20 large-cap S&amp;P 500 members · NASDAQ100: 20 Nasdaq-100 tech leaders.
                </span>
              </FieldRow>
              <FieldRow label="Rebalance">
                Monthly, at calendar month boundaries. On each rebalance the portfolio is reset to
                the new target weights. Between rebalances, weights drift as prices move — this
                drift is the source of turnover at the next rebalance.
              </FieldRow>
              <FieldRow label="Construction">
                All strategies use <strong>equal weighting</strong>: each selected asset receives
                weight 1/k where k is the number of selected assets. No mean-variance optimization
                is applied.
              </FieldRow>
              <FieldRow label="Costs">
                Transaction costs are modeled as:{" "}
                <code className="bg-secondary rounded px-1 text-[12px]">
                  cost = (costs_bps / 10,000) × turnover
                </code>
                , deducted from returns at each rebalance date. Default is 10 bps. Configurable per
                run.
              </FieldRow>
              <FieldRow label="Benchmark">
                SPY (S&amp;P 500 ETF) is the default benchmark, rebased to the same starting NAV
                ($100,000) as the portfolio. The benchmark ticker is configurable per run and is
                included in universe downloads for the ML strategies.
              </FieldRow>
              <FieldRow label="Starting NAV">
                Configurable per run (default $100,000; range $1,000–$10,000,000). Both portfolio
                and benchmark are rebased to the same starting NAV. All equity curve values are
                absolute NAV.
              </FieldRow>
            </CardContent>
          </Card>
        </section>

        {/* Strategies */}
        <section className="mb-8">
          <SectionTitle>Strategies</SectionTitle>
          <div className="flex flex-col gap-4">
            {strategies.map((s) => (
              <Card key={s.id} className="bg-card border-border">
                <CardHeader className="px-4 pt-4 pb-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <CardTitle className="text-card-foreground text-[14px] font-semibold">
                      {s.label}
                    </CardTitle>
                    <Badge
                      variant={s.tagVariant}
                      className="h-5 px-2 py-0 text-[10px] leading-5 font-medium"
                    >
                      {s.tag}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-1 text-[12px]">{s.summary}</p>
                </CardHeader>
                <Separator className="opacity-50" />
                <CardContent className="divide-border/40 divide-y px-4 py-3">
                  <FieldRow label="Rule">{s.rule}</FieldRow>
                  <FieldRow label="Selection">{s.selection}</FieldRow>
                  <FieldRow label="Weights">{s.weightScheme}</FieldRow>
                  {s.signal && (
                    <FieldRow label="Signal">
                      <pre className="text-foreground/80 font-mono text-[12px] whitespace-pre-wrap">
                        {s.signal}
                      </pre>
                    </FieldRow>
                  )}
                  {s.mlDetails && (
                    <>
                      <FieldRow label="Features">
                        <ul className="space-y-1">
                          {s.mlDetails.features.map((f) => (
                            <li key={f.name} className="text-[13px]">
                              <code className="bg-secondary rounded px-1 font-mono text-[12px]">
                                {f.name}
                              </code>{" "}
                              — {f.desc}
                            </li>
                          ))}
                        </ul>
                      </FieldRow>
                      <FieldRow label="Target">{s.mlDetails.target}</FieldRow>
                      <FieldRow label="Model">{s.mlDetails.model}</FieldRow>
                      <FieldRow label="Walk-Forward">{s.mlDetails.walkForward}</FieldRow>
                      <FieldRow label="Warmup">{s.mlDetails.warmup}</FieldRow>
                    </>
                  )}
                  <FieldRow label="Turnover">{s.turnover}</FieldRow>
                  <FieldRow label="Expectations">{s.expectations}</FieldRow>
                  {s.reference && (
                    <FieldRow label="Reference">
                      <span className="text-muted-foreground text-[12px] italic">
                        {s.reference}
                      </span>
                    </FieldRow>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Rebalance Mechanics */}
        <section className="mb-8">
          <SectionTitle>How Rebalancing Works</SectionTitle>
          <Card className="bg-card border-border">
            <CardContent className="text-foreground/90 space-y-3 px-4 py-4 text-[13px] leading-relaxed">
              <p>
                On each <strong>rebalance date</strong>, the engine computes new target weights and
                calculates one-way turnover from the previous rebalance target:
                <code className="bg-secondary mx-1 rounded px-1 text-[12px]">
                  0.5 × sum(abs(new_weights − old_weights))
                </code>
                . Initial portfolio establishment is excluded from the turnover KPI, and no-change
                rebalance dates count as 0.
              </p>
              <p>
                <strong>Example:</strong> In a 5-position equal-weight portfolio, swapping one name
                means selling 20% of the old holding and buying 20% of the new one. The one-way
                turnover is therefore 20%, and at 10 bps costs the rebalance drag is 0.02%.
              </p>
              <p>
                Daily ML strategies annualize turnover with 252 rebalances/year; monthly strategies
                use 12. The turnover chart shows per-rebalance one-way turnover, not an annualized
                value.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Metrics Glossary */}
        <section className="mb-8">
          <SectionTitle>Metrics Glossary</SectionTitle>
          <Card className="bg-card border-border">
            <CardContent className="divide-border/40 divide-y px-4 py-3">
              {metricDefs.map((m) => (
                <div key={m.name} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-3">
                  <div className="sm:w-32 sm:shrink-0">
                    <span className="text-foreground font-mono text-[12px] font-medium">
                      {m.name}
                    </span>
                    <p className="text-muted-foreground mt-0.5 text-[10px]">{m.full}</p>
                  </div>
                  <p className="text-foreground/80 flex-1 text-[13px] leading-relaxed">{m.desc}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        {/* Limitations */}
        <section className="mb-2">
          <SectionTitle>Known Limitations</SectionTitle>
          <Card className="bg-card border-border">
            <CardContent className="divide-border/40 divide-y px-4 py-3">
              <FieldRow label="Survivorship bias">
                Universe presets are static snapshots. They do not account for assets that were
                delisted, merged, or replaced during the backtest period. This may overstate
                historical performance for long backtest windows.
              </FieldRow>
              <FieldRow label="Simplified costs">
                The cost model applies a flat{" "}
                <code className="bg-secondary rounded px-1 text-[12px]">bps × turnover</code> rate.
                It does not model market impact, bid-ask spread, slippage, or short-selling costs.
              </FieldRow>
              <FieldRow label="Data quality">
                Price data is sourced from Yahoo Finance via{" "}
                <code className="bg-secondary rounded px-1 text-[12px]">yfinance</code>. Gaps are
                forward-filled. Significant coverage gaps may affect results for smaller or
                less-liquid assets.
              </FieldRow>
              <FieldRow label="Research only">
                FactorLab is a research and backtesting tool with no live brokerage integration.
                Results reflect historical simulations and should not be taken as a guarantee of
                future returns.
              </FieldRow>
            </CardContent>
          </Card>
        </section>
      </PageContainer>
    </AppShell>
  );
}
