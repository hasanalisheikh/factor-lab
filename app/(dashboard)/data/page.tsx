import { AppShell } from "@/components/layout/app-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  getDataHealthSummary,
  getTopMissingTickersV2,
  getNotIngestedUniverseTickers,
  getAllBenchmarkCoverage,
  getRecentIngestionHistory,
  getLatestDataIngestJobs,
  autoQueueBenchmarkIngestions,
  getTickerDateRanges,
} from "@/lib/supabase/queries"
import { BENCHMARK_OPTIONS } from "@/lib/benchmark"
import { COVERAGE_WINDOW_START } from "@/lib/supabase/types"
import {
  formatISODate,
  formatISOTimestamp,
  daysAgoFromNow,
  getFreshnessStatus,
} from "@/lib/utils/dates"
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
  XCircle,
  AlertCircle,
} from "lucide-react"
import Link from "next/link"

export const dynamic = "force-dynamic"

// ---------------------------------------------------------------------------
// Derived helpers (pure, server-only)
// ---------------------------------------------------------------------------

function freshnessLabel(status: ReturnType<typeof getFreshnessStatus>) {
  if (status === "unknown")
    return { label: "Unknown", className: "text-muted-foreground bg-muted" }
  if (status === "fresh")
    return {
      label: "Fresh",
      className: "text-emerald-400 bg-emerald-950/40 border border-emerald-800/50",
    }
  if (status === "stale")
    return {
      label: "Stale",
      className: "text-amber-400 bg-amber-950/40 border border-amber-800/50",
    }
  return {
    label: "Outdated",
    className: "text-red-400 bg-red-950/40 border border-red-800/50",
  }
}

function healthVerdict(completeness: number | null) {
  if (completeness === null)
    return {
      label: "No Data",
      desc: "No price data found in the database.",
      Icon: XCircle,
      textCls: "text-muted-foreground",
      borderCls: "border-border",
    }
  if (completeness >= 99)
    return {
      label: "Good",
      desc: `Inception-aware coverage is ${completeness.toFixed(1)}% complete. Backtests should be reliable.`,
      Icon: CheckCircle2,
      textCls: "text-emerald-400",
      borderCls: "border-emerald-800/40",
    }
  if (completeness >= 95)
    return {
      label: "Warning",
      desc: `Inception-aware coverage is ${completeness.toFixed(1)}%. Some tickers have gaps that may affect signal quality.`,
      Icon: AlertCircle,
      textCls: "text-amber-400",
      borderCls: "border-amber-800/40",
    }
  return {
    label: "Degraded",
    desc: `Inception-aware coverage is only ${completeness.toFixed(1)}%. Significant gaps may bias backtest returns.`,
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
  const mode = params.mode === "full" ? "full" : "backtest"

  const health = await getDataHealthSummary()

  // In backtest mode use the fixed coverage window start; in full mode use DB global min.
  const windowStart = mode === "backtest" ? COVERAGE_WINDOW_START : health.dateStart

  // Phase 1: fetch coverage + other data in parallel (jobs fetched after auto-queue)
  const [topMissingV2, notIngested, allBenchmarkCovs, ingestionLog, tickerRanges] =
    await Promise.all([
      getTopMissingTickersV2(50, windowStart, health.dateEnd),
      getNotIngestedUniverseTickers(),
      getAllBenchmarkCoverage(health.dateStart, health.dateEnd, health.businessDaysInWindow),
      getRecentIngestionHistory(5),
      getTickerDateRanges(),
    ])

  // Phase 2: auto-queue any benchmarks that need ingestion/backfill (idempotent)
  await autoQueueBenchmarkIngestions(allBenchmarkCovs)

  // Phase 3: fetch jobs after auto-queue so newly queued jobs appear in initialJob
  const allIngestJobs = await getLatestDataIngestJobs(BENCHMARK_OPTIONS)

  const benchmarkRows = BENCHMARK_OPTIONS.map((ticker) => ({
    ticker,
    coverage: allBenchmarkCovs.find((c) => c.ticker === ticker) ?? null,
    initialJob: allIngestJobs[ticker] ?? null,
  }))

  const freshnessStatus = getFreshnessStatus(health.lastUpdatedAt)
  const daysAgo = daysAgoFromNow(health.lastUpdatedAt)
  const freshness = freshnessLabel(freshnessStatus)

  // Inception-aware completeness: total actual / total expected (within each ticker's own window)
  const totalExpected = topMissingV2.reduce((s, r) => s + r.expectedDays, 0)
  const totalActualForMissing = topMissingV2.reduce((s, r) => s + r.actualDays, 0)
  const inceptionAwareCompleteness =
    totalExpected > 0 && topMissingV2.length > 0
      ? Math.min((totalActualForMissing / totalExpected) * 100, 100)
      : health.completenessPercent  // fallback to original if V2 not available

  const verdict = healthVerdict(inceptionAwareCompleteness)
  const { Icon: VerdictIcon } = verdict

  // Aggregate missingness breakdown
  const totalTrueMissing = topMissingV2.reduce((s, r) => s + r.trueMissingDays, 0)
  const totalPreInception = topMissingV2.reduce((s, r) => s + r.preInceptionDays, 0)

  const isDev = process.env.NODE_ENV !== "production"

  return (
    <AppShell title="Data">
      {/* ------------------------------------------------------------------ */}
      {/* Product copy                                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="mb-1">
        <p className="text-sm text-foreground">
          Monitor price coverage, detect gaps that bias signals, and ingest/backfill
          tickers and benchmarks so backtests remain reliable.
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Backtest-ready focuses on your recommended research window; Full history
          shows DB-wide earliest coverage and pre-inception counts.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Mode toggle                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-center gap-1 mb-4 p-1 rounded-lg bg-muted/40 border border-border w-fit">
        <Link
          href="/data"
          className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
            mode === "backtest"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Backtest-ready
        </Link>
        <Link
          href="/data?mode=full"
          className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
            mode === "full"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Full history
        </Link>
      </div>

      {mode === "full" && (
        <div className="flex items-start gap-2 mb-4 px-3 py-2 rounded-md bg-amber-950/30 border border-amber-800/40">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300/80">
            <strong>Full history mode:</strong> Coverage window starts at the DB global minimum. Pre-inception
            counts are large because tickers like TSLA, META, AVGO did not exist yet — this is expected.
          </p>
        </div>
      )}

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
            <p className="text-xs text-muted-foreground mt-0.5">{verdict.desc}</p>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Metrics grid                                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-5 mb-4">
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

        {/* Coverage Window */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
              Coverage Window
              <InfoTooltip text="Earliest and latest trading date present across all tickers in the database." />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground font-mono leading-snug">
              {health.dateStart && health.dateEnd ? (
                <>
                  {formatISODate(health.dateStart)}
                  <br />
                  <span className="text-muted-foreground">→ </span>
                  {formatISODate(health.dateEnd)}
                </>
              ) : (
                "—"
              )}
            </p>
            <Calendar className="w-5 h-5 text-muted-foreground flex-shrink-0" />
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
                inceptionAwareCompleteness === null
                  ? "text-muted-foreground"
                  : inceptionAwareCompleteness >= 99
                    ? "text-emerald-400"
                    : inceptionAwareCompleteness >= 95
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
                inceptionAwareCompleteness !== null && inceptionAwareCompleteness >= 99
                  ? "text-emerald-400"
                  : "text-muted-foreground"
              }`}
            />
          </CardContent>
        </Card>

        {/* Last Updated + freshness badge */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
              Last Updated
              <InfoTooltip text="Timestamp of the most recent data ingestion run recorded in data_last_updated." />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-mono text-foreground leading-snug">
                {formatISOTimestamp(health.lastUpdatedAt)}
              </p>
              <Clock3 className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${freshness.className}`}
              >
                {freshness.label}
              </span>
              {daysAgo !== null && (
                <span className="text-[10px] text-muted-foreground">
                  {daysAgo === 0 ? "today" : `${daysAgo}d ago`}
                </span>
              )}
            </div>
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
            <strong>Universe tickers not ingested:</strong>{" "}
            <span className="font-mono">{notIngested.join(", ")}</span>. These tickers appear in universe
            presets but have no price data. Runs using these universes will skip them.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Two-column: top-missing + benchmark/ingestion                      */}
      {/* ------------------------------------------------------------------ */}
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
            benchmarks={benchmarkRows}
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
