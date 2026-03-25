import { AppShell } from "@/components/layout/app-shell";
import { MetricCardsSkeleton, ChartSkeleton, TableSkeleton } from "@/components/skeletons";

export default function RunsLoading() {
  return (
    <AppShell title="Runs">
      <MetricCardsSkeleton />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        <TableSkeleton rows={6} />
        <ChartSkeleton />
      </div>
      <TableSkeleton rows={8} />
    </AppShell>
  );
}
