import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function MetricCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-16 bg-secondary" />
                <Skeleton className="h-6 w-20 bg-secondary" />
                <Skeleton className="h-4 w-14 bg-secondary rounded-md" />
              </div>
              <Skeleton className="h-8 w-16 bg-secondary" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function ChartSkeleton({ height = "h-[320px]" }: { height?: string }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-1 px-4 pt-4">
        <Skeleton className="h-4 w-28 bg-secondary" />
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2">
        <Skeleton className={`w-full ${height} bg-secondary rounded-lg`} />
      </CardContent>
    </Card>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 px-4 pt-4">
        <Skeleton className="h-4 w-24 bg-secondary" />
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex flex-col gap-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1">
                <Skeleton className="h-4 w-32 bg-secondary" />
                <Skeleton className="h-4 w-20 bg-secondary hidden sm:block" />
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="h-5 w-16 bg-secondary rounded-md" />
                <Skeleton className="h-4 w-12 bg-secondary" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// Padding/max-width provided by AppShell — no wrapper div needed here
export function RunDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 bg-secondary rounded-lg" />
        <Skeleton className="h-5 w-48 bg-secondary" />
        <Skeleton className="h-5 w-20 bg-secondary rounded-md" />
        <Skeleton className="h-5 w-16 bg-secondary rounded-md" />
      </div>
      <Skeleton className="h-9 w-80 bg-secondary rounded-lg" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="bg-card border-border">
            <CardContent className="p-3.5">
              <Skeleton className="h-3 w-14 bg-secondary mb-2" />
              <Skeleton className="h-5 w-16 bg-secondary" />
            </CardContent>
          </Card>
        ))}
      </div>
      <ChartSkeleton height="h-[240px]" />
      <ChartSkeleton height="h-[160px]" />
    </div>
  )
}
