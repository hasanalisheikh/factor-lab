import { AppShell } from "@/components/layout/app-shell"
import { RunDetailSkeleton } from "@/components/skeletons"

export default function RunLoading() {
  return (
    <AppShell title="Loading...">
      <RunDetailSkeleton />
    </AppShell>
  )
}
