import { AppShell } from "@/components/layout/app-shell"
import { PageContainer } from "@/components/layout/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

// ── Sections ──────────────────────────────────────────────────────────────────

const sections = [
  {
    id: "overview",
    title: "What is FactorLab?",
    content: (
      <div className="space-y-3 text-[13px] text-muted-foreground leading-relaxed">
        <p>
          FactorLab is a quant research dashboard for running and comparing historical
          backtests on systematic investment strategies. You define the strategy, universe,
          and date range; the engine simulates monthly rebalancing and reports performance
          metrics and tear sheets.
        </p>
        <p>
          It is a <span className="text-foreground font-medium">research tool</span>, not a
          trading platform. All results are hypothetical and do not constitute financial advice.
        </p>
      </div>
    ),
  },
  {
    id: "create-run",
    title: "Creating a Run",
    content: (
      <div className="space-y-4 text-[13px] text-muted-foreground leading-relaxed">
        <p>
          Navigate to <span className="font-medium text-foreground">New Run</span> in the
          sidebar. Each field controls an aspect of the simulation:
        </p>
        <div className="space-y-2.5">
          {[
            {
              label: "Strategy",
              desc: "The portfolio construction algorithm. Equal Weight holds everything at 1/N. Momentum 12-1 picks the top half by 12-month return. ML strategies use walk-forward machine learning to rank assets. See the Strategies page for full details.",
            },
            {
              label: "Universe",
              desc: "The asset pool the strategy selects from. ETF8 is 8 broad-market ETFs; SP100 is 20 S&P 100 stocks; NASDAQ100 is 20 Nasdaq 100 stocks. The exact symbols used are snapshotted at run time.",
            },
            {
              label: "Benchmark",
              desc: "SPY (S&P 500 ETF) by default. All relative metrics (alpha, beta, information ratio) are computed against this series. Avoid choosing a benchmark that is already in your universe — FactorLab will warn you.",
            },
            {
              label: "Date range",
              desc: "Start and end dates for the backtest. Longer horizons give more statistical power but require sufficient price history. ML strategies need at least 24 months of training data before the first prediction.",
            },
            {
              label: "Top N",
              desc: "For strategies that select a subset of assets, this is the maximum number held at each rebalance. Ignored by Equal Weight (holds all assets).",
            },
            {
              label: "Costs (bps)",
              desc: "Round-trip transaction cost applied at each rebalance, in basis points. 10 bps = 0.10% total. Applies to the traded notional (sells + buys) each month. Higher costs penalise high-turnover strategies more.",
            },
            {
              label: "Initial capital",
              desc: "Starting portfolio value in USD. Affects absolute P&L figures but not percentage-based metrics like CAGR or Sharpe ratio.",
            },
          ].map(({ label, desc }) => (
            <div key={label} className="flex gap-2">
              <span className="shrink-0 font-medium text-foreground w-[110px]">{label}</span>
              <span>{desc}</span>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2.5 text-[12px]">
          <span className="font-medium text-foreground">Tip:</span> Your default settings are
          saved in <span className="font-medium text-foreground">Settings → Backtest</span> so
          you don&apos;t have to re-enter them every time.
        </div>
      </div>
    ),
  },
  {
    id: "job-lifecycle",
    title: "Job Lifecycle",
    content: (
      <div className="space-y-3 text-[13px] text-muted-foreground leading-relaxed">
        <p>
          When you submit a run, a background job is created. It moves through these stages:
        </p>
        <div className="space-y-2">
          {[
            { status: "Queued", color: "text-muted-foreground", desc: "Job is waiting for a worker to pick it up." },
            { status: "Running", color: "text-warning", desc: "Worker is executing: price ingest → backtest → metrics → report. A progress bar shows the current stage and percentage." },
            { status: "Completed", color: "text-success", desc: "All stages finished. Equity curve, KPIs, holdings, and trades are available." },
            { status: "Failed", color: "text-destructive", desc: "An error occurred. The error message is shown in the job status panel. Common causes: insufficient price data, too-short date range for ML warmup." },
          ].map(({ status, color, desc }) => (
            <div key={status} className="flex gap-2">
              <span className={`shrink-0 font-medium w-[90px] ${color}`}>{status}</span>
              <span>{desc}</span>
            </div>
          ))}
        </div>
        <p>
          You can monitor all active jobs on the{" "}
          <span className="font-medium text-foreground">Jobs</span> page. The run detail page
          also shows a live status panel that auto-updates without a manual refresh.
        </p>
      </div>
    ),
  },
  {
    id: "results",
    title: "Interpreting Results",
    content: (
      <div className="space-y-4 text-[13px] text-muted-foreground leading-relaxed">
        <p>
          The <span className="font-medium text-foreground">Overview</span> tab on a completed
          run contains the equity curve, drawdown chart, and KPI grid.
        </p>

        <p className="font-medium text-foreground">Key metrics:</p>
        <div className="space-y-2">
          {[
            { label: "CAGR", desc: "Compound annual growth rate — the annualised geometric return of the portfolio." },
            { label: "Sharpe Ratio", desc: "Annualised excess return divided by volatility. Higher is better; >1 is generally considered good." },
            { label: "Max Drawdown", desc: "Largest peak-to-trough decline in portfolio value. A measure of downside risk." },
            { label: "Volatility", desc: "Annualised standard deviation of monthly returns." },
            { label: "Win Rate", desc: "Fraction of monthly periods where the portfolio had a positive return." },
            { label: "Profit Factor", desc: "Sum of winning months' returns divided by sum of losing months' returns. >1 means more gains than losses." },
            { label: "Turnover", desc: "Average one-way turnover per rebalance — what fraction of the portfolio was traded." },
            { label: "Calmar Ratio", desc: "CAGR divided by the absolute max drawdown. Rewards strategies that grow fast relative to their worst decline." },
          ].map(({ label, desc }) => (
            <div key={label} className="flex gap-2">
              <span className="shrink-0 font-medium text-foreground w-[120px]">{label}</span>
              <span>{desc}</span>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2.5 text-[12px]">
          <span className="font-medium text-foreground">Delta columns</span> show how each metric
          compares to the benchmark over the same period (e.g. portfolio CAGR − benchmark CAGR).
          Green means outperformance, red means underperformance.
        </div>
      </div>
    ),
  },
  {
    id: "holdings-trades",
    title: "Holdings & Trades Tabs",
    content: (
      <div className="space-y-3 text-[13px] text-muted-foreground leading-relaxed">
        <p className="font-medium text-foreground">Holdings</p>
        <p>
          Shows the portfolio weights at each monthly rebalance date. Each row is a
          symbol; each column is a period. For ML strategies, the predicted return and rank
          are also shown.
        </p>
        <p className="font-medium text-foreground">Trades</p>
        <p>
          Shows the buy/sell activity implied by the weight changes between rebalances.
          A positive trade value means the position was increased; negative means reduced or
          exited. This tab helps you understand turnover and which assets drive it.
        </p>
        <p className="font-medium text-foreground">ML Insights (ML strategies only)</p>
        <p>
          Walk-forward model performance — how well the predicted returns correlated with
          realised returns over time. Useful for diagnosing overfitting or regime breaks.
        </p>
      </div>
    ),
  },
  {
    id: "reports",
    title: "Reports",
    content: (
      <div className="space-y-3 text-[13px] text-muted-foreground leading-relaxed">
        <p>
          For completed runs, FactorLab auto-generates an HTML tear sheet on your first
          visit to the run detail page. You can also trigger it manually by clicking{" "}
          <span className="font-medium text-foreground">Generate Report</span>.
        </p>
        <p>
          The tear sheet includes the equity curve, drawdown chart, full KPI grid, universe
          summary, cost assumptions, and methodology notes. Click{" "}
          <span className="font-medium text-foreground">Download Report</span> to save it
          locally or share it.
        </p>
        <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2.5 text-[12px]">
          Reports are stored as public HTML files in Supabase Storage and regenerated on
          demand if you re-run or update a backtest.
        </div>
      </div>
    ),
  },
  {
    id: "compare",
    title: "Comparing Runs",
    content: (
      <div className="space-y-3 text-[13px] text-muted-foreground leading-relaxed">
        <p>
          The <span className="font-medium text-foreground">Compare</span> page lets you
          overlay two completed runs on the same equity curve and KPI table. Select Run A
          and Run B using the dropdowns, then review the side-by-side metrics.
        </p>
        <p>
          Use Compare to evaluate strategy variants (e.g. different Top N or cost
          assumptions), or to benchmark a factor strategy against Equal Weight.
        </p>
      </div>
    ),
  },
  {
    id: "common-issues",
    title: "Common Issues",
    content: (
      <div className="space-y-3 text-[13px] text-muted-foreground leading-relaxed">
        <div className="space-y-2.5">
          {[
            {
              problem: "Run fails with 'insufficient data'",
              fix: "The date range is too short or the start date predates available price history. Try widening the date range or moving the start date later.",
            },
            {
              problem: "ML run fails immediately",
              fix: "ML strategies require at least 24 months of training history before the first prediction. Ensure your date range is at least 2 years, and that price data exists for all selected assets.",
            },
            {
              problem: "Benchmark overlap warning",
              fix: "Your chosen benchmark (e.g. SPY) is also in the universe. This inflates apparent performance because the portfolio already holds the benchmark. Consider choosing a different benchmark or removing it from the universe.",
            },
            {
              problem: "High costs reduce returns significantly",
              fix: "High-turnover strategies (Momentum, ML) are most affected. Lower costs make the simulation more optimistic; raising them (20–30 bps) gives a more conservative picture. Real-world costs depend on your broker and position size.",
            },
            {
              problem: "Progress bar stuck / run not updating",
              fix: "The UI polls for status automatically every few seconds. If it appears stuck, try a hard refresh (Cmd+Shift+R / Ctrl+Shift+R). If the job is still showing 'running' after several minutes, check the Jobs page for an error message.",
            },
          ].map(({ problem, fix }) => (
            <div key={problem} className="rounded-lg border border-border bg-card px-3 py-2.5">
              <p className="font-medium text-foreground mb-1">{problem}</p>
              <p>{fix}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
]

// ── Page ───────────────────────────────────────────────────────────────────────

export default function GuidePage() {
  return (
    <AppShell title="Guide">
      <PageContainer size="medium">
        <div className="space-y-2 mb-6">
          <h1 className="text-xl font-semibold text-foreground">How to Use FactorLab</h1>
          <p className="text-[13px] text-muted-foreground">
            A quick reference for creating runs, reading results, and understanding the tools.
          </p>
        </div>

        <div className="space-y-4">
          {sections.map((section, i) => (
            <Card key={section.id} className="bg-card border-border">
              <CardHeader className="pb-2 px-5 pt-4">
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] font-mono text-muted-foreground tabular-nums w-5">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <CardTitle className="text-[14px] font-semibold text-card-foreground">
                    {section.title}
                  </CardTitle>
                </div>
              </CardHeader>
              <Separator className="mb-3" />
              <CardContent className="px-5 pb-4">{section.content}</CardContent>
            </Card>
          ))}
        </div>

        <p className="mt-6 text-[11px] text-muted-foreground text-center">
          FactorLab is for research purposes only. Results are hypothetical and past performance
          does not guarantee future results. Not financial advice.
        </p>
      </PageContainer>
    </AppShell>
  )
}
