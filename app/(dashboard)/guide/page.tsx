import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const sections = [
  {
    id: "overview",
    title: "What is FactorLab?",
    content: (
      <div className="text-muted-foreground space-y-3 text-[13px] leading-relaxed">
        <p>
          FactorLab is a quant research dashboard for creating historical backtests, monitoring
          queued runs, and reviewing the results as charts, tables, and downloadable HTML reports.
        </p>
        <p>
          Monthly factor strategies and daily walk-forward ML strategies share the same product
          flow: choose a strategy, queue a run, and review the stored outputs when it completes.
        </p>
        <p>
          It is a <span className="text-foreground font-medium">research tool</span>, not a trading
          platform. Results are hypothetical and not financial advice.
        </p>
      </div>
    ),
  },
  {
    id: "create-run",
    title: "Creating a Run",
    content: (
      <div className="text-muted-foreground space-y-4 text-[13px] leading-relaxed">
        <p>
          Start from{" "}
          <Link
            href="/runs/new"
            className="text-foreground hover:text-primary font-medium underline underline-offset-2 transition-colors"
          >
            New Run
          </Link>
          . For deeper methodology, use the{" "}
          <Link
            href="/strategies"
            className="text-foreground hover:text-primary font-medium underline underline-offset-2 transition-colors"
          >
            Strategies
          </Link>{" "}
          page.
        </p>
        <div className="space-y-2.5">
          {[
            {
              label: "Strategy",
              desc: "Choose the portfolio logic you want to test. FactorLab includes baseline, factor, regime, and ML strategies.",
            },
            {
              label: "Universe",
              desc: "Pick the investable set the strategy can draw from: ETF8, SP100, or NASDAQ100.",
            },
            {
              label: "Benchmark",
              desc: "Select the comparison ticker used for relative performance metrics and chart overlays.",
            },
            {
              label: "Date range",
              desc: "Every run must span at least 730 calendar days. The end date is capped at the Data page's Current through cutoff.",
            },
            {
              label: "Top N",
              desc: "Maximum number of names held by ranking strategies. Equal Weight ignores it because it holds the full universe.",
            },
            {
              label: "Costs (bps)",
              desc: "Transaction cost assumption applied to turnover. Higher-turnover strategies are more sensitive to this input.",
            },
            {
              label: "Initial capital",
              desc: "Starting portfolio value for the run and benchmark series.",
            },
          ].map(({ label, desc }) => (
            <div key={label} className="flex gap-2">
              <span className="text-foreground w-[110px] shrink-0 font-medium">{label}</span>
              <span>{desc}</span>
            </div>
          ))}
        </div>
        <div className="border-border bg-secondary/30 rounded-lg border px-3 py-2.5 text-[12px]">
          <span className="text-foreground font-medium">Tip:</span> Save your preferred defaults in{" "}
          <Link
            href="/settings?tab=backtest"
            className="text-foreground hover:text-primary font-medium underline underline-offset-2 transition-colors"
          >
            Settings {">"} Backtest
          </Link>
          .
        </div>
      </div>
    ),
  },
  {
    id: "queue",
    title: "Queue and Status",
    content: (
      <div className="text-muted-foreground space-y-4 text-[13px] leading-relaxed">
        <p>
          Submitting a run starts with a preflight coverage check. That keeps missing-data repairs
          separate from actual strategy execution.
        </p>
        <div className="space-y-2.5">
          {[
            {
              label: "Queued",
              desc: "All required data is ready, so the run is waiting for background compute to claim it.",
            },
            {
              label: "Waiting for Data",
              desc: "Required price coverage is being repaired automatically before the run can start.",
            },
            {
              label: "Running",
              desc: "FactorLab is executing the backtest and persisting the result set.",
            },
            {
              label: "Completed",
              desc: "Results are available in the run detail page.",
            },
            {
              label: "Failed",
              desc: "The run stopped with an unrecoverable error. Check the Jobs page for the message.",
            },
          ].map(({ label, desc }) => (
            <div key={label} className="flex gap-2">
              <span className="text-foreground w-[110px] shrink-0 font-medium">{label}</span>
              <span>{desc}</span>
            </div>
          ))}
        </div>
        <p>
          Active runs refresh automatically on the{" "}
          <Link
            href="/runs"
            className="text-foreground hover:text-primary font-medium underline underline-offset-2 transition-colors"
          >
            Runs
          </Link>{" "}
          page and in the run detail status panel.
        </p>
      </div>
    ),
  },
  {
    id: "results",
    title: "Reading Results",
    content: (
      <div className="text-muted-foreground space-y-4 text-[13px] leading-relaxed">
        <p>
          The <span className="text-foreground font-medium">Overview</span> tab combines the equity
          curve, drawdown chart, KPI grid, and run configuration summary.
        </p>
        <div className="space-y-2">
          {[
            {
              label: "CAGR",
              desc: "Annualized compounded return over the stored run history.",
            },
            {
              label: "Sharpe",
              desc: "Risk-adjusted return using daily return volatility.",
            },
            {
              label: "Max Drawdown",
              desc: "Worst peak-to-trough decline in the portfolio series.",
            },
            {
              label: "Volatility",
              desc: "Annualized standard deviation of daily portfolio returns.",
            },
            {
              label: "Win Rate",
              desc: "Share of trading days with a positive portfolio return.",
            },
            {
              label: "Profit Factor",
              desc: "Total positive daily returns divided by the absolute value of total negative daily returns.",
            },
            {
              label: "Turnover",
              desc: "Annualized drift-adjusted turnover. Higher values imply more trading and more cost sensitivity.",
            },
            {
              label: "Calmar",
              desc: "CAGR relative to maximum drawdown.",
            },
          ].map(({ label, desc }) => (
            <div key={label} className="flex gap-2">
              <span className="text-foreground w-[120px] shrink-0 font-medium">{label}</span>
              <span>{desc}</span>
            </div>
          ))}
        </div>
        <div className="border-border bg-secondary/30 rounded-lg border px-3 py-2.5 text-[12px]">
          <span className="text-foreground font-medium">Compare</span> lets you review two completed
          runs side by side as equity curves and KPI tables.
        </div>
      </div>
    ),
  },
  {
    id: "tabs",
    title: "Holdings, Trades, and ML Insights",
    content: (
      <div className="text-muted-foreground space-y-3 text-[13px] leading-relaxed">
        <p className="text-foreground font-medium">Holdings</p>
        <p>
          Choose a stored date from the selector to inspect the portfolio snapshot for that period.
          ML runs also show rank, predicted return, and realized return.
        </p>
        <p className="text-foreground font-medium">Trades</p>
        <p>
          Review per-rebalance constituent turnover and the rebalance log showing which names
          entered or exited.
        </p>
        <p className="text-foreground font-medium">ML Insights</p>
        <p>
          ML strategies expose feature importance, predicted picks, and realized-versus-predicted
          views for the stored model output.
        </p>
      </div>
    ),
  },
  {
    id: "reports",
    title: "Reports",
    content: (
      <div className="text-muted-foreground space-y-3 text-[13px] leading-relaxed">
        <p>Completed runs support HTML reports from the Overview tab.</p>
        <p>
          If a report already exists, you will see{" "}
          <span className="text-foreground font-medium">Download Report</span>. If not, you will see{" "}
          <span className="text-foreground font-medium">Generate Report</span> first.
        </p>
        <p>Reports are self-contained HTML files that can be opened outside the app.</p>
      </div>
    ),
  },
  {
    id: "data",
    title: "Data, Jobs, and Settings",
    content: (
      <div className="text-muted-foreground space-y-3 text-[13px] leading-relaxed">
        <p>
          The{" "}
          <Link
            href="/data"
            className="text-foreground hover:text-primary font-medium underline underline-offset-2 transition-colors"
          >
            Data
          </Link>{" "}
          page is the public Backtest-ready view. It focuses on the shared cutoff date, required
          ticker coverage, and readiness for normal research workflows.
        </p>
        <p>
          The{" "}
          <Link
            href="/jobs"
            className="text-foreground hover:text-primary font-medium underline underline-offset-2 transition-colors"
          >
            Jobs
          </Link>{" "}
          page shows the underlying backtest and data-ingest work, including failure messages.
        </p>
        <p>
          Use{" "}
          <Link
            href="/settings"
            className="text-foreground hover:text-primary font-medium underline underline-offset-2 transition-colors"
          >
            Settings
          </Link>{" "}
          to manage backtest defaults, password changes, guest-account upgrades, and account
          deletion.
        </p>
      </div>
    ),
  },
  {
    id: "common-issues",
    title: "Common Issues",
    content: (
      <div className="text-muted-foreground space-y-2.5 text-[13px] leading-relaxed">
        {[
          {
            problem: "Run stays queued",
            fix: "Background compute may be unavailable. Check the Jobs page for the latest state.",
          },
          {
            problem: "Run stays waiting for data",
            fix: "Missing coverage is still being repaired. Use the Jobs and Data pages to follow progress.",
          },
          {
            problem: "ML run fails quickly",
            fix: "The selected window may not have enough usable training history, or the worker environment may be missing ML dependencies.",
          },
          {
            problem: "Report is not downloadable yet",
            fix: "Use Generate Report once when the run is completed. The button switches to Download Report when the file is ready.",
          },
        ].map(({ problem, fix }) => (
          <div key={problem} className="border-border bg-card rounded-lg border px-3 py-2.5">
            <p className="text-foreground mb-1 font-medium">{problem}</p>
            <p>{fix}</p>
          </div>
        ))}
      </div>
    ),
  },
];

export default function GuidePage() {
  return (
    <AppShell title="Guide">
      <PageContainer size="medium">
        <div className="mb-6 space-y-2">
          <h1 className="text-foreground text-xl font-semibold">How to Use FactorLab</h1>
          <p className="text-muted-foreground text-[13px]">
            A quick product guide for creating runs, following queue progress, and reading results.
          </p>
        </div>

        <div className="space-y-4">
          {sections.map((section, i) => (
            <Card key={section.id} className="bg-card border-border">
              <CardHeader className="px-5 pt-4 pb-2">
                <div className="flex items-center gap-2.5">
                  <span className="text-muted-foreground w-5 font-mono text-[11px] tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <CardTitle className="text-card-foreground text-[14px] font-semibold">
                    {section.title}
                  </CardTitle>
                </div>
              </CardHeader>
              <Separator className="mb-3" />
              <CardContent className="px-5 pb-4">{section.content}</CardContent>
            </Card>
          ))}
        </div>

        <p className="text-muted-foreground mt-6 text-center text-[11px]">
          FactorLab is for research purposes only. Results are hypothetical and not financial
          advice.
        </p>
      </PageContainer>
    </AppShell>
  );
}
