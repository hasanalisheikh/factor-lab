import { AppShell } from "@/components/layout/app-shell";
import { BENCHMARK_OPTIONS, normalizeBenchmark } from "@/lib/benchmark";
import { assessDataHealth, summarizeInceptionAwareCoverage } from "@/lib/data-health";
import { isInternalDataDiagnosticsEnabled } from "@/lib/data-page-diagnostics";
import {
  getActiveScheduledRefreshActivity,
  getAllTickerStats,
  getDataHealthSummary,
  getDataState,
  getLatestDataIngestJobs,
  getMonitoredBenchmarkCoverage,
  getNotIngestedUniverseTickers,
  getRecentDataIngestJobHistory,
  getRequiredTickerResearchSummary,
} from "@/lib/supabase/queries";
import {
  AdvancedDiagnosticsNotice,
  DataHealthCard,
  DataModeDescription,
  DiagnosticsModeToggle,
  InceptionAwareCoverageNote,
  ScheduledRefreshBanner,
} from "./_components/data-page-notices";
import { AdvancedModePanel, BacktestModePanel } from "./_components/data-mode-panels";

import type {
  BenchmarkCoverage,
  DataIngestJobHistoryEntry,
  RequiredTickerResearchRow,
} from "@/lib/supabase/queries";
import type { TickerMissingnessV2 } from "@/lib/supabase/types";
import type { BenchmarkRepairStatus } from "./_components/data-mode-panels";

export const dynamic = "force-dynamic";

function toResearchTableRows(rows: RequiredTickerResearchRow[]): TickerMissingnessV2[] {
  return rows.map((row) => ({
    ticker: row.ticker,
    firstDate: row.researchStart,
    lastDate: row.researchEnd,
    actualDays: row.actualDays,
    expectedDays: row.expectedDays,
    trueMissingDays: row.trueMissingDays,
    preInceptionDays: 0,
    coveragePercent: row.coveragePercent,
  }));
}

function formatScheduleStatus(activeJobs: number): { label: string; cls: string } {
  if (activeJobs > 0) {
    return {
      label: `Running (${activeJobs} job${activeJobs !== 1 ? "s" : ""})`,
      cls: "text-blue-400",
    };
  }
  return {
    label: "Idle",
    cls: "text-muted-foreground",
  };
}

function getBenchmarkRepairStatus(rows: BenchmarkCoverage[] | null): BenchmarkRepairStatus {
  if (rows === null) {
    return {
      available: false,
      issues: [],
      label: "Unavailable",
      cls: "text-muted-foreground",
    };
  }

  const issues = rows.filter((row) => row.status !== "ok");
  return {
    available: true,
    issues,
    label: issues.length === 0 ? "OK" : "Needs repair",
    cls: issues.length === 0 ? "text-emerald-400" : "text-amber-400",
  };
}

export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const showInternalDiagnostics = isInternalDataDiagnosticsEnabled();
  const diagnostics = showInternalDiagnostics && params.diagnostics === "1";
  const mode = showInternalDiagnostics && params.mode === "full" ? "full" : "backtest";
  const benchmarkParam = normalizeBenchmark(params.benchmark);
  const benchmarkOptions = new Set<string>(BENCHMARK_OPTIONS);
  const selectedBenchmark = benchmarkOptions.has(benchmarkParam)
    ? benchmarkParam
    : BENCHMARK_OPTIONS[0];
  const hasExplicitBenchmark = Boolean(params.benchmark && benchmarkOptions.has(benchmarkParam));

  const [dataState, tickerRanges, scheduledActivity] = await Promise.all([
    getDataState(),
    getAllTickerStats(),
    getActiveScheduledRefreshActivity(),
  ]);
  // Pass both prefetched values so getDataHealthSummary skips redundant DB queries.
  const health = await getDataHealthSummary(tickerRanges, dataState);

  const currentThrough = dataState.dataCutoffDate ?? health.dateEnd;
  const [requiredResearch, monitoredBenchmarkCoverage, universeNotIngested] = await Promise.all([
    getRequiredTickerResearchSummary(currentThrough, tickerRanges),
    getMonitoredBenchmarkCoverage(currentThrough, tickerRanges),
    getNotIngestedUniverseTickers(tickerRanges),
  ]);

  const advancedDiagnostics =
    mode === "full"
      ? summarizeInceptionAwareCoverage({
          ranges: tickerRanges,
          globalStart: health.dateStart,
          globalEnd: currentThrough,
        })
      : null;

  const [benchmarkJobs, jobHistory] =
    mode === "full"
      ? await Promise.all([
          getLatestDataIngestJobs(BENCHMARK_OPTIONS),
          getRecentDataIngestJobHistory(15),
        ])
      : [
          {} as Awaited<ReturnType<typeof getLatestDataIngestJobs>>,
          [] as DataIngestJobHistoryEntry[],
        ];

  const researchRowsSorted = [...requiredResearch.rows]
    .filter((row) => row.trueMissingDays > 0)
    .sort((a, b) => b.trueMissingDays - a.trueMissingDays);
  const backtestTopIssues = toResearchTableRows(researchRowsSorted.slice(0, 10));

  const advancedMissingRows = advancedDiagnostics
    ? advancedDiagnostics.rows
        .filter((row) => row.trueMissingDays > 0)
        .sort((a, b) => b.trueMissingDays - a.trueMissingDays)
    : [];

  const selectedBenchmarkRow =
    requiredResearch.rows.find((row) => row.ticker === selectedBenchmark) ?? null;
  const selectedBenchmarkCoverage =
    monitoredBenchmarkCoverage?.find((row) => row.ticker === selectedBenchmark) ?? null;
  const benchmarkTrueMissingRate =
    selectedBenchmarkCoverage?.trueMissingRate ??
    (selectedBenchmarkRow && selectedBenchmarkRow.expectedDays > 0
      ? selectedBenchmarkRow.trueMissingDays / selectedBenchmarkRow.expectedDays
      : 1);
  const benchmarkMaxGapDays = selectedBenchmarkRow?.maxGapDays ?? 0;
  const healthAssessment = assessDataHealth({
    completeness: requiredResearch.completeness,
    requiredNotIngested: requiredResearch.notIngestedTickers.length,
    trueMissingRate: requiredResearch.trueMissingRate,
    maxGapDays: Math.max(0, ...requiredResearch.rows.map((row) => row.maxGapDays)),
    benchmarkTicker: selectedBenchmark,
    benchmarkTrueMissingRate,
    benchmarkMaxGapDays,
  });

  const refreshTotals = scheduledActivity.monthlyActiveJobs + scheduledActivity.dailyActiveJobs;
  const monthlyStatus = formatScheduleStatus(scheduledActivity.monthlyActiveJobs);
  const dailyStatus = formatScheduleStatus(scheduledActivity.dailyActiveJobs);
  const benchmarkStatus = getBenchmarkRepairStatus(monitoredBenchmarkCoverage);

  // Show "no update needed" hint when the last cron run was a no-op (checked
  // but found no new complete trading day) and no real ingest is active.
  const dailyNoopCheckAt = dataState.lastNoopCheckAt;
  const dailyLastRealUpdate = dataState.lastUpdateAt;
  const dailyShowNoopHint =
    dataState.dailyUpdatesEnabled &&
    scheduledActivity.dailyActiveJobs === 0 &&
    dailyNoopCheckAt !== null &&
    (dailyLastRealUpdate === null || dailyNoopCheckAt > dailyLastRealUpdate);
  const backtestReadyWindowHealthy =
    requiredResearch.notIngestedTickers.length === 0 &&
    requiredResearch.totalTrueMissing === 0 &&
    benchmarkStatus.available &&
    benchmarkStatus.issues.length === 0;

  const benchmarkRows =
    mode === "full"
      ? monitoredBenchmarkCoverage
        ? BENCHMARK_OPTIONS.map((ticker) => ({
            ticker,
            coverage: monitoredBenchmarkCoverage.find((row) => row.ticker === ticker) ?? null,
            initialJob: benchmarkJobs[ticker] ?? null,
          }))
        : null
      : [];

  function buildDataHref(nextMode: "backtest" | "full") {
    const hrefParams = new URLSearchParams();
    if (showInternalDiagnostics && nextMode === "full") {
      hrefParams.set("mode", "full");
    }
    if (showInternalDiagnostics && diagnostics) {
      hrefParams.set("diagnostics", "1");
    }
    if (hasExplicitBenchmark && params.benchmark) {
      hrefParams.set("benchmark", params.benchmark);
    }
    const queryString = hrefParams.toString();
    return queryString ? `/data?${queryString}` : "/data";
  }

  return (
    <AppShell title="Data" showDataDiagnosticsToggle={showInternalDiagnostics}>
      <ScheduledRefreshBanner refreshTotals={refreshTotals} scheduledActivity={scheduledActivity} />
      <DiagnosticsModeToggle
        showInternalDiagnostics={showInternalDiagnostics}
        mode={mode}
        buildDataHref={buildDataHref}
      />
      <DataModeDescription
        mode={mode}
        backtestReadyWindowHealthy={backtestReadyWindowHealthy}
        currentThrough={currentThrough}
      />
      <AdvancedDiagnosticsNotice mode={mode} diagnostics={diagnostics} />
      <DataHealthCard healthAssessment={healthAssessment} mode={mode} />

      {mode === "backtest" ? (
        <BacktestModePanel
          requiredResearch={requiredResearch}
          healthAssessment={healthAssessment}
          currentThrough={currentThrough}
          dataState={dataState}
          monthlyStatus={monthlyStatus}
          dailyStatus={dailyStatus}
          dailyShowNoopHint={dailyShowNoopHint}
          dailyNoopCheckAt={dailyNoopCheckAt}
          benchmarkStatus={benchmarkStatus}
          tickerRanges={tickerRanges}
          universeNotIngested={universeNotIngested}
          showInternalDiagnostics={showInternalDiagnostics}
          backtestTopIssues={backtestTopIssues}
        />
      ) : (
        <AdvancedModePanel
          health={health}
          currentThrough={currentThrough}
          dataState={dataState}
          monthlyStatus={monthlyStatus}
          dailyStatus={dailyStatus}
          dailyShowNoopHint={dailyShowNoopHint}
          dailyNoopCheckAt={dailyNoopCheckAt}
          tickerRanges={tickerRanges}
          universeNotIngested={universeNotIngested}
          showInternalDiagnostics={showInternalDiagnostics}
          requiredResearch={requiredResearch}
          advancedDiagnostics={advancedDiagnostics}
          advancedMissingRows={advancedMissingRows}
          benchmarkRows={benchmarkRows}
          jobHistory={jobHistory}
          diagnostics={diagnostics}
        />
      )}

      <InceptionAwareCoverageNote showInternalDiagnostics={showInternalDiagnostics} />
    </AppShell>
  );
}
