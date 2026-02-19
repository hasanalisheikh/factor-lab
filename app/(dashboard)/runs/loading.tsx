import { DashboardHeader } from "@/components/dashboard-header"
import { MetricCardsSkeleton, ChartSkeleton, TableSkeleton } from "@/components/skeletons"

export default function RunsLoading() {
  return (
    <>
      <DashboardHeader title="Dashboard" />
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 lg:p-6 flex flex-col gap-4 max-w-[1440px]">
          <MetricCardsSkeleton />
          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
            <TableSkeleton rows={6} />
            <ChartSkeleton />
          </div>
          <TableSkeleton rows={8} />
        </div>
      </main>
    </>
  )
}
