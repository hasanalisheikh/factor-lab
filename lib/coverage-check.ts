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

  // Warmup-adjusted required window
  const warmupDays = STRATEGY_WARMUP_CALENDAR_DAYS[strategyId] ?? 0
  const requiredStart = subtractCalendarDays(startDate, warmupDays)
  const requiredEnd = endDate

  const expectedDays = countBusinessDays(requiredStart, requiredEnd)
  if (expectedDays === 0) {
    return { allHealthy: true, unhealthy: [], all: [], requiredStart, requiredEnd }
  }

  // Unique symbols (benchmark may also be in universe)
  const allSymbols = [...new Set([...universeSymbols, benchmark])]

  const benchmarkThreshold = BENCHMARK_COVERAGE_THRESHOLD
  const universeThreshold = getUniverseThreshold(strategyId)

  const admin = createAdminClient()

  // Query actual day counts in parallel — one count query per symbol.
  // This is typically 9–21 symbols (small enough for parallel execution).
  const coverages: SymbolCoverage[] = await Promise.all(
    allSymbols.map(async (symbol): Promise<SymbolCoverage> => {
      const isBenchmark = symbol === benchmark
      const threshold = isBenchmark ? benchmarkThreshold : universeThreshold

      try {
        const { count } = await admin
          .from("prices")
          .select("*", { count: "exact", head: true })
          .eq("ticker", symbol)
          .gte("date", requiredStart)
          .lte("date", requiredEnd)

        const actualDays = count ?? 0
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
      } catch {
        // Treat query failures as not_ingested (conservative)
        return {
          symbol,
          isBenchmark,
          actualDays: 0,
          expectedDays,
          coverageRatio: 0,
          status: "not_ingested",
          threshold,
        }
      }
    })
  )

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
