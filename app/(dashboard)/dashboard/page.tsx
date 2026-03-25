import { AppShell } from "@/components/layout/app-shell";
import { DashboardOverview } from "@/components/dashboard-overview";
import { RecentRuns } from "@/components/recent-runs";
import { RunsTable } from "@/components/runs-table";
import { ActiveRunsPoller } from "@/components/active-runs-poller";
import {
  getRuns,
  getRunsCount,
  getMostRecentCompletedRun,
  getRunById,
  getEquityCurve,
  getBenchmarkOverlapStateForRun,
  type RunMetricsRow,
} from "@/lib/supabase/queries";
import { getRunBenchmark } from "@/lib/benchmark";

export const dynamic = "force-dynamic";

function getMetrics(value: RunMetricsRow[] | RunMetricsRow | null): RunMetricsRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { run: runParam } = await searchParams;
  const [allRuns, totalRuns, defaultRun] = await Promise.all([
    getRuns({ limit: 20 }),
    getRunsCount(),
    getMostRecentCompletedRun(),
  ]);

  // If a specific run is selected via ?run=<id>, use it; otherwise fall back to most recent.
  const featuredRun = runParam ? ((await getRunById(runParam)) ?? defaultRun) : defaultRun;

  let equityCurve: Awaited<ReturnType<typeof getEquityCurve>> = [];
  let benchmark = "SPY";
  let benchmarkOverlapConfirmed = false;
  if (featuredRun) {
    const [curve, overlap] = await Promise.all([
      getEquityCurve(featuredRun.id),
      getBenchmarkOverlapStateForRun(featuredRun),
    ]);
    equityCurve = curve;
    benchmark = getRunBenchmark(featuredRun);
    benchmarkOverlapConfirmed = overlap.confirmed;
  }

  const featuredMetrics = featuredRun ? getMetrics(featuredRun.run_metrics) : null;
  const storedTurnover = featuredMetrics?.turnover ?? null;

  const recentRuns = allRuns.slice(0, 6);
  const hasActiveRuns = allRuns.some((r) => r.status === "queued" || r.status === "running");

  return (
    <AppShell title="Dashboard">
      <ActiveRunsPoller hasActiveRuns={hasActiveRuns} />
      {/*
        DashboardOverview is a client component that owns the timeframe toggle.
        It computes KPIs from the same sliced equity curve shown in the chart,
        and renders <RecentRuns> (server component, passed as children) in its sidebar slot.
      */}
      <DashboardOverview
        equityCurve={equityCurve}
        storedTurnover={storedTurnover}
        benchmark={benchmark}
        benchmarkOverlapConfirmed={benchmarkOverlapConfirmed}
      >
        <RecentRuns runs={recentRuns} total={totalRuns} selectedRunId={featuredRun?.id ?? null} />
      </DashboardOverview>
      <RunsTable runs={allRuns} />
    </AppShell>
  );
}
