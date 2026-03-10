import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { STRATEGY_WARMUP_CALENDAR_DAYS } from "@/lib/strategy-warmup"
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
}): Promise<PreflightResult> {
  const { strategyId, startDate, endDate, universeSymbols, benchmark } = params

  // Warmup-adjusted required window.
  // Cap requiredEnd at getSafeLastDate() so we never measure coverage against
  // today's partially-ingested data (which would cause false coverage failures).
  const warmupDays = STRATEGY_WARMUP_CALENDAR_DAYS[strategyId] ?? 0
  const requiredStart = subtractCalendarDays(startDate, warmupDays)
  const safeEnd = getSafeLastDate()
  const requiredEnd = endDate < safeEnd ? endDate : safeEnd

  const expectedDays = countBusinessDays(requiredStart, requiredEnd)
  if (expectedDays === 0) {
    return { allHealthy: true, unhealthy: [], all: [], requiredStart, requiredEnd }
  }

  // Unique symbols (benchmark may also be in universe)
  const allSymbols = [...new Set([...universeSymbols, benchmark])]

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
  return {
    allHealthy: unhealthy.length === 0,
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
      .select("symbol")
      .in("status", ["queued", "running"])

    return new Set(
      (data ?? [])
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
