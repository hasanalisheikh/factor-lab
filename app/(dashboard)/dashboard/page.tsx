import { AppShell } from "@/components/layout/app-shell"
import { MetricCards } from "@/components/metric-cards"
import { RecentRuns } from "@/components/recent-runs"
import { EquityChart } from "@/components/equity-chart"
import { RunsTable } from "@/components/runs-table"

export default function DashboardPage() {
  return (
    <AppShell title="Dashboard">
      <MetricCards />
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        <RecentRuns />
        <EquityChart />
      </div>
      <RunsTable />
    </AppShell>
  )
}
