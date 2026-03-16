import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AppShell } from "@/components/layout/app-shell"
import { StatusBadge } from "@/components/status-badge"
import { OverviewTab, type RunConfig } from "@/components/run-detail/overview-tab"
import { HoldingsTab } from "@/components/run-detail/holdings-tab"
import { TradesTab } from "@/components/run-detail/trades-tab"
import { MlInsightsTab } from "@/components/run-detail/ml-insights-tab"
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
} from "@/lib/supabase/queries"
import { STRATEGY_LABELS, type StrategyId, type RunStatus } from "@/lib/types"
import { JobStatusPanel } from "@/components/run-detail/job-status-panel"
import { RunStatusPoller } from "@/components/run-detail/run-status-poller"
import { generateRunReport, ensureRunReport } from "@/app/actions/reports"
import { getRunBenchmark } from "@/lib/benchmark"
import { BenchmarkOverlapWarning } from "@/components/benchmark-overlap-warning"
import { RunDeleteButton } from "@/components/run-delete-button"

function getMetrics(value: RunMetricsRow[] | RunMetricsRow | null): RunMetricsRow | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function getUniversePreset(run: {
  universe?: string | null
  run_params?: unknown
}): string {
  if (typeof run.universe === "string" && run.universe.trim()) {
    return run.universe.trim().toUpperCase()
  }
  const nested =
    run.run_params && typeof run.run_params === "object"
      ? (run.run_params as Record<string, unknown>)["universe"]
      : null
  if (typeof nested === "string" && nested.trim()) {
    return nested.trim().toUpperCase()
  }
  return "ETF8"
}

function getRunPreflightSnapshot(run: { run_params?: unknown }): {
  dataCutoffUsed: string | null
  universeEarliestStart: string | null
  benchmarkCoverageHealth: { status: string; reason: string | null } | null
} {
  const params =
    run.run_params && typeof run.run_params === "object" && !Array.isArray(run.run_params)
      ? (run.run_params as Record<string, unknown>)
      : null
  const preflight =
    params?.preflight && typeof params.preflight === "object" && !Array.isArray(params.preflight)
      ? (params.preflight as Record<string, unknown>)
      : null
  const benchmarkHealth =
    preflight?.benchmark_coverage_health &&
    typeof preflight.benchmark_coverage_health === "object" &&
    !Array.isArray(preflight.benchmark_coverage_health)
      ? (preflight.benchmark_coverage_health as Record<string, unknown>)
      : null

  return {
    dataCutoffUsed:
      typeof preflight?.data_cutoff_date === "string" ? preflight.data_cutoff_date : null,
    universeEarliestStart:
      typeof preflight?.universe_earliest_start === "string"
        ? preflight.universe_earliest_start
        : null,
    benchmarkCoverageHealth: benchmarkHealth
      ? {
        status:
          typeof benchmarkHealth.status === "string"
            ? benchmarkHealth.status.charAt(0).toUpperCase() + benchmarkHealth.status.slice(1)
            : "—",
        reason: typeof benchmarkHealth.reason === "string" ? benchmarkHealth.reason : null,
      }
      : null,
  }
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) {
    notFound()
  }

  const run = await getRunById(id)

  if (!run) {
    notFound()
  }

  const [equityCurve, job, report, modelMetadata, modelPredictions, positions, benchmarkOverlap, ingestProgress] = await Promise.all([
    getEquityCurve(id),
    getJobByRunId(id),
    getReportByRunId(id),
    getModelMetadataByRunId(id),
    getModelPredictionsByRunId(id),
    getPositionsByRunId(id),
    getBenchmarkOverlapStateForRun(run),
    // Only needed while waiting for data ingestion to complete.
    run.status === "waiting_for_data" ? getIngestProgressForRun(id) : Promise.resolve(null),
  ])

  const metrics = getMetrics(run.run_metrics)
  const status = run.status as RunStatus
  const strategyLabel = STRATEGY_LABELS[run.strategy_id as StrategyId] ?? run.strategy_id
  const universePreset = getUniversePreset(run)
  const universeCount = Array.isArray(run.universe_symbols) ? run.universe_symbols.length : null
  const canGenerateReport = status === "completed" && equityCurve.length > 0 && metrics != null
  const generateReportAction = generateRunReport.bind(null, id)

  // Auto-generate report on first visit to a completed run that has no report yet.
  let resolvedReport = report
  if (canGenerateReport && !resolvedReport) {
    try {
      await ensureRunReport(id)
      resolvedReport = await getReportByRunId(id).catch(() => null)
    } catch (err) {
      console.error("[RunDetailPage] auto-report generation failed:", err)
    }
  }

  const costsBps = run.costs_bps ?? 10
  const benchmarkTicker = getRunBenchmark(run)
  const isMlRun = run.strategy_id === "ml_ridge" || run.strategy_id === "ml_lightgbm"
  const preflightSnapshot = getRunPreflightSnapshot(run)
  const universeSymbols = Array.isArray(run.universe_symbols) ? (run.universe_symbols as string[]) : []
  const dualClassDisclosure = universeSymbols.includes("GOOGL") && universeSymbols.includes("GOOG")

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
  }

  return (
    <AppShell title={run.name}>
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/runs">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Back to runs"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <h2 className="text-base font-semibold text-foreground truncate">
                  {run.name}
                </h2>
                <Badge
                  variant="outline"
                  className="text-[10px] font-medium px-2 py-0 h-5 leading-5 rounded-md border-border text-muted-foreground bg-secondary/50 shrink-0"
                >
                  {strategyLabel}
                </Badge>
                <StatusBadge status={status} />
              </div>
              {/* Run configuration line */}
              <p className="text-[12px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-2">
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
        <div className="flex items-center gap-2 shrink-0">
          {resolvedReport?.url ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 text-[12px] font-medium border-border text-muted-foreground hover:text-foreground shrink-0"
            >
              <a href={resolvedReport.url} target="_blank" rel="noreferrer">
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Download Report
              </a>
            </Button>
          ) : canGenerateReport ? (
            <form action={generateReportAction}>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="h-8 text-[12px] font-medium border-border text-muted-foreground hover:text-foreground shrink-0"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Generate Report
              </Button>
            </form>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled
              className="h-8 text-[12px] font-medium border-border text-muted-foreground shrink-0"
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Report Unavailable
            </Button>
          )}
          <RunDeleteButton runId={id} status={status} />
        </div>
      </div>

      {/* Job status panel — visible for queued / running / waiting_for_data runs */}
      <JobStatusPanel job={job} runStatus={status} ingestProgress={ingestProgress} />
      <RunStatusPoller status={status} />
      {benchmarkOverlap.confirmed ? (
        <BenchmarkOverlapWarning benchmark={benchmarkTicker} />
      ) : null}

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <div className="overflow-x-auto w-full">
        <TabsList className="bg-secondary/50 h-9 p-0.5 rounded-lg w-max">
          <TabsTrigger
            value="overview"
            className="text-[12px] font-medium h-8 rounded-md px-3 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="holdings"
            className="text-[12px] font-medium h-8 rounded-md px-3 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
          >
            Holdings
          </TabsTrigger>
          <TabsTrigger
            value="trades"
            className="text-[12px] font-medium h-8 rounded-md px-3 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
          >
            Trades
          </TabsTrigger>
          {isMlRun && (
            <TabsTrigger
              value="ml-insights"
              className="text-[12px] font-medium h-8 rounded-md px-3 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
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
          <TradesTab predictions={modelPredictions} positions={positions} />
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
  )
}
