import { DashboardHeader } from "@/components/dashboard-header"
import { MetricCards } from "@/components/metric-cards"
import { RecentRuns } from "@/components/recent-runs"
import { EquityChart } from "@/components/equity-chart"
import { RunsTable } from "@/components/runs-table"

export default function DashboardPage() {
  return (
    <>
      <DashboardHeader title="Dashboard" />
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 lg:p-6 flex flex-col gap-4 max-w-[1440px]">
          <MetricCards />

          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
            <RecentRuns />
            <EquityChart />
          </div>

          <RunsTable />
        </div>
      </main>
    </>
  )
}
