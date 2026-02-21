import { AppShell } from "@/components/layout/app-shell"
import { MetricCards } from "@/components/metric-cards"
import { RecentRuns } from "@/components/recent-runs"
import { EquityChart } from "@/components/equity-chart"
import { RunsTable } from "@/components/runs-table"
import {
  getRuns,
  getRunsCount,
  getMostRecentCompletedRun,
  getEquityCurve,
  type RunMetricsRow,
} from "@/lib/supabase/queries"
import type { DashboardMetric } from "@/lib/types"
import type { EquityCurveRow } from "@/lib/supabase/queries"

export const revalidate = 30

function buildSparkline(equityCurve: EquityCurveRow[], n = 12): number[] {
  const slice = equityCurve.slice(-n)
  return slice.map((pt) => pt.portfolio)
}

function buildDashboardMetrics(
  metrics: { cagr: number; sharpe: number; max_drawdown: number; turnover: number } | null,
  equityCurve: EquityCurveRow[]
): DashboardMetric[] {
  const sparkline = buildSparkline(equityCurve)

  if (!metrics) {
    return [
      { label: "CAGR", value: "--", delta: 0, deltaLabel: "annualized", sparkline: [] },
      { label: "Sharpe Ratio", value: "--", delta: 0, deltaLabel: "risk-adjusted", sparkline: [] },
      { label: "Max Drawdown", value: "--", delta: 0, deltaLabel: "peak-to-trough", sparkline: [] },
      { label: "Turnover", value: "--", delta: 0, deltaLabel: "annualized", sparkline: [] },
    ]
  }

  return [
    {
      label: "CAGR",
      value: `${metrics.cagr >= 0 ? "+" : ""}${(metrics.cagr * 100).toFixed(1)}%`,
      delta: metrics.cagr * 100,
      deltaLabel: "annualized",
      sparkline,
    },
    {
      label: "Sharpe Ratio",
      value: metrics.sharpe.toFixed(2),
      delta: metrics.sharpe - 1,
      deltaLabel: "vs 1.0 baseline",
      sparkline,
    },
    {
      label: "Max Drawdown",
      value: `${(metrics.max_drawdown * 100).toFixed(1)}%`,
      delta: metrics.max_drawdown * 100,
      deltaLabel: "peak-to-trough",
      sparkline,
    },
    {
      label: "Turnover",
      value: `${(metrics.turnover * 100).toFixed(1)}%`,
      delta: -(metrics.turnover * 100),
      deltaLabel: "annualized",
      sparkline,
    },
  ]
}

function getMetrics(value: RunMetricsRow[] | RunMetricsRow | null): RunMetricsRow | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function DashboardPage() {
  const [allRuns, totalRuns, featuredRun] = await Promise.all([
    getRuns({ limit: 20 }),
    getRunsCount(),
    getMostRecentCompletedRun(),
  ])

  let equityCurve: EquityCurveRow[] = []
  if (featuredRun) {
    equityCurve = await getEquityCurve(featuredRun.id)
  }

  const featuredMetrics = featuredRun ? getMetrics(featuredRun.run_metrics) : null
  const dashboardMetrics = buildDashboardMetrics(featuredMetrics, equityCurve)
  const recentRuns = allRuns.slice(0, 6)

  return (
    <AppShell title="Dashboard">
      <MetricCards metrics={dashboardMetrics} />
      <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-4">
        <RecentRuns runs={recentRuns} total={totalRuns} />
        <EquityChart data={equityCurve} />
      </div>
      <RunsTable runs={allRuns} />
    </AppShell>
  )
}
