import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function MetricCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-2">
                <Skeleton className="bg-secondary h-3 w-16" />
                <Skeleton className="bg-secondary h-6 w-20" />
                <Skeleton className="bg-secondary h-4 w-14 rounded-md" />
              </div>
              <Skeleton className="bg-secondary h-8 w-16" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = "h-[320px]" }: { height?: string }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="px-4 pt-4 pb-1">
        <Skeleton className="bg-secondary h-4 w-28" />
      </CardHeader>
      <CardContent className="px-4 pt-2 pb-4">
        <Skeleton className={`w-full ${height} bg-secondary rounded-lg`} />
      </CardContent>
    </Card>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="px-4 pt-4 pb-2">
        <Skeleton className="bg-secondary h-4 w-24" />
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex flex-col gap-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="flex flex-1 items-center gap-3">
                <Skeleton className="bg-secondary h-4 w-32" />
                <Skeleton className="bg-secondary hidden h-4 w-20 sm:block" />
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="bg-secondary h-5 w-16 rounded-md" />
                <Skeleton className="bg-secondary h-4 w-12" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Padding/max-width provided by AppShell — no wrapper div needed here
export function RunDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Skeleton className="bg-secondary h-8 w-8 rounded-lg" />
        <Skeleton className="bg-secondary h-5 w-48" />
        <Skeleton className="bg-secondary h-5 w-20 rounded-md" />
        <Skeleton className="bg-secondary h-5 w-16 rounded-md" />
      </div>
      <Skeleton className="bg-secondary h-9 w-80 rounded-lg" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="bg-card border-border">
            <CardContent className="p-3.5">
              <Skeleton className="bg-secondary mb-2 h-3 w-14" />
              <Skeleton className="bg-secondary h-5 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <ChartSkeleton height="h-[240px]" />
      <ChartSkeleton height="h-[160px]" />
    </div>
  );
}
