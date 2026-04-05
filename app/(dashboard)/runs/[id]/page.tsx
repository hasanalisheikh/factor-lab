import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { OverviewTab, type RunConfig } from "@/components/run-detail/overview-tab";
import { HoldingsTab } from "@/components/run-detail/holdings-tab";
import { TradesTab } from "@/components/run-detail/trades-tab";
import { MlInsightsTab } from "@/components/run-detail/ml-insights-tab";
import {
  getRunById,
  getEquityCurve,
  getJobByRunId,
  getReportByRunId,
  getModelMetadataByRunId,
  getModelPredictionsByRunId,
  getPositionsByRunId,
  getBenchmarkOverlapStateForRun,
  getIngestProgressForRun,
  type RunMetricsRow,
} from "@/lib/supabase/queries";
import { STRATEGY_LABELS, type StrategyId, type RunStatus } from "@/lib/types";
import { JobStatusPanel } from "@/components/run-detail/job-status-panel";
import { RunStatusPoller } from "@/components/run-detail/run-status-poller";
import { GenerateReportButton } from "@/components/run-detail/generate-report-button";
import { getRunBenchmark } from "@/lib/benchmark";
import { BenchmarkOverlapWarning } from "@/components/benchmark-overlap-warning";
import { RunDeleteButton } from "@/components/run-delete-button";
import { RerunButton } from "@/components/run-detail/rerun-button";
import { getRunPreflightSnapshot } from "@/lib/run-preflight-snapshot";

export const maxDuration = 60;

function getMetrics(value: RunMetricsRow[] | RunMetricsRow | null): RunMetricsRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getUniversePreset(run: { universe?: string | null; run_params?: unknown }): string {
  if (typeof run.universe === "string" && run.universe.trim()) {
    return run.universe.trim().toUpperCase();
  }
  const nested =
    run.run_params && typeof run.run_params === "object"
      ? (run.run_params as Record<string, unknown>)["universe"]
      : null;
  if (typeof nested === "string" && nested.trim()) {
    return nested.trim().toUpperCase();
  }
  return "ETF8";
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }

  // Round 1: fire getRunById in parallel with the 6 run-id-only queries.
  const [run, equityCurve, job, report, modelMetadata, modelPredictions, positions] =
    await Promise.all([
      getRunById(id),
      getEquityCurve(id),
      getJobByRunId(id),
      getReportByRunId(id),
      getModelMetadataByRunId(id),
      getModelPredictionsByRunId(id),
      getPositionsByRunId(id),
    ]);

  if (!run) {
    notFound();
  }

  // Round 2: queries that require the run object.
  const [benchmarkOverlap, ingestProgress] = await Promise.all([
    getBenchmarkOverlapStateForRun(run),
    // Only needed while waiting for data ingestion to complete.
    run.status === "waiting_for_data" ? getIngestProgressForRun(id) : Promise.resolve(null),
  ]);

  const metrics = getMetrics(run.run_metrics);
  const status = run.status as RunStatus;
  const strategyLabel = STRATEGY_LABELS[run.strategy_id as StrategyId] ?? run.strategy_id;

  const universePreset = getUniversePreset(run);
  const universeCount = Array.isArray(run.universe_symbols) ? run.universe_symbols.length : null;
  const canGenerateReport = status === "completed" && equityCurve.length > 0 && metrics != null;

  const resolvedReport = report;

  const costsBps = run.costs_bps ?? 10;
  const benchmarkTicker = getRunBenchmark(run);
  const isMlRun = run.strategy_id === "ml_ridge" || run.strategy_id === "ml_lightgbm";
  const preflightSnapshot = getRunPreflightSnapshot(run);
  const universeSymbols = Array.isArray(run.universe_symbols)
    ? (run.universe_symbols as string[])
    : [];
  const dualClassDisclosure = universeSymbols.includes("GOOGL") && universeSymbols.includes("GOOG");

  const runConfig: RunConfig = {
    strategyLabel,
    universe: universePreset,
    universeCount,
    benchmark: benchmarkTicker,
    startDate: run.start_date ?? null,
    endDate: run.end_date ?? null,
    costsBps,
    topN: run.top_n ?? null,
    rebalanceFreq: isMlRun ? "Daily" : "Monthly",
    dataCutoffUsed: preflightSnapshot.dataCutoffUsed,
    universeEarliestStart: preflightSnapshot.universeEarliestStart,
    benchmarkCoverageHealth: preflightSnapshot.benchmarkCoverageHealth,
    dualClassDisclosure,
  };

  return (
    <AppShell title={run.name}>
      {/* Header row */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/runs">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground h-8 w-8 shrink-0"
              aria-label="Back to runs"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2.5">
                <h2 className="text-foreground truncate text-base font-semibold">{run.name}</h2>
                <Badge
                  variant="outline"
                  className="border-border text-muted-foreground bg-secondary/50 h-5 shrink-0 rounded-md px-2 py-0 text-[10px] leading-5 font-medium"
                >
                  {strategyLabel}
                </Badge>
                <StatusBadge status={status} />
              </div>
              {/* Run configuration line */}
              <p className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 text-[12px]">
                <span>
                  Universe: {universePreset}
                  {typeof universeCount === "number" ? ` (${universeCount})` : ""}
                </span>
                <span className="text-border">·</span>
                <span>Benchmark: {benchmarkTicker}</span>
                <span className="text-border">·</span>
                <span>Costs: {costsBps} bps</span>
                <span className="text-border">·</span>
                <span>{isMlRun ? "Daily" : "Monthly"} rebalance</span>
              </p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status === "completed" && <RerunButton runId={id} />}
          {resolvedReport?.url ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="border-border text-muted-foreground hover:text-foreground h-8 shrink-0 text-[12px] font-medium"
            >
              <a href={resolvedReport.url} target="_blank" rel="noreferrer">
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download Report
              </a>
            </Button>
          ) : canGenerateReport ? (
            <GenerateReportButton runId={id} />
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled
              className="border-border text-muted-foreground h-8 shrink-0 text-[12px] font-medium"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Report Unavailable
            </Button>
          )}
          <RunDeleteButton runId={id} status={status} />
        </div>
      </div>

      {/* Job status panel — visible for queued / running / waiting_for_data runs */}
      <JobStatusPanel job={job} runStatus={status} ingestProgress={ingestProgress} />
      <RunStatusPoller status={status} />
      {benchmarkOverlap.confirmed ? <BenchmarkOverlapWarning benchmark={benchmarkTicker} /> : null}

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <div className="w-full overflow-x-auto">
          <TabsList className="bg-secondary/50 h-9 w-max rounded-lg p-0.5">
            <TabsTrigger
              value="overview"
              className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground h-8 rounded-md px-3 text-[12px] font-medium"
            >
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="holdings"
              className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground h-8 rounded-md px-3 text-[12px] font-medium"
            >
              Holdings
            </TabsTrigger>
            <TabsTrigger
              value="trades"
              className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground h-8 rounded-md px-3 text-[12px] font-medium"
            >
              Trades
            </TabsTrigger>
            {isMlRun && (
              <TabsTrigger
                value="ml-insights"
                className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground h-8 rounded-md px-3 text-[12px] font-medium"
              >
                ML Insights
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab
            metrics={metrics}
            equityCurve={equityCurve}
            benchmarkTicker={benchmarkTicker}
            runConfig={runConfig}
          />
        </TabsContent>
        <TabsContent value="holdings" className="mt-4">
          <HoldingsTab predictions={modelPredictions} positions={positions} />
        </TabsContent>
        <TabsContent value="trades" className="mt-4">
          <TradesTab positions={positions} />
        </TabsContent>
        {isMlRun && (
          <TabsContent value="ml-insights" className="mt-4">
            <MlInsightsTab
              metadata={modelMetadata}
              predictions={modelPredictions}
              runMetadata={run.run_metadata}
            />
          </TabsContent>
        )}
      </Tabs>
    </AppShell>
  );
}
