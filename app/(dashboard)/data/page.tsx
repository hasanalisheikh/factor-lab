import { AppShell } from "@/components/layout/app-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  getActiveScheduledRefreshActivity,
  getDataHealthSummary,
  getDataState,
  getLatestDataIngestJobs,
  getAllTickerStats,
  getNotIngestedUniverseTickers,
  getRecentDataIngestJobHistory,
  getRequiredTickerResearchSummary,
  type DataIngestJobHistoryEntry,
  type RequiredTickerResearchRow,
} from "@/lib/supabase/queries"
import { BENCHMARK_OPTIONS, normalizeBenchmark } from "@/lib/benchmark"
import {
  TICKER_INCEPTION_DATES,
  type BenchmarkCoverage,
  type TickerMissingnessV2,
} from "@/lib/supabase/types"
import { DAILY_PATCH_RUN_HOUR_UTC } from "@/lib/data-cutoff"
import {
  formatISODate,
  formatISOTimestamp,
} from "@/lib/utils/dates"
import {
  assessDataHealth,
  type HealthStatus,
  summarizeInceptionAwareCoverage,
} from "@/lib/data-health"
import { InfoTooltip } from "@/components/data/info-tooltip"
import { TopMissingTable } from "@/components/data/top-missing-table"
import { BenchmarkCoverageCard } from "@/components/data/benchmark-coverage-card"
import { UniverseTierSummary } from "@/components/data/universe-tier-summary"
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock3,
  Database,
  Info,
  Search,
  ShieldCheck,
  Wrench,
  XCircle,
  AlertCircle,
  Activity,
} from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

export const dynamic = "force-dynamic"

function healthVerdict(status: HealthStatus) {
  if (status === "NO_DATA") {
    return {
      label: "No Data",
      Icon: XCircle,
      textCls: "text-muted-foreground",
      borderCls: "border-border",
    }
  }
  if (status === "GOOD") {
    return {
      label: "Good",
      Icon: CheckCircle2,
      textCls: "text-emerald-400",
      borderCls: "border-emerald-800/40",
    }
  }
  if (status === "WARNING") {
    return {
      label: "Warning",
      Icon: AlertCircle,
      textCls: "text-amber-400",
      borderCls: "border-amber-800/40",
    }
  }
  return {
    label: "Blocked",
    Icon: XCircle,
    textCls: "text-red-400",
    borderCls: "border-red-800/40",
  }
}

function SummaryMetricCard({
  title,
  tooltip,
  value,
  meta,
  icon,
  valueClassName = "text-2xl font-semibold text-foreground",
}: {
  title: string
  tooltip?: string
  value: ReactNode
  meta?: ReactNode
  icon: ReactNode
  valueClassName?: string
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
          {title}
          {tooltip && <InfoTooltip text={tooltip} />}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={valueClassName}>{value}</p>
          {meta && <div className="mt-1 text-xs text-muted-foreground">{meta}</div>}
        </div>
        <div className="flex-shrink-0">{icon}</div>
      </CardContent>
    </Card>
  )
}

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
  }))
}

function formatScheduleStatus(activeJobs: number): { label: string; cls: string } {
  if (activeJobs > 0) {
    return {
      label: `Running (${activeJobs} job${activeJobs !== 1 ? "s" : ""})`,
      cls: "text-blue-400",
    }
  }
  return {
    label: "Idle",
    cls: "text-muted-foreground",
  }
}

function getBenchmarkRepairStatus(rows: RequiredTickerResearchRow[]) {
  const issues = rows.filter((row) => row.isBenchmark && (!row.isIngested || row.trueMissingDays > 0))
  return {
    issues,
    label: issues.length === 0 ? "OK" : "Needs repair",
    cls: issues.length === 0 ? "text-emerald-400" : "text-amber-400",
  }
}

function historyStatusClass(status: string): string {
  if (status === "succeeded") return "text-emerald-400"
  if (status === "queued" || status === "running") return "text-blue-400"
  if (status === "retrying") return "text-amber-400"
  return "text-red-400"
}

function HistoryCard({
  rows,
  diagnostics,
}: {
  rows: DataIngestJobHistoryEntry[]
  diagnostics: boolean
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-foreground">
          Ingestion Job History
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Recent refresh and repair jobs, labeled by their actual trigger.
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No ingestion jobs have been recorded yet.
          </p>
        ) : (
          <div className="space-y-2.5">
            {rows.map((row) => (
              <div
                key={row.id}
                className="border-b border-border/50 pb-2.5 last:border-0 last:pb-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">
                      <span className="font-mono">{row.symbol}</span>{" "}
                      <span className="text-muted-foreground">· {row.triggerLabel}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Created {formatISOTimestamp(row.createdAt)}
                      {row.finishedAt ? ` · finished ${formatISOTimestamp(row.finishedAt)}` : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {row.rowsInserted.toLocaleString()} rows
                      {row.targetCutoffDate ? ` · cutoff ${formatISODate(row.targetCutoffDate)}` : ""}
                      {row.attemptCount ? ` · attempt ${row.attemptCount + 1}` : ""}
                    </p>
                    {row.nextRetryAt && (
                      <p className="mt-0.5 text-[11px] text-amber-400">
                        Retrying at {formatISOTimestamp(row.nextRetryAt)}
                      </p>
                    )}
                    {diagnostics && row.error && (
                      <p className="mt-0.5 text-[11px] text-red-400 break-words">
                        {row.error}
                      </p>
                    )}
                  </div>
                  <span className={`text-xs font-medium capitalize ${historyStatusClass(row.status)}`}>
                    {row.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const diagnostics = params.diagnostics === "1"
  const mode = params.mode === "full" ? "full" : "backtest"
  const searchQuery = (params.q ?? "").trim().toUpperCase()
  const benchmarkParam = normalizeBenchmark(params.benchmark)
  const benchmarkOptions = new Set<string>(BENCHMARK_OPTIONS)
  const selectedBenchmark = benchmarkOptions.has(benchmarkParam)
    ? benchmarkParam
    : BENCHMARK_OPTIONS[0]
  const hasExplicitBenchmark = Boolean(params.benchmark && benchmarkOptions.has(benchmarkParam))

  const [health, dataState, tickerRanges, scheduledActivity] = await Promise.all([
    getDataHealthSummary(),
    getDataState(),
    getAllTickerStats(),
    getActiveScheduledRefreshActivity(),
  ])

  const currentThrough = dataState.dataCutoffDate ?? health.dateEnd
  const requiredResearch = await getRequiredTickerResearchSummary(currentThrough, tickerRanges)
  const universeNotIngested = await getNotIngestedUniverseTickers(tickerRanges)

  const advancedDiagnostics = mode === "full"
    ? summarizeInceptionAwareCoverage({
        ranges: tickerRanges,
        globalStart: health.dateStart,
        globalEnd: currentThrough,
      })
    : null

  const [benchmarkJobs, jobHistory] = mode === "full"
    ? await Promise.all([
        getLatestDataIngestJobs(BENCHMARK_OPTIONS),
        getRecentDataIngestJobHistory(15),
      ])
    : [
        {} as Awaited<ReturnType<typeof getLatestDataIngestJobs>>,
        [] as DataIngestJobHistoryEntry[],
      ]

  const researchRowsSorted = [...requiredResearch.rows]
    .filter((row) => row.trueMissingDays > 0)
    .sort((a, b) => b.trueMissingDays - a.trueMissingDays)
  const filteredResearchRows = searchQuery
    ? researchRowsSorted.filter((row) => row.ticker.includes(searchQuery))
    : researchRowsSorted
  const backtestTopIssues = toResearchTableRows(filteredResearchRows.slice(0, 10))

  const advancedMissingRows = advancedDiagnostics
    ? (searchQuery
      ? advancedDiagnostics.rows.filter((row) => row.ticker.includes(searchQuery))
      : advancedDiagnostics.rows)
        .filter((row) => row.trueMissingDays > 0)
        .sort((a, b) => b.trueMissingDays - a.trueMissingDays)
    : []

  const selectedBenchmarkRow =
    requiredResearch.rows.find((row) => row.ticker === selectedBenchmark) ?? null
  const benchmarkTrueMissingRate =
    selectedBenchmarkRow && selectedBenchmarkRow.expectedDays > 0
      ? selectedBenchmarkRow.trueMissingDays / selectedBenchmarkRow.expectedDays
      : 1
  const benchmarkMaxGapDays = selectedBenchmarkRow?.maxGapDays ?? 0
  const healthAssessment = assessDataHealth({
    completeness: requiredResearch.completeness,
    requiredNotIngested: requiredResearch.notIngestedTickers.length,
    trueMissingRate: requiredResearch.trueMissingRate,
    maxGapDays: Math.max(0, ...requiredResearch.rows.map((row) => row.maxGapDays)),
    benchmarkTicker: selectedBenchmark,
    benchmarkTrueMissingRate,
    benchmarkMaxGapDays,
  })

  const verdict = healthVerdict(healthAssessment.status)
  const { Icon: VerdictIcon } = verdict
  const refreshTotals = scheduledActivity.monthlyActiveJobs + scheduledActivity.dailyActiveJobs
  const monthlyStatus = formatScheduleStatus(scheduledActivity.monthlyActiveJobs)
  const dailyStatus = formatScheduleStatus(scheduledActivity.dailyActiveJobs)
  const benchmarkStatus = getBenchmarkRepairStatus(requiredResearch.rows)

  const benchmarkRows = mode === "full"
    ? BENCHMARK_OPTIONS.map((ticker) => {
        const researchRow = requiredResearch.rows.find((row) => row.ticker === ticker) ?? null
        const range = tickerRanges.find((row) => row.ticker === ticker) ?? null
        const inceptionDate = TICKER_INCEPTION_DATES[ticker] ?? null
        const actualDays = researchRow?.actualDays ?? 0
        const expectedDays = researchRow?.expectedDays ?? 0
        const coveragePercent = researchRow?.coveragePercent ?? 0
        const status: BenchmarkCoverage["status"] =
          actualDays === 0
            ? "not_ingested"
            : coveragePercent < 50
              ? "missing"
              : coveragePercent < 99
                ? "partial"
                : "ok"

        return {
          ticker,
          coverage: {
            ticker,
            actualDays,
            expectedDays,
            missingDays: researchRow?.trueMissingDays ?? expectedDays,
            coveragePercent,
            latestDate: range?.lastDate ?? researchRow?.lastObservedDate ?? null,
            earliestDate: range?.firstDate ?? researchRow?.firstObservedDate ?? null,
            needsHistoricalBackfill:
              range?.firstDate != null && inceptionDate != null
                ? range.firstDate > inceptionDate
                : false,
            status,
          },
          initialJob: benchmarkJobs[ticker] ?? null,
        }
      })
    : []

  function buildDataHref(nextMode: "backtest" | "full") {
    const hrefParams = new URLSearchParams()
    if (nextMode === "full") {
      hrefParams.set("mode", "full")
    }
    if (params.q) {
      hrefParams.set("q", params.q)
    }
    if (diagnostics) {
      hrefParams.set("diagnostics", "1")
    }
    if (hasExplicitBenchmark && params.benchmark) {
      hrefParams.set("benchmark", params.benchmark)
    }
    const queryString = hrefParams.toString()
    return queryString ? `/data?${queryString}` : "/data"
  }

  return (
    <AppShell title="Data">
      {refreshTotals > 0 && (
        <Card className="mb-3 border-blue-800/40 bg-blue-950/30">
          <CardContent className="flex items-start gap-3 py-4">
            <Activity className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-400" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                Scheduled data refresh running
              </p>
              <p className="mt-0.5 text-xs text-blue-300/90">
                Monthly: {scheduledActivity.monthlyActiveJobs} job{scheduledActivity.monthlyActiveJobs !== 1 ? "s" : ""}
                {" · "}
                Daily patch: {scheduledActivity.dailyActiveJobs} job{scheduledActivity.dailyActiveJobs !== 1 ? "s" : ""}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form method="GET" action="/data" className="flex min-w-[160px] max-w-xs flex-1 items-center gap-1.5">
          {mode === "full" && <input type="hidden" name="mode" value="full" />}
          {diagnostics && <input type="hidden" name="diagnostics" value="1" />}
          {hasExplicitBenchmark && params.benchmark && (
            <input type="hidden" name="benchmark" value={params.benchmark} />
          )}
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              name="q"
              defaultValue={params.q ?? ""}
              placeholder={mode === "full" ? "Search tickers…" : "Filter top issues…"}
              className="w-full rounded-md border border-border bg-muted/40 py-1.5 pl-7 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </form>

        <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          <Link
            href={buildDataHref("backtest")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "backtest"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Backtest-ready
          </Link>
          <Link
            href={buildDataHref("full")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "full"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Advanced
          </Link>
        </div>
      </div>

      <div className="mb-4">
        <p className="text-xs text-muted-foreground">
          {mode === "backtest"
            ? <>Backtest-ready watches only required universe and benchmark tickers inside the research window, capped at <span className="font-mono text-foreground">{formatISODate(currentThrough)}</span>.</>
            : <>Advanced expands into DB-wide coverage, benchmark repair state, and recent ingestion jobs while keeping the same global cutoff at <span className="font-mono text-foreground">{formatISODate(currentThrough)}</span>.</>}
        </p>
      </div>

      {mode === "full" && (
        <div className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <div className="flex gap-2">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p>
                Advanced diagnostics includes DB-wide earliest coverage, pre-inception counts, benchmark repair state, and recent ingestion job outcomes.
              </p>
              <p>
                Diagnostics is {diagnostics ? "enabled" : "off"}.
                {diagnostics
                  ? " Repair controls and raw error messages are visible."
                  : " Repair controls stay hidden until you opt in."}
              </p>
            </div>
          </div>
        </div>
      )}

      <Card className={`mb-4 border bg-card ${verdict.borderCls}`}>
        <CardContent className="flex items-start gap-3 py-4">
          <VerdictIcon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${verdict.textCls}`} />
          <div>
            <p className="text-sm font-semibold text-foreground">
              Data Health: <span className={verdict.textCls}>{verdict.label}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {healthAssessment.reason}
              {mode === "full" && " Health is still scored on the required backtest research window; the panels below add deeper diagnostics."}
            </p>
          </div>
        </CardContent>
      </Card>

      {mode === "backtest" ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <SummaryMetricCard
              title="Tickers Ingested"
              tooltip="Required universe + benchmark tickers currently present in the monitored research window."
              value={`${requiredResearch.ingestedTickers} / ${requiredResearch.requiredTickers.length}`}
              meta="Required set only"
              icon={<Database className="h-5 w-5 text-muted-foreground" />}
            />
            <SummaryMetricCard
              title="Current Through"
              tooltip="The global data cutoff used for backtests and coverage checks."
              value={formatISODate(currentThrough)}
              meta="Last complete trading day"
              valueClassName="font-mono text-lg font-semibold text-foreground"
              icon={<Calendar className="h-5 w-5 text-muted-foreground" />}
            />
            <SummaryMetricCard
              title="Completeness"
              tooltip="Actual rows divided by expected research-window trading days for required tickers only."
              value={requiredResearch.completeness !== null ? `${requiredResearch.completeness.toFixed(1)}%` : "—"}
              meta={`${requiredResearch.totalActual.toLocaleString()} / ${requiredResearch.totalExpected.toLocaleString()} monitored rows`}
              valueClassName={`text-2xl font-semibold ${
                healthAssessment.status === "GOOD"
                  ? "text-emerald-400"
                  : healthAssessment.status === "WARNING"
                    ? "text-amber-400"
                    : healthAssessment.status === "DEGRADED"
                      ? "text-red-400"
                      : "text-muted-foreground"
              }`}
              icon={<ShieldCheck className="h-5 w-5 text-muted-foreground" />}
            />
            <SummaryMetricCard
              title="True Missing"
              tooltip="Missing trading days inside the required research window. Pre-inception history is excluded."
              value={requiredResearch.totalTrueMissing.toLocaleString()}
              meta={requiredResearch.totalTrueMissing > 0 ? "Gaps that can affect backtests" : "No true gaps detected"}
              valueClassName={`text-2xl font-semibold ${
                requiredResearch.totalTrueMissing > 0 ? "text-amber-400" : "text-emerald-400"
              }`}
              icon={<AlertTriangle className="h-5 w-5 text-muted-foreground" />}
            />
          </div>

          <Card className="mb-4 border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-foreground">
                Data Cutoff Mode
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Backtest-ready stays pinned to the cutoff and does not expose manual repair controls.
              </p>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Update Schedule</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  Monthly
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  next run: <span className="font-mono text-foreground">{dataState.nextMonthlyRefresh}</span> UTC
                </p>
                <p className={`mt-0.5 text-xs ${monthlyStatus.cls}`}>Status: {monthlyStatus.label}</p>
              </div>
              <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Daily Patch</p>
                <p className={`mt-1 text-sm font-semibold ${dataState.dailyUpdatesEnabled ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {dataState.dailyUpdatesEnabled ? "Enabled" : "Disabled"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {dataState.dailyUpdatesEnabled
                    ? `Scheduled at ${String(DAILY_PATCH_RUN_HOUR_UTC).padStart(2, "0")}:00 UTC`
                    : "Daily patch: Disabled"}
                </p>
                <p className={`mt-0.5 text-xs ${dailyStatus.cls}`}>Status: {dailyStatus.label}</p>
              </div>
              <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Benchmarks</p>
                <p className={`mt-1 text-sm font-semibold ${benchmarkStatus.cls}`}>
                  {benchmarkStatus.label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {benchmarkStatus.issues.length === 0
                    ? "All supported benchmarks are healthy inside the research window."
                    : `${benchmarkStatus.issues.length} benchmark${benchmarkStatus.issues.length !== 1 ? "s" : ""} still need repair. Details live in Advanced.`}
                </p>
              </div>
            </CardContent>
          </Card>

          <UniverseTierSummary
            ranges={tickerRanges}
            notIngested={universeNotIngested}
            mode={mode}
          />

          {requiredResearch.notIngestedTickers.length > 0 && (
            <div className="mt-4 mb-4 flex items-start gap-2 rounded-md border border-amber-800/40 bg-amber-950/30 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
              <p className="text-xs text-amber-300/80">
                <strong>Missing from the required dataset:</strong>{" "}
                <span className="font-mono">{requiredResearch.notIngestedTickers.join(", ")}</span>.
                Repairs run in the background and can be inspected in Advanced.
              </p>
            </div>
          )}

          <Card className="mb-4 border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-foreground">
                Top Issues
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                The 10 required tickers with the most true missing days inside the research window.
              </p>
            </CardHeader>
            <CardContent>
              <TopMissingTable
                rows={backtestTopIssues}
                initialRows={10}
                allowExpand={false}
                showPreInception={false}
                firstDateLabel="Research Start"
                emptyMessage="No required-ticker gaps detected inside the monitored research window."
              />
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-6">
            <SummaryMetricCard
              title="DB Tickers"
              tooltip="Distinct tickers with price data anywhere in the database."
              value={health.tickersCount > 0 ? health.tickersCount : "—"}
              icon={<Database className="h-5 w-5 text-muted-foreground" />}
            />
            <SummaryMetricCard
              title="Earliest Coverage"
              tooltip="The earliest date visible in the database-wide diagnostic view."
              value={formatISODate(health.dateStart)}
              valueClassName="font-mono text-lg font-semibold text-foreground"
              icon={<Clock3 className="h-5 w-5 text-muted-foreground" />}
            />
            <SummaryMetricCard
              title="Current Through"
              tooltip="The fixed data cutoff shared by diagnostics and backtests."
              value={formatISODate(currentThrough)}
              valueClassName="font-mono text-lg font-semibold text-foreground"
              icon={<Calendar className="h-5 w-5 text-muted-foreground" />}
            />
            <SummaryMetricCard
              title="Update Schedule"
              tooltip="Scheduled refresh cadence for required tickers."
              value="Monthly"
              meta={
                <>
                  next run: <span className="font-mono text-foreground">{dataState.nextMonthlyRefresh}</span> UTC
                  <br />
                  <span className={monthlyStatus.cls}>Status: {monthlyStatus.label}</span>
                </>
              }
              valueClassName="text-lg font-semibold text-foreground"
              icon={<Activity className="h-5 w-5 text-muted-foreground" />}
            />
            <SummaryMetricCard
              title="Daily Patch"
              tooltip="Short rolling repair pass for required tickers only."
              value={dataState.dailyUpdatesEnabled ? "Enabled" : "Disabled"}
              meta={
                <>
                  {dataState.dailyUpdatesEnabled
                    ? `Scheduled at ${String(DAILY_PATCH_RUN_HOUR_UTC).padStart(2, "0")}:00 UTC`
                    : "Daily patch: Disabled"}
                  <br />
                  <span className={dailyStatus.cls}>Status: {dailyStatus.label}</span>
                </>
              }
              valueClassName={`text-lg font-semibold ${dataState.dailyUpdatesEnabled ? "text-emerald-400" : "text-muted-foreground"}`}
              icon={<Wrench className="h-5 w-5 text-muted-foreground" />}
            />
            <SummaryMetricCard
              title="Pre-Inception"
              tooltip="DB-wide pre-inception days excluded from missingness calculations."
              value={advancedDiagnostics?.totalPreInception.toLocaleString() ?? "—"}
              icon={<Info className="h-5 w-5 text-muted-foreground" />}
            />
          </div>

          <UniverseTierSummary
            ranges={tickerRanges}
            notIngested={universeNotIngested}
            mode={mode}
          />

          {requiredResearch.notIngestedTickers.length > 0 && (
            <div className="mt-4 mb-4 flex items-start gap-2 rounded-md border border-amber-800/40 bg-amber-950/30 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
              <p className="text-xs text-amber-300/80">
                <strong>Required tickers still missing:</strong>{" "}
                <span className="font-mono">{requiredResearch.notIngestedTickers.join(", ")}</span>.
                Scheduled jobs will repair these automatically; diagnostics exposes the raw job state.
              </p>
            </div>
          )}

          <div className="mb-4 grid gap-4 md:grid-cols-7">
            <Card className="bg-card border-border md:col-span-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-foreground">
                  Tickers with True Gaps
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  DB-wide true missing days within each ticker&apos;s own window through the current cutoff. Pre-inception history is shown separately.
                </p>
              </CardHeader>
              <CardContent>
                <TopMissingTable rows={advancedMissingRows} initialRows={20} />
              </CardContent>
            </Card>

            <div className="flex flex-col gap-4 md:col-span-3">
              <BenchmarkCoverageCard
                benchmarks={benchmarkRows}
                isDev={process.env.NODE_ENV !== "production"}
              />
              <HistoryCard rows={jobHistory} diagnostics={diagnostics} />
            </div>
          </div>
        </>
      )}

      <Card className="bg-card border-border">
        <CardContent className="flex items-start gap-3 py-4">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <div>
            <p className="mb-1 text-xs font-semibold text-foreground">
              Inception-aware coverage
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              FactorLab keeps the visible dataset capped at a global cutoff date. Backtest-ready measures only the required ticker set inside each universe&apos;s research window. Advanced keeps the same cutoff but expands into DB-wide historical diagnostics, benchmark repair state, and recent job outcomes.
            </p>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  )
}
