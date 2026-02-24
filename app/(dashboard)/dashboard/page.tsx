import { AppShell } from "@/components/layout/app-shell"
import { DashboardOverview } from "@/components/dashboard-overview"
import { RecentRuns } from "@/components/recent-runs"
import { RunsTable } from "@/components/runs-table"
import {
  getRuns,
  getRunsCount,
  getMostRecentCompletedRun,
  getEquityCurve,
  type RunMetricsRow,
} from "@/lib/supabase/queries"

export const revalidate = 30

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

  let equityCurve: Awaited<ReturnType<typeof getEquityCurve>> = []
  if (featuredRun) {
    equityCurve = await getEquityCurve(featuredRun.id)
  }

  const featuredMetrics = featuredRun ? getMetrics(featuredRun.run_metrics) : null
  const storedTurnover = featuredMetrics?.turnover ?? null

  const recentRuns = allRuns.slice(0, 6)

  return (
    <AppShell title="Dashboard">
      {/*
        DashboardOverview is a client component that owns the timeframe toggle.
        It computes KPIs from the same sliced equity curve shown in the chart,
        and renders <RecentRuns> (server component, passed as children) in its sidebar slot.
      */}
      <DashboardOverview equityCurve={equityCurve} storedTurnover={storedTurnover}>
        <RecentRuns runs={recentRuns} total={totalRuns} />
      </DashboardOverview>
      <RunsTable runs={allRuns} />
    </AppShell>
  )
}
