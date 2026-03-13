import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { isActiveDataIngestStatus } from "@/lib/data-ingest-jobs"
import { STRATEGY_WARMUP_CALENDAR_DAYS } from "@/lib/strategy-warmup"
import { TICKER_INCEPTION_DATES } from "@/lib/supabase/types"
import type { StrategyId } from "@/lib/types"

// ---------------------------------------------------------------------------
// Coverage thresholds
// ---------------------------------------------------------------------------

/**
 * Benchmark must be ≥ 99% covered in the required window.
 * Gaps directly affect "vs {benchmark}" comparisons and equity alignment.
 */
export const BENCHMARK_COVERAGE_THRESHOLD = 0.99

/**
 * Universe symbols must be ≥ 98% covered (standard strategies).
 * Small gaps are tolerated if handled, but major gaps bias selection/ranking.
 */
export const UNIVERSE_COVERAGE_THRESHOLD = 0.98

/**
 * Momentum and ML strategies require tighter universe coverage (≥ 99%)
 * because ranking depends on stable price history across all assets.
 */
export const HIGH_SENSITIVITY_UNIVERSE_THRESHOLD = 0.99

/** Strategies that require HIGH_SENSITIVITY_UNIVERSE_THRESHOLD */
const HIGH_SENSITIVITY_STRATEGIES = new Set<StrategyId>([
  "momentum_12_1",
  "ml_ridge",
  "ml_lightgbm",
])

export function getUniverseThreshold(strategyId: StrategyId): number {
  return HIGH_SENSITIVITY_STRATEGIES.has(strategyId)
    ? HIGH_SENSITIVITY_UNIVERSE_THRESHOLD
    : UNIVERSE_COVERAGE_THRESHOLD
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

/**
 * Count Mon–Fri business days in [startDate, endDate] inclusive.
 * Labeled as "approximation" — does not account for market holidays.
 */
export function countBusinessDays(startDate: string, endDate: string): number {
  const s = new Date(startDate + "T00:00:00Z")
  const e = new Date(endDate + "T00:00:00Z")
  if (e < s) return 0
  let count = 0
  const d = new Date(s)
  while (d <= e) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) count++ // 0=Sun, 6=Sat
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return count
}

/**
 * Returns the most recent "finalized" trading date — yesterday, or last Friday
 * if today is Saturday (yesterday=Friday) or Sunday (two days ago=Friday).
 *
 * This prevents coverage checks from counting today's partially-ingested data
 * as "missing". The auto-maintain cron also uses yesterday as its staleness
 * threshold, so this keeps the two systems in sync.
 */
export function getSafeLastDate(): string {
  const now = new Date()
  // Work in UTC to avoid local-timezone drift
  const dow = now.getUTCDay() // 0=Sun, 6=Sat
  let daysBack = 1 // default: yesterday
  if (dow === 0) daysBack = 2 // Sunday → Friday
  if (dow === 6) daysBack = 1 // Saturday → Friday
  const safe = new Date(now)
  safe.setUTCDate(safe.getUTCDate() - daysBack)
  return safe.toISOString().slice(0, 10)
}

/**
 * Subtract calendar days from a YYYY-MM-DD string.
 * Returns the new date as YYYY-MM-DD.
 */
export function subtractCalendarDays(dateStr: string, days: number): string {
  if (days <= 0) return dateStr
  const d = new Date(dateStr + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Coverage types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Preflight status classification
// ---------------------------------------------------------------------------

/**
 * READY              — all symbols have sufficient coverage; backtest can start now.
 * WAITING_FOR_DATA   — some symbols are below threshold but ingestion can fix it
 *                      automatically. Run is created in waiting_for_data state.
 * USER_ACTION_REQUIRED — coverage is permanently unachievable given the chosen
 *                      date range (e.g. ticker doesn't exist yet). User must
 *                      adjust settings before we create any run.
 */
export type PreflightStatus = "READY" | "WAITING_FOR_DATA" | "USER_ACTION_REQUIRED"

export type SymbolCoverageStatus = "healthy" | "partial" | "not_ingested"

export type SymbolCoverage = {
  symbol: string
  /** True when this symbol is the run benchmark */
  isBenchmark: boolean
  /** Rows found in [requiredStart, requiredEnd] */
  actualDays: number
  /** Business-day count in [requiredStart, requiredEnd] (Mon–Fri approximation) */
  expectedDays: number
  /** actualDays / expectedDays (0–1) */
  coverageRatio: number
  /** Applied threshold (0–1) */
  threshold: number
  status: SymbolCoverageStatus
}

export type PreflightResult = {
  /** Canonical classification — use this to decide what to do next. */
  status: PreflightStatus
  /**
   * Plain-English reasons the run can't proceed as-is.
   * Non-empty only when status ≠ READY.
   * For USER_ACTION_REQUIRED these are the messages shown to the user.
   * For WAITING_FOR_DATA they describe what's being auto-fixed.
   */
  reasons: string[]
  /** @deprecated Use `status === "READY"` instead. Kept for backward compat. */
  allHealthy: boolean
  /** Symbols below their coverage threshold */
  unhealthy: SymbolCoverage[]
  /** All symbols checked */
  all: SymbolCoverage[]
  /** Warmup-adjusted start date used for the coverage window */
  requiredStart: string
  requiredEnd: string
}

// ---------------------------------------------------------------------------
// Preflight classification helpers
// ---------------------------------------------------------------------------

/** Format a YYYY-MM-DD string as "Nov 18, 2004" for user-facing messages. */
function formatDateForMessage(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Add calendar days to a YYYY-MM-DD string, returning a new YYYY-MM-DD. */
function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Classify unhealthy symbols as USER_ACTION_REQUIRED vs WAITING_FOR_DATA.
 *
 * A symbol is USER_ACTION_REQUIRED when it has a known inception date that is
 * later than requiredStart AND even with full price history from inception the
 * coverage ratio would still fall below the threshold. This means ingestion
 * cannot fix the problem — the user must choose a later start date.
 */
function classifyUnhealthySymbols(
  unhealthy: SymbolCoverage[],
  requiredStart: string,
  requiredEnd: string,
  expectedDays: number,
  warmupDays: number
): { status: PreflightStatus; reasons: string[] } {
  if (unhealthy.length === 0) return { status: "READY", reasons: [] }

  const reasons: string[] = []
  let hasUserActionRequired = false

  for (const cov of unhealthy) {
    const inceptionDate = TICKER_INCEPTION_DATES[cov.symbol]

    if (inceptionDate && inceptionDate > requiredStart) {
      // Ticker hasn't existed since requiredStart. Check if even full coverage
      // from inception day forward would satisfy the threshold.
      const maxPossibleDays = countBusinessDays(inceptionDate, requiredEnd)
      if (expectedDays > 0 && maxPossibleDays / expectedDays < cov.threshold) {
        // Permanently insufficient — user must adjust settings.
        hasUserActionRequired = true
        const role = cov.isBenchmark ? "benchmark" : "universe asset"
        const minStart = addCalendarDays(inceptionDate, warmupDays)
        const inceptionFmt = formatDateForMessage(inceptionDate)
        const minStartFmt = formatDateForMessage(minStart)
        if (warmupDays > 0) {
          reasons.push(
            `${cov.symbol} (${role}) started trading on ${inceptionFmt}. ` +
            `This strategy needs ~${warmupDays} calendar days of history before the start date. ` +
            `Please choose a start date of ${minStartFmt} or later.`
          )
        } else {
          reasons.push(
            `${cov.symbol} (${role}) started trading on ${inceptionFmt}. ` +
            `Please choose a start date of ${minStartFmt} or later.`
          )
        }
        continue
      }
    }

    // Fixable by ingestion.
    const role = cov.isBenchmark ? "benchmark" : "universe asset"
    if (cov.status === "not_ingested") {
      reasons.push(
        `We're missing price data for ${cov.symbol} (${role}). ` +
        `Downloading it now — your run will start automatically when ready.`
      )
    } else {
      const pct = (cov.coverageRatio * 100).toFixed(0)
      const thr = (cov.threshold * 100).toFixed(0)
      reasons.push(
        `${cov.symbol} (${role}) has ${pct}% of required price history ` +
        `(need ${thr}%). Downloading missing days now.`
      )
    }
  }

  if (hasUserActionRequired) {
    return { status: "USER_ACTION_REQUIRED", reasons }
  }
  return { status: "WAITING_FOR_DATA", reasons }
}

// ---------------------------------------------------------------------------
// Main preflight check
// ---------------------------------------------------------------------------

/**
 * Check whether all required symbols have sufficient price coverage for the
 * backtest window (including strategy warmup period).
 *
 * Strict mode (default): any symbol below threshold → allHealthy = false.
 *
 * Gap policy:
 *   - Coverage is measured as actualDays / expectedDays using a Mon–Fri
 *     business-day approximation (market holidays are not excluded).
 *   - We do NOT forward-fill to fabricate missing days; missing days are
 *     counted as absent.
 *   - For large gaps (coverage < threshold): run waits for ingestion.
 *   - For Yahoo gaps that persist after ingestion: STRICT runs fail with a
 *     clear diagnostic.
 *
 * Thresholds:
 *   - Benchmark:          ≥ 99%  (BENCHMARK_COVERAGE_THRESHOLD)
 *   - Universe (standard): ≥ 98%  (UNIVERSE_COVERAGE_THRESHOLD)
 *   - Universe (momentum/ML): ≥ 99% (HIGH_SENSITIVITY_UNIVERSE_THRESHOLD)
 */
export async function runPreflightCoverageCheck(params: {
  strategyId: StrategyId
  startDate: string
  endDate: string
  universeSymbols: string[]
  benchmark: string
  dataCutoffDate?: string | null
}): Promise<PreflightResult> {
  const { strategyId, startDate, endDate, universeSymbols, benchmark, dataCutoffDate } = params

  // Warmup-adjusted required window.
  // Cap requiredEnd at the global data cutoff so the preflight never treats
  // dates beyond "Current through" as missing.
  const warmupDays = STRATEGY_WARMUP_CALENDAR_DAYS[strategyId] ?? 0
  const requiredStart = subtractCalendarDays(startDate, warmupDays)
  const requiredEnd =
    dataCutoffDate && dataCutoffDate < endDate ? dataCutoffDate : endDate

  const expectedDays = countBusinessDays(requiredStart, requiredEnd)
  if (expectedDays === 0) {
    return { status: "READY", reasons: [], allHealthy: true, unhealthy: [], all: [], requiredStart, requiredEnd }
  }

  // Unique symbols (benchmark may also be in universe)
  const allSymbols = [...new Set([...universeSymbols, benchmark])]

  // ── universe_valid_from pre-check ─────────────────────────────────────────
  // For tickers with known inception dates, verify that even full coverage from
  // inception would meet the threshold for the requested window. Catching this
  // before the RPC avoids a DB round-trip and gives a cleaner single error.
  {
    const universeThresholdForCheck = getUniverseThreshold(strategyId)
    const expectedForCheck = expectedDays  // same as computed above

    for (const symbol of allSymbols) {
      const inceptionDate = TICKER_INCEPTION_DATES[symbol]
      if (inceptionDate && inceptionDate > requiredStart) {
        const maxPossibleDays = countBusinessDays(inceptionDate, requiredEnd)
        const threshold = symbol === benchmark ? BENCHMARK_COVERAGE_THRESHOLD : universeThresholdForCheck
        if (expectedForCheck > 0 && maxPossibleDays / expectedForCheck < threshold) {
          const role = symbol === benchmark ? "benchmark" : "universe asset"
          const minStart = addCalendarDays(inceptionDate, warmupDays)
          const inceptionFmt = formatDateForMessage(inceptionDate)
          const minStartFmt = formatDateForMessage(minStart)
          const reason = warmupDays > 0
            ? `${symbol} (${role}) started trading on ${inceptionFmt}. This strategy needs ~${warmupDays} calendar days of history before the start date. Please choose a start date of ${minStartFmt} or later.`
            : `${symbol} (${role}) started trading on ${inceptionFmt}. Please choose a start date of ${minStartFmt} or later.`
          return {
            status: "USER_ACTION_REQUIRED" as PreflightStatus,
            reasons: [reason],
            allHealthy: false,
            unhealthy: [],
            all: [],
            requiredStart,
            requiredEnd,
          }
        }
      }
    }
  }

  const benchmarkThreshold = BENCHMARK_COVERAGE_THRESHOLD
  const universeThreshold = getUniverseThreshold(strategyId)

  const admin = createAdminClient()

  // ONE batch RPC call instead of N parallel COUNT queries.
  // get_benchmark_coverage_agg (migration 20260311_ticker_stats.sql) does a
  // single DB-side GROUP BY using idx_prices_ticker_date — vastly faster than
  // N individual COUNT(*) queries under load.
  type AggRow = { ticker: string; actual_days: string | number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcData, error: rpcError } = await (admin as any).rpc(
    "get_benchmark_coverage_agg",
    { p_tickers: allSymbols, p_start: requiredStart, p_end: requiredEnd }
  ) as { data: AggRow[] | null; error: { message: string } | null }

  if (rpcError) {
    // Log for debugging but don't throw — fall through with empty map so every
    // symbol gets status="not_ingested" (conservative: run waits for data).
    console.error("[coverage-check] get_benchmark_coverage_agg error:", rpcError.message)
  }

  const actualDaysMap = new Map<string, number>()
  for (const row of rpcData ?? []) {
    actualDaysMap.set(row.ticker, Number(row.actual_days))
  }

  const coverages: SymbolCoverage[] = allSymbols.map((symbol): SymbolCoverage => {
    const isBenchmark = symbol === benchmark
    const threshold = isBenchmark ? benchmarkThreshold : universeThreshold
    const actualDays = actualDaysMap.get(symbol) ?? 0
    const coverageRatio = actualDays / expectedDays

    let status: SymbolCoverageStatus
    if (actualDays === 0) {
      status = "not_ingested"
    } else if (coverageRatio < threshold) {
      status = "partial"
    } else {
      status = "healthy"
    }

    return { symbol, isBenchmark, actualDays, expectedDays, coverageRatio, status, threshold }
  })

  const unhealthy = coverages.filter((c) => c.status !== "healthy")
  const { status, reasons } = classifyUnhealthySymbols(
    unhealthy,
    requiredStart,
    requiredEnd,
    expectedDays,
    warmupDays
  )
  return {
    status,
    reasons,
    allHealthy: status === "READY",
    unhealthy,
    all: coverages,
    requiredStart,
    requiredEnd,
  }
}

// ---------------------------------------------------------------------------
// Deduplication helper
// ---------------------------------------------------------------------------

/**
 * Returns the set of tickers that already have an active (queued or running)
 * data_ingest_job, so we can skip creating duplicate ingestion storms.
 * Queries the dedicated data_ingest_jobs table (explicit symbol column).
 */
export async function getActiveIngestTickers(): Promise<Set<string>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data } = await admin
      .from("data_ingest_jobs")
      .select("symbol, status, next_retry_at")
      .in("status", ["queued", "running", "retrying", "failed"])

    return new Set(
      (data ?? [])
        .filter((j: { status?: string | null; next_retry_at?: string | null }) =>
          isActiveDataIngestStatus(j.status, j.next_retry_at)
        )
        .map((j: { symbol?: string }) => j.symbol?.toUpperCase())
        .filter((t: string | undefined): t is string => Boolean(t))
    )
  } catch {
    return new Set()
  }
}

// ---------------------------------------------------------------------------
// Preflight diagnostic formatter
// ---------------------------------------------------------------------------

/**
 * Build a human-readable summary of why a run is waiting for data.
 * Used in the UI and in failure error messages.
 */
export function formatPreflightDiagnostic(unhealthy: SymbolCoverage[]): string {
  const lines = unhealthy.map((c) => {
    const pct = (c.coverageRatio * 100).toFixed(1)
    const thr = (c.threshold * 100).toFixed(0)
    const role = c.isBenchmark ? "benchmark" : "universe"
    if (c.status === "not_ingested") {
      return `${c.symbol} (${role}): not ingested`
    }
    return `${c.symbol} (${role}): ${pct}% < ${thr}% required (${c.actualDays}/${c.expectedDays} days)`
  })
  return lines.join("; ")
}
