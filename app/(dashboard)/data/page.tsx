import { AppShell } from "@/components/layout/app-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  getDataHealthSummary,
  getDataState,
  getNotIngestedUniverseTickers,
  getAllBenchmarkCoverage,
  getRecentIngestionHistory,
  getLatestDataIngestJobs,
  getAllTickerStats,
  getActiveIngestJobCount,
} from "@/lib/supabase/queries"
import { BENCHMARK_OPTIONS, normalizeBenchmark } from "@/lib/benchmark"
import { COVERAGE_WINDOW_START } from "@/lib/supabase/types"
import {
  formatISODate,
  formatISOTimestamp,
  countBusinessDaysInclusive,
} from "@/lib/utils/dates"
import {
  assessDataHealth,
  calendarGapToTradingDays,
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
  Database,
  Info,
  XCircle,
  AlertCircle,
  Loader2,
  Search,
} from "lucide-react"
import Link from "next/link"

export const dynamic = "force-dynamic"

// ---------------------------------------------------------------------------
// Derived helpers (pure, server-only)
// ---------------------------------------------------------------------------

function healthVerdict(status: HealthStatus) {
  if (status === "NO_DATA")
    return {
      label: "No Data",
      Icon: XCircle,
      textCls: "text-muted-foreground",
      borderCls: "border-border",
    }
  if (status === "GOOD")
    return {
      label: "Good",
      Icon: CheckCircle2,
      textCls: "text-emerald-400",
      borderCls: "border-emerald-800/40",
    }
  if (status === "WARNING")
    return {
      label: "Warning",
      Icon: AlertCircle,
      textCls: "text-amber-400",
      borderCls: "border-amber-800/40",
    }
  return {
    label: "Degraded",
    Icon: XCircle,
    textCls: "text-red-400",
    borderCls: "border-red-800/40",
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

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

  const [health, dataState] = await Promise.all([
    getDataHealthSummary(),
    getDataState(),
  ])

  // In backtest mode use the fixed coverage window start; in full mode use the
  // earliest visible date. Both modes stop at the global data cutoff.
  const windowStart = mode === "backtest" ? COVERAGE_WINDOW_START : health.dateStart
  const windowEnd = dataState.dataCutoffDate ?? health.dateEnd
  const businessDaysInWindow =
    windowStart && windowEnd && windowStart <= windowEnd
      ? countBusinessDaysInclusive(
          new Date(`${windowStart}T00:00:00Z`),
          new Date(`${windowEnd}T00:00:00Z`)
        )
      : 0

  // Phase 1: fetch ticker stats ONCE from ticker_stats cache + other data in parallel.
  // getAllTickerStats() reads the cached table (one row/ticker) — no full GROUP BY on prices.
  // The result is passed into the in-memory completeness/health summary and
  // getNotIngestedUniverseTickers so neither path makes a second DB call.
  const [tickerRanges, allBenchmarkCovs, ingestionLog, activeJobCount, allIngestJobs] =
    await Promise.all([
      getAllTickerStats(),
      getAllBenchmarkCoverage(windowStart, windowEnd, businessDaysInWindow),
      diagnostics ? getRecentIngestionHistory(5) : Promise.resolve([]),
      diagnostics ? getActiveIngestJobCount() : Promise.resolve(0),
      diagnostics
        ? getLatestDataIngestJobs(BENCHMARK_OPTIONS)
        : Promise.resolve({} as Awaited<ReturnType<typeof getLatestDataIngestJobs>>),
    ])

  const inceptionAware = summarizeInceptionAwareCoverage({
    ranges: tickerRanges,
    globalStart: windowStart,
    globalEnd: windowEnd,
  })
  const topMissingV2Raw = inceptionAware.rows
    .filter((row) => row.trueMissingDays > 0)
    .sort((a, b) => b.trueMissingDays - a.trueMissingDays)
    .slice(0, 50)
  const notIngested = await getNotIngestedUniverseTickers(tickerRanges)

  // Apply ticker search filter (server-side, from ?q= param)
  const topMissingV2 = searchQuery
    ? topMissingV2Raw.filter((r: { ticker: string }) => r.ticker.includes(searchQuery))
    : topMissingV2Raw

  const benchmarkRows = diagnostics
    ? BENCHMARK_OPTIONS.map((ticker) => ({
        ticker,
        coverage: (allBenchmarkCovs ?? []).find((c: { ticker: string }) => c.ticker === ticker) ?? null,
        initialJob: allIngestJobs[ticker] ?? null,
      }))
    : []

  // Inception-aware completeness: total actual / total expected (within each ticker's own window).
  // Always computed from unfiltered data so search doesn't affect the health metrics.
  const inceptionAwareCompleteness =
    inceptionAware.completeness ?? health.completenessPercent

  // Aggregate missingness breakdown (unfiltered)
  const totalTrueMissing = inceptionAware.totalTrueMissing
  const totalPreInception = inceptionAware.totalPreInception

  // ── Multi-metric health inputs ───────────────────────────────────────────────
  const trueMissingRate = inceptionAware.trueMissingRate

  // Convert cached calendar-day gaps into trading-day-equivalent thresholds.
  const maxGapDays = tickerRanges.reduce(
    (max, r) => Math.max(max, calendarGapToTradingDays(r.maxGapDays ?? 0)),
    0
  )

  const selectedBenchmarkCoverage =
    (allBenchmarkCovs ?? []).find((coverage) => coverage.ticker === selectedBenchmark) ?? null
  const selectedBenchmarkRange =
    tickerRanges.find((range) => range.ticker === selectedBenchmark) ?? null
  const selectedBenchmarkRow =
    inceptionAware.rows.find((row) => row.ticker === selectedBenchmark) ?? null
  const benchmarkTrueMissingRate =
    selectedBenchmarkRow && selectedBenchmarkRow.expectedDays > 0
      ? selectedBenchmarkRow.trueMissingDays / selectedBenchmarkRow.expectedDays
      : selectedBenchmarkCoverage && selectedBenchmarkCoverage.expectedDays > 0
        ? selectedBenchmarkCoverage.missingDays / selectedBenchmarkCoverage.expectedDays
        : selectedBenchmarkRange
          ? 0
          : 1
  const benchmarkMaxGapDays = calendarGapToTradingDays(selectedBenchmarkRange?.maxGapDays ?? 0)

  const healthAssessment = assessDataHealth({
    completeness: inceptionAwareCompleteness,
    requiredNotIngested: notIngested.length,
    trueMissingRate,
    maxGapDays,
    benchmarkTicker: selectedBenchmark,
    benchmarkTrueMissingRate,
    benchmarkMaxGapDays,
  })

  const healthStatus = healthAssessment.status
  const verdict = healthVerdict(healthStatus)
  const { Icon: VerdictIcon } = verdict

  const isDev = process.env.NODE_ENV !== "production"

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
      {/* ------------------------------------------------------------------ */}
      {/* Active-ingestion banner                                             */}
      {/* ------------------------------------------------------------------ */}
      {diagnostics && activeJobCount > 0 && (
        <Card className="mb-3 border-blue-800/40 bg-blue-950/30">
          <CardContent className="flex items-start gap-3 py-4">
            <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-blue-400" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                Updating market data ({activeJobCount} job{activeJobCount !== 1 ? "s" : ""})
              </p>
              <p className="mt-0.5 text-xs text-blue-300/90">
                Data cutoff will advance when complete.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Search bar + mode toggle (inline row)                              */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* Ticker search — GET form so URL stays shareable */}
        <form method="GET" action="/data" className="flex items-center gap-1.5 flex-1 min-w-[160px] max-w-xs">
          {/* Preserve mode param if active */}
          {mode === "full" && <input type="hidden" name="mode" value="full" />}
          {diagnostics && <input type="hidden" name="diagnostics" value="1" />}
          {hasExplicitBenchmark && params.benchmark && (
            <input type="hidden" name="benchmark" value={params.benchmark} />
          )}
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Search tickers…"
              className="w-full pl-7 pr-3 py-1.5 text-xs bg-muted/40 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </form>

        {/* Mode toggle */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border w-fit">
          <Link
            href={buildDataHref("backtest")}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              mode === "backtest"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Backtest-ready
          </Link>
          <Link
            href={buildDataHref("full")}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              mode === "full"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Advanced
          </Link>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Product copy                                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="mb-3">
        <p className="text-xs text-muted-foreground">
          FactorLab now runs against a fixed dataset cutoff instead of chasing the newest rows all day. Coverage and missingness are measured only through{" "}
          <span className="font-mono text-foreground">{formatISODate(windowEnd)}</span>.
          {mode === "full" && (
            <> Advanced mode shows the wider visible history while keeping the same cutoff.</>
          )}
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Data explainer callout                                              */}
      {/* ------------------------------------------------------------------ */}
      <div className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <div className="flex gap-2">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
          <dl className="text-xs text-muted-foreground space-y-2">
            <div>
              <dt className="font-medium text-foreground">Why data can be incomplete</dt>
              <dd className="mt-0.5">Market data isn&apos;t always perfectly continuous. Some assets didn&apos;t exist in earlier years, providers occasionally miss days, and newly fetched rows should not immediately change the effective backtest window.</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">What FactorLab does</dt>
              <dd className="mt-0.5">FactorLab is inception-aware, caps the visible dataset at a global cutoff date, and advances that cutoff on scheduled refreshes. If missing data would bias a run inside that cutoff, FactorLab will surface it in diagnostics and preflight checks.</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">How to interpret the score</dt>
              <dd className="mt-0.5">&ldquo;Completeness&rdquo; reflects true gaps within each ticker&apos;s available history up to the current cutoff. It does not penalize periods before a ticker existed or dates after the cutoff.</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Health verdict banner                                               */}
      {/* ------------------------------------------------------------------ */}
      <Card className={`bg-card border ${verdict.borderCls} mb-4`}>
        <CardContent className="flex items-start gap-3 py-4">
          <VerdictIcon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${verdict.textCls}`} />
          <div>
            <p className="text-sm font-semibold text-foreground">
              Data Health:{" "}
              <span className={verdict.textCls}>{verdict.label}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{healthAssessment.reason}</p>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Metrics grid                                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6 mb-4">
        {/* Tickers Ingested */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
              Tickers Ingested
              <InfoTooltip text="Total distinct tickers with price data in the database." />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-2xl font-semibold text-foreground">
              {health.tickersCount > 0 ? health.tickersCount : "—"}
            </p>
            <Database className="w-5 h-5 text-muted-foreground" />
          </CardContent>
        </Card>

        {/* Current Through */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
              Current Through
              <InfoTooltip text="The fixed maximum date used for coverage, diagnostics, and backtest end dates." />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground font-mono leading-snug">
              {windowEnd ? (
                <>
                  {formatISODate(windowEnd)}
                  <br />
                  <span className="text-muted-foreground">Last complete trading day</span>
                </>
              ) : (
                "—"
              )}
            </p>
            <Calendar className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          </CardContent>
        </Card>

        {/* Update schedule */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
              Update Schedule
              <InfoTooltip text="Required monthly refresh cadence for all supported universe and benchmark tickers." />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Monthly</p>
            <p className="text-xs text-muted-foreground">
              next run: <span className="font-mono text-foreground">{dataState.nextMonthlyRefresh}</span> UTC
            </p>
          </CardContent>
        </Card>

        {/* Daily patch */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
              Daily Patch
              <InfoTooltip text="Optional daily gap-repair pass for required tickers. Disabled keeps the dataset on monthly-only updates." />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className={`text-sm font-semibold ${dataState.dailyUpdatesEnabled ? "text-emerald-400" : "text-muted-foreground"}`}>
              {dataState.dailyUpdatesEnabled ? "Enabled" : "Disabled"}
            </p>
            <p className="text-xs text-muted-foreground">
              Last refresh: <span className="font-mono text-foreground">{formatISOTimestamp(dataState.lastUpdateAt)}</span>
            </p>
          </CardContent>
        </Card>

        {/* Inception-aware breakdown card */}
        <Card className="bg-card border-border md:col-span-1 xl:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
              Missingness
              <InfoTooltip text="True Missing: gaps within each ticker's own trading window. Pre-Inception: dates before a ticker launched (not an error). Not Ingested: universe tickers absent from DB." />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">True Missing</span>
              <span className={`font-medium ${totalTrueMissing > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                {topMissingV2.length > 0 ? totalTrueMissing.toLocaleString() : health.missingTickerDays.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Pre-Inception</span>
              <span className="text-muted-foreground/70">
                {totalPreInception.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Not Ingested</span>
              <span className={`font-medium ${notIngested.length > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                {notIngested.length > 0 ? `${notIngested.length} tickers` : "0"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Completeness % (inception-aware) */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
              Completeness
              <InfoTooltip text="Inception-aware: actual rows ÷ expected rows per ticker's own [firstDate, lastDate] window. Pre-inception dates are excluded from the denominator." />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p
              className={`text-2xl font-semibold ${
                healthStatus === "NO_DATA"
                  ? "text-muted-foreground"
                  : healthStatus === "GOOD"
                    ? "text-emerald-400"
                    : healthStatus === "WARNING"
                      ? "text-amber-400"
                      : "text-red-400"
              }`}
            >
              {inceptionAwareCompleteness !== null
                ? `${inceptionAwareCompleteness.toFixed(1)}%`
                : "—"}
            </p>
            <CheckCircle2
              className={`w-5 h-5 ${
                healthStatus === "GOOD" ? "text-emerald-400" : "text-muted-foreground"
              }`}
            />
          </CardContent>
        </Card>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Universe Tier Summary                                               */}
      {/* ------------------------------------------------------------------ */}
      <UniverseTierSummary
        ranges={tickerRanges}
        notIngested={notIngested}
        mode={mode}
      />

      {/* Not-ingested universe tickers alert */}
      {notIngested.length > 0 && (
        <div className="flex items-start gap-2 mb-4 px-3 py-2 rounded-md bg-amber-950/30 border border-amber-800/40">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300/80">
            <strong>Missing from the current cutoff dataset:</strong>{" "}
            <span className="font-mono">{notIngested.join(", ")}</span>. These symbols stay visible in Diagnostics and are picked up by scheduled refreshes or run preflight when needed.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Two-column: top-missing + benchmark/ingestion (diagnostics only)   */}
      {/* ------------------------------------------------------------------ */}
      {diagnostics ? (
        <div className="grid gap-4 md:grid-cols-7 mb-4">
          {/* Most Missing Tickers (inception-aware) */}
          <Card className="bg-card border-border md:col-span-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-foreground">
                Tickers with True Gaps
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Ranked by true missing days (gaps within each ticker&apos;s own trading window).
                Pre-inception dates are shown separately and are not errors.
              </p>
            </CardHeader>
            <CardContent>
              <TopMissingTable rows={topMissingV2} />
            </CardContent>
          </Card>

          {/* Right column */}
          <div className="md:col-span-3 flex flex-col gap-4">
            {/* Benchmark coverage */}
            <BenchmarkCoverageCard
              benchmarks={allBenchmarkCovs === null ? null : benchmarkRows}
              isDev={isDev}
            />

            {/* Ingestion history */}
            <Card className="bg-card border-border flex-1">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-foreground">
                  Recent Ingestion Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ingestionLog.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No ingestion history yet. Records appear here after the first
                    data ingestion run writes to{" "}
                    <span className="font-mono">data_ingestion_log</span>.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {ingestionLog.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-start justify-between gap-2 text-xs border-b border-border/50 last:border-0 pb-2 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-muted-foreground truncate">
                            {formatISOTimestamp(entry.ingested_at)}
                          </p>
                          <p className="text-muted-foreground/70 mt-0.5">
                            {entry.tickers_updated} tickers ·{" "}
                            {entry.rows_upserted.toLocaleString()} rows
                          </p>
                          {entry.note && (
                            <p className="text-muted-foreground/60 mt-0.5 truncate">
                              {entry.note}
                            </p>
                          )}
                        </div>
                        <span
                          className={`flex-shrink-0 font-medium capitalize ${
                            entry.status === "success"
                              ? "text-emerald-400"
                              : entry.status === "partial"
                                ? "text-amber-400"
                                : "text-red-400"
                          }`}
                        >
                          {entry.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <Card className="bg-card border-border mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-foreground">
              Tickers with True Gaps
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Ranked by true missing days (gaps within each ticker&apos;s own trading window).
              Pre-inception dates are shown separately and are not errors.
            </p>
          </CardHeader>
          <CardContent>
            <TopMissingTable rows={topMissingV2} />
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* "What this affects" callout                                         */}
      {/* ------------------------------------------------------------------ */}
      <Card className="bg-card border-border">
        <CardContent className="flex items-start gap-3 py-4">
          <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-foreground mb-1">
              Inception-aware coverage
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              FactorLab tracks each ticker&apos;s first available date separately. A ticker that
              launched in 2004 (e.g. GLD) is not counted as &ldquo;missing&rdquo; before that date — only
              genuine gaps within its own trading history count toward missingness. The equity
              curve and rebalances automatically exclude tickers that have not yet launched at
              each rebalance date.
            </p>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  )
}
