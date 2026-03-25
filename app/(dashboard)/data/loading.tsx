import { AppShell } from "@/components/layout/app-shell";
import { MetricCardsSkeleton, TableSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function DataLoading() {
  return (
    <AppShell title="Data">
      {/* toolbar: search input + tab toggle */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Skeleton className="bg-secondary h-8 w-52 rounded-md" />
        <Skeleton className="bg-secondary h-8 w-36 rounded-lg" />
      </div>

      {/* health card */}
      <Card className="border-border bg-card mb-4">
        <CardContent className="flex items-start gap-3 py-4">
          <Skeleton className="bg-secondary mt-0.5 h-5 w-5 shrink-0 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="bg-secondary h-4 w-48" />
            <Skeleton className="bg-secondary h-3 w-72" />
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
  );
}
