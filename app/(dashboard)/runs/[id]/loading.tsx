import { DashboardHeader } from "@/components/dashboard-header"
import { RunDetailSkeleton } from "@/components/skeletons"

export default function RunLoading() {
  return (
    <>
      <DashboardHeader title="Loading..." />
      <main className="flex-1 overflow-y-auto">
        <RunDetailSkeleton />
      </main>
    </>
  )
}
