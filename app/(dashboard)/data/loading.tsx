import { AppShell } from "@/components/layout/app-shell"
import { MetricCardsSkeleton, TableSkeleton } from "@/components/skeletons"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"

export default function DataLoading() {
  return (
    <AppShell title="Data">
      {/* toolbar: search input + tab toggle */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-52 bg-secondary rounded-md" />
        <Skeleton className="h-8 w-36 bg-secondary rounded-lg" />
      </div>

      {/* health card */}
      <Card className="mb-4 border-border bg-card">
        <CardContent className="flex items-start gap-3 py-4">
          <Skeleton className="h-5 w-5 bg-secondary rounded-full shrink-0 mt-0.5" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-48 bg-secondary" />
            <Skeleton className="h-3 w-72 bg-secondary" />
          </div>
        </CardContent>
      </Card>

      {/* metric cards */}
      <div className="mb-4">
        <MetricCardsSkeleton />
      </div>

      {/* top issues table */}
      <TableSkeleton rows={6} />
    </AppShell>
  )
}
