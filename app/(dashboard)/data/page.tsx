import { AppShell } from "@/components/layout/app-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  getDataHealthSummary,
  getTopMissingTickers,
  getBenchmarkCoverage,
  getRecentIngestionHistory,
  getLatestDataIngestJob,
  getUserSettings,
} from "@/lib/supabase/queries"
import {
  formatISODate,
  formatISOTimestamp,
  daysAgoFromNow,
  getFreshnessStatus,
} from "@/lib/utils/dates"
import { InfoTooltip } from "@/components/data/info-tooltip"
import { TopMissingTable } from "@/components/data/top-missing-table"
import { BenchmarkCoverageCard } from "@/components/data/benchmark-coverage-card"
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
      desc: `Coverage is ${completeness.toFixed(1)}% complete. Backtests should be reliable.`,
      Icon: CheckCircle2,
      textCls: "text-emerald-400",
      borderCls: "border-emerald-800/40",
    }
  if (completeness >= 95)
    return {
      label: "Warning",
      desc: `Coverage is ${completeness.toFixed(1)}%. Some tickers have gaps that may affect signal quality.`,
      Icon: AlertCircle,
      textCls: "text-amber-400",
      borderCls: "border-amber-800/40",
    }
  return {
    label: "Degraded",
    desc: `Coverage is only ${completeness.toFixed(1)}%. Significant gaps may bias backtest returns.`,
    Icon: XCircle,
    textCls: "text-red-400",
    borderCls: "border-red-800/40",
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function DataPage() {
  const health = await getDataHealthSummary()

  const userSettings = await getUserSettings()
  const benchmarkTicker = userSettings?.default_benchmark ?? "SPY"

  const [topMissing, benchmarkCov, ingestionLog, latestIngestJob] = await Promise.all([
    getTopMissingTickers(50, health.businessDaysInWindow),
    getBenchmarkCoverage(
      benchmarkTicker,
      health.dateStart,
      health.dateEnd,
      health.businessDaysInWindow
    ),
    getRecentIngestionHistory(5),
    getLatestDataIngestJob(benchmarkTicker),
  ])

  const freshnessStatus = getFreshnessStatus(health.lastUpdatedAt)
  const daysAgo = daysAgoFromNow(health.lastUpdatedAt)
  const freshness = freshnessLabel(freshnessStatus)
  const verdict = healthVerdict(health.completenessPercent)
  const { Icon: VerdictIcon } = verdict

  const isDev = process.env.NODE_ENV !== "production"

  return (
    <AppShell title="Data">
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

        {/* Missing Ticker-Days */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
              Missing Ticker-Days
              <InfoTooltip text="Count of missing (ticker, trading day) rows vs an expected Mon–Fri business-day grid across all tickers and the full coverage window." />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-2xl font-semibold text-foreground">
              {health.tickersCount > 0
                ? health.missingTickerDays.toLocaleString()
                : "—"}
            </p>
            <AlertTriangle
              className={`w-5 h-5 ${
                health.missingTickerDays > 0 ? "text-amber-400" : "text-muted-foreground"
              }`}
            />
          </CardContent>
        </Card>

        {/* Completeness % */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
              Completeness
              <InfoTooltip text="Actual ticker-day rows ÷ expected rows (tickers × business days in coverage window). 100% means no missing rows." />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p
              className={`text-2xl font-semibold ${
                health.completenessPercent === null
                  ? "text-muted-foreground"
                  : health.completenessPercent >= 99
                    ? "text-emerald-400"
                    : health.completenessPercent >= 95
                      ? "text-amber-400"
                      : "text-red-400"
              }`}
            >
              {health.completenessPercent !== null
                ? `${health.completenessPercent.toFixed(1)}%`
                : "—"}
            </p>
            <CheckCircle2
              className={`w-5 h-5 ${
                health.completenessPercent !== null && health.completenessPercent >= 99
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
      {/* Two-column: top-missing + benchmark/ingestion                      */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid gap-4 md:grid-cols-7 mb-4">
        {/* Most Missing Tickers */}
        <Card className="bg-card border-border md:col-span-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-foreground">
              Most Missing Tickers
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Ranked by missing trading days vs the{" "}
              {health.businessDaysInWindow > 0
                ? health.businessDaysInWindow.toLocaleString()
                : "—"}
              -day expected window.
            </p>
          </CardHeader>
          <CardContent>
            <TopMissingTable rows={topMissing} />
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="md:col-span-3 flex flex-col gap-4">
          {/* Benchmark coverage */}
          <BenchmarkCoverageCard
            benchmarkTicker={benchmarkTicker}
            initialBenchmarkCov={benchmarkCov}
            initialIngestJob={latestIngestJob}
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
              What missing data affects
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Missing price rows cause portfolio rebalances to skip those tickers,
              which can bias returns depending on which tickers are absent. Signal
              quality also degrades when momentum or ML features are computed over
              incomplete histories. Runs executed over periods with high missingness
              may be less reliable than their metrics suggest.
            </p>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  )
}
