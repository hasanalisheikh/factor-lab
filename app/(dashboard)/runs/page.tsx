import { DashboardHeader } from "@/components/dashboard-header"
import { RunsTable } from "@/components/runs-table"

export default function RunsPage() {
  return (
    <>
      <DashboardHeader title="Runs" />
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 lg:p-6 flex flex-col gap-4 max-w-[1440px]">
          <RunsTable />
        </div>
      </main>
    </>
  )
}
