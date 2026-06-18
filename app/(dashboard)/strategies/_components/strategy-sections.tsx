import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import { metricDefs, strategies } from "../_lib/strategy-content";

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

export function CommonFrameworkSection() {
  return (
    <section className="mb-8">
      <SectionTitle>Common Framework</SectionTitle>
      <Card className="bg-card border-border">
        <CardContent className="divide-border/40 divide-y px-4 py-3">
          <FieldRow label="Universe">
            Defined at run creation and snapshotted to{" "}
            <code className="bg-secondary rounded px-1 text-[12px]">runs.universe_symbols</code> at
            execution time. The snapshot is used for all display and audit purposes, preventing
            label drift between the UI and the actual execution.
            <br />
            <span className="text-muted-foreground text-[12px]">
              Presets — ETF8: 8 cross-asset ETFs (SPY, QQQ, IWM, EFA, EEM, TLT, GLD, VNQ) · SP100:
              20 large-cap S&amp;P 500 members · NASDAQ100: 20 Nasdaq-100 tech leaders.
            </span>
          </FieldRow>
          <FieldRow label="Rebalance">
            Factor strategies rebalance monthly at calendar month boundaries. ML strategies
            rebalance daily. In both cases, the portfolio resets to new target weights and price
            drift between resets becomes turnover at the next rebalance.
          </FieldRow>
          <FieldRow label="Construction">
            All strategies use <strong>equal weighting</strong>: each selected asset receives weight
            1/k where k is the number of selected assets. No mean-variance optimization is applied.
          </FieldRow>
          <FieldRow label="Costs">
            Transaction costs are modeled as:{" "}
            <code className="bg-secondary rounded px-1 text-[12px]">
              cost = (costs_bps / 10,000) × turnover
            </code>
            , deducted from returns at each rebalance date. Default is 10 bps. Configurable per run.
          </FieldRow>
          <FieldRow label="Benchmark">
            SPY (S&amp;P 500 ETF) is the default benchmark, rebased to the same starting NAV
            ($100,000) as the portfolio. The benchmark ticker is configurable per run and is
            included in universe downloads for the ML strategies.
          </FieldRow>
          <FieldRow label="Starting NAV">
            Configurable per run (default $100,000; range $1,000–$10,000,000). Both portfolio and
            benchmark are rebased to the same starting NAV. All equity curve values are absolute
            NAV.
          </FieldRow>
        </CardContent>
      </Card>
    </section>
  );
}

export function StrategiesSection() {
  return (
    <section className="mb-8">
      <SectionTitle>Strategies</SectionTitle>
      <div className="flex flex-col gap-4">
        {strategies.map((strategy) => (
          <Card key={strategy.id} className="bg-card border-border">
            <CardHeader className="px-4 pt-4 pb-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <CardTitle className="text-card-foreground text-[14px] font-semibold">
                  {strategy.label}
                </CardTitle>
                <Badge
                  variant={strategy.tagVariant}
                  className="h-5 px-2 py-0 text-[10px] leading-5 font-medium"
                >
                  {strategy.tag}
                </Badge>
              </div>
              <p className="text-muted-foreground mt-1 text-[12px]">{strategy.summary}</p>
            </CardHeader>
            <Separator className="opacity-50" />
            <CardContent className="divide-border/40 divide-y px-4 py-3">
              <FieldRow label="Rule">{strategy.rule}</FieldRow>
              <FieldRow label="Selection">{strategy.selection}</FieldRow>
              <FieldRow label="Weights">{strategy.weightScheme}</FieldRow>
              {strategy.signal && (
                <FieldRow label="Signal">
                  <pre className="text-foreground/80 font-mono text-[12px] whitespace-pre-wrap">
                    {strategy.signal}
                  </pre>
                </FieldRow>
              )}
              {strategy.mlDetails && (
                <>
                  <FieldRow label="Features">
                    <ul className="space-y-1">
                      {strategy.mlDetails.features.map((feature) => (
                        <li key={feature.name} className="text-[13px]">
                          <code className="bg-secondary rounded px-1 font-mono text-[12px]">
                            {feature.name}
                          </code>{" "}
                          — {feature.desc}
                        </li>
                      ))}
                    </ul>
                  </FieldRow>
                  <FieldRow label="Target">{strategy.mlDetails.target}</FieldRow>
                  <FieldRow label="Model">{strategy.mlDetails.model}</FieldRow>
                  <FieldRow label="Walk-Forward">{strategy.mlDetails.walkForward}</FieldRow>
                  <FieldRow label="Warmup">{strategy.mlDetails.warmup}</FieldRow>
                </>
              )}
              <FieldRow label="Turnover">{strategy.turnover}</FieldRow>
              <FieldRow label="Expectations">{strategy.expectations}</FieldRow>
              {strategy.reference && (
                <FieldRow label="Reference">
                  <span className="text-muted-foreground text-[12px] italic">
                    {strategy.reference}
                  </span>
                </FieldRow>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function RebalanceMechanicsSection() {
  return (
    <section className="mb-8">
      <SectionTitle>How Rebalancing Works</SectionTitle>
      <Card className="bg-card border-border">
        <CardContent className="text-foreground/90 space-y-3 px-4 py-4 text-[13px] leading-relaxed">
          <p>
            On each <strong>rebalance date</strong>, the engine computes new target weights and
            calculates one-way turnover from the actual pre-rebalance portfolio weights (accounting
            for price drift since the last rebalance):
            <code className="bg-secondary mx-1 rounded px-1 text-[12px]">
              0.5 × sum(abs(new_weights − drifted_weights))
            </code>
            . Initial portfolio establishment is excluded from the turnover KPI, and no-change
            rebalance dates count as 0.
          </p>
          <p>
            <strong>Example:</strong> In a 5-position equal-weight portfolio, even with unchanged
            holdings, price drift causes weights to deviate from 1/5. Resetting them back to equal
            weight costs ~1–5% one-way turnover per month.
          </p>
          <p>
            The <strong>Trades tab</strong> chart shows constituent-change turnover from position
            records (useful for understanding which assets rotate in/out). The annualized Turnover
            KPI in the Overview combines both constituent changes and drift-reset cost.
          </p>
          <p>
            Daily ML strategies annualize turnover with 252 rebalances/year; monthly strategies use
            12.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

export function MetricsGlossarySection() {
  return (
    <section className="mb-8">
      <SectionTitle>Metrics Glossary</SectionTitle>
      <Card className="bg-card border-border">
        <CardContent className="divide-border/40 divide-y px-4 py-3">
          {metricDefs.map((metric) => (
            <div key={metric.name} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-3">
              <div className="sm:w-32 sm:shrink-0">
                <span className="text-foreground font-mono text-[12px] font-medium">
                  {metric.name}
                </span>
                <p className="text-muted-foreground mt-0.5 text-[10px]">{metric.full}</p>
              </div>
              <p className="text-foreground/80 flex-1 text-[13px] leading-relaxed">{metric.desc}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

export function LimitationsSection() {
  return (
    <section className="mb-2">
      <SectionTitle>Known Limitations</SectionTitle>
      <Card className="bg-card border-border">
        <CardContent className="divide-border/40 divide-y px-4 py-3">
          <FieldRow label="Survivorship bias">
            Universe presets are static snapshots. They do not account for assets that were
            delisted, merged, or replaced during the backtest period. This may overstate historical
            performance for long backtest windows.
          </FieldRow>
          <FieldRow label="Simplified costs">
            The cost model applies a flat{" "}
            <code className="bg-secondary rounded px-1 text-[12px]">bps × turnover</code> rate. It
            does not model market impact, bid-ask spread, slippage, or short-selling costs.
          </FieldRow>
          <FieldRow label="Data quality">
            Price data is sourced from Yahoo Finance via{" "}
            <code className="bg-secondary rounded px-1 text-[12px]">yfinance</code>. Gaps are
            forward-filled. Significant coverage gaps may affect results for smaller or less-liquid
            assets.
          </FieldRow>
          <FieldRow label="Research only">
            FactorLab is a research and backtesting tool with no live brokerage integration. Results
            reflect historical simulations and should not be taken as a guarantee of future returns.
          </FieldRow>
        </CardContent>
      </Card>
    </section>
  );
}
