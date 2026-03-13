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

export type CoverageHealthStatus = "good" | "warning" | "blocked"

export type RunPreflightStatus = "ok" | "warn" | "block"

export type PreflightSuggestedFix = {
  kind: "clamp_start_date" | "clamp_end_date" | "queue_data_repairs" | "reduce_top_n" | "set_top_n" | "retry_repairs"
  value?: string | number | string[]
}

export type RunPreflightIssueAction =
  | { kind: "clamp_start_date"; value: string; label: string }
  | { kind: "clamp_end_date"; value: string; label: string }
  | { kind: "set_top_n"; value: number; label: string }
  | { kind: "retry_repairs"; value: string[]; label: string }

export type RunPreflightIssue = {
  severity: Exclude<RunPreflightStatus, "ok">
  code: string
  reason: string
  fix: string
  action: RunPreflightIssueAction | null
}

export type RunPreflightConstraints = {
  dataCutoffDate: string
  universeEarliestStart: string | null
  universeValidFrom: string | null
  minStartDate: string | null
  maxEndDate: string
  missingTickers: string[]
}

export type MissingnessCoverageRow = {
  symbol: string
  isBenchmark: boolean
  firstDate: string | null
  lastDate: string | null
  expectedDays: number
  actualDays: number
  trueMissingDays: number
  trueMissingRate: number
}

export type RunPreflightCoverageSummary = {
  benchmark: {
    status: CoverageHealthStatus
    reason: string | null
    trueMissingRate: number
    symbol: string
  }
  universe: {
    status: CoverageHealthStatus
    reason: string | null
    over2Percent: string[]
    over10Percent: string[]
    affectedShare: number
  }
  symbols: MissingnessCoverageRow[]
}

export type RunPreflightResult = {
  status: RunPreflightStatus
  issues: RunPreflightIssue[]
  reasons: string[]
  suggested_fixes: PreflightSuggestedFix[]
  constraints: RunPreflightConstraints
  coverage: RunPreflightCoverageSummary
  requiredStart: string
  requiredEnd: string
}

export type RunPreflightSnapshot = {
  constraints: RunPreflightConstraints
  coverage: RunPreflightCoverageSummary
  requiredStart: string
  requiredEnd: string
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

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function issueToSuggestedFix(issue: RunPreflightIssue): PreflightSuggestedFix | null {
  if (!issue.action) return null
  switch (issue.action.kind) {
    case "clamp_start_date":
      return { kind: "clamp_start_date", value: issue.action.value }
    case "clamp_end_date":
      return { kind: "clamp_end_date", value: issue.action.value }
    case "set_top_n":
      return { kind: "set_top_n", value: issue.action.value }
    case "retry_repairs":
      return { kind: "retry_repairs", value: issue.action.value }
  }
}

function uniqueFixes(fixes: PreflightSuggestedFix[]): PreflightSuggestedFix[] {
  const seen = new Set<string>()
  return fixes.filter((fix) => {
    const key = JSON.stringify(fix)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function buildUniverseCoverageStatus(params: {
  strategyId: StrategyId
  universeRows: MissingnessCoverageRow[]
}): RunPreflightCoverageSummary["universe"] {
  const { strategyId, universeRows } = params
  const over2Percent = universeRows
    .filter((row) => row.expectedDays > 0 && row.trueMissingRate > 0.02)
    .map((row) => row.symbol)
  const over10Percent = universeRows
    .filter((row) => row.expectedDays > 0 && row.trueMissingRate > 0.10)
    .map((row) => row.symbol)
  const affectedShare =
    universeRows.length > 0 ? over2Percent.length / universeRows.length : 0

  if (over10Percent.length > 0) {
    return {
      status: "blocked",
      reason: `Too much true missingness in ${over10Percent.join(", ")} (${formatPercent(0.10)} max allowed per ticker).`,
      over2Percent,
      over10Percent,
      affectedShare,
    }
  }

  if (affectedShare > 0.05) {
    if (HIGH_SENSITIVITY_STRATEGIES.has(strategyId)) {
      return {
        status: "blocked",
        reason: `More than 5% of the universe exceeds ${formatPercent(0.02)} true missingness, which is too risky for this ranking-sensitive strategy.`,
        over2Percent,
        over10Percent,
        affectedShare,
      }
    }
    return {
      status: "warning",
      reason: `More than 5% of the universe exceeds ${formatPercent(0.02)} true missingness: ${over2Percent.join(", ")}.`,
      over2Percent,
      over10Percent,
      affectedShare,
    }
  }

  return {
    status: "good",
    reason: null,
    over2Percent,
    over10Percent,
    affectedShare,
  }
}

export function buildBenchmarkCoverageStatus(
  benchmark: string,
  row: MissingnessCoverageRow | undefined
): RunPreflightCoverageSummary["benchmark"] {
  if (!row || !row.firstDate) {
    return {
      status: "blocked",
      reason: `${benchmark} is not ingested yet.`,
      trueMissingRate: 1,
      symbol: benchmark,
    }
  }

  if (row.expectedDays > 0 && row.trueMissingRate > 0.02) {
    return {
      status: "blocked",
      reason: `${benchmark} true missingness is ${formatPercent(row.trueMissingRate)} (must be ${formatPercent(0.02)} or lower).`,
      trueMissingRate: row.trueMissingRate,
      symbol: benchmark,
    }
  }

  if (row.expectedDays > 0 && row.trueMissingRate > 0) {
    return {
      status: "warning",
      reason: `${benchmark} true missingness is ${formatPercent(row.trueMissingRate)} but remains within the allowed threshold.`,
      trueMissingRate: row.trueMissingRate,
      symbol: benchmark,
    }
  }

  return {
    status: "good",
    reason: null,
    trueMissingRate: row?.trueMissingRate ?? 0,
    symbol: benchmark,
  }
}

export function finalizeRunPreflightResult(params: {
  constraints: RunPreflightConstraints
  coverage: RunPreflightCoverageSummary
  requiredStart: string
  requiredEnd: string
  issues: RunPreflightIssue[]
}): RunPreflightResult {
  const { constraints, coverage, requiredStart, requiredEnd, issues } = params
  const blockIssues = issues.filter((issue) => issue.severity === "block")
  const warnIssues = issues.filter((issue) => issue.severity === "warn")
  const status: RunPreflightStatus = blockIssues.length > 0
    ? "block"
    : warnIssues.length > 0
      ? "warn"
      : "ok"

  const visibleIssues = status === "warn" ? warnIssues : blockIssues
  return {
    status,
    issues: visibleIssues,
    reasons: visibleIssues.map((issue) => issue.reason),
    suggested_fixes: uniqueFixes(
      visibleIssues
        .map(issueToSuggestedFix)
        .filter((fix): fix is PreflightSuggestedFix => Boolean(fix))
    ),
    constraints,
    coverage,
    requiredStart,
    requiredEnd,
  }
}

export function buildRunPreflightResult(params: {
  strategyId: StrategyId
  startDate: string
  endDate: string
  benchmark: string
  constraints: RunPreflightConstraints
  symbolRows: MissingnessCoverageRow[]
}): RunPreflightResult {
  const { strategyId, startDate, endDate, benchmark, constraints, symbolRows } = params
  const issues: RunPreflightIssue[] = []

  if (constraints.minStartDate && startDate < constraints.minStartDate) {
    issues.push({
      severity: "block",
      code: "start_before_universe_min",
      reason: `Start date ${startDate} is earlier than the earliest valid start for this universe (${constraints.minStartDate}).`,
      fix: `Choose ${constraints.minStartDate} or a later start date.`,
      action: {
        kind: "clamp_start_date",
        value: constraints.minStartDate,
        label: "Use earliest start",
      },
    })
  }

  if (endDate > constraints.maxEndDate) {
    issues.push({
      severity: "block",
      code: "end_after_cutoff",
      reason: `End date ${endDate} is after the current data cutoff (${constraints.maxEndDate}).`,
      fix: `Choose ${constraints.maxEndDate} or an earlier end date.`,
      action: {
        kind: "clamp_end_date",
        value: constraints.maxEndDate,
        label: "Use cutoff end date",
      },
    })
  }

  const benchmarkRow = symbolRows.find((row) => row.symbol === benchmark)
  const universeRows = symbolRows.filter((row) => !row.isBenchmark)
  const benchmarkCoverage = buildBenchmarkCoverageStatus(benchmark, benchmarkRow)
  const universeCoverage = buildUniverseCoverageStatus({ strategyId, universeRows })

  if (benchmarkCoverage.status === "blocked" && benchmarkCoverage.reason) {
    issues.push({
      severity: "block",
      code: "benchmark_missingness_blocked",
      reason: benchmarkCoverage.reason,
      fix: `Choose another benchmark or an earlier date range for ${benchmark}.`,
      action: null,
    })
  }

  if (universeCoverage.status === "blocked" && universeCoverage.reason) {
    issues.push({
      severity: "block",
      code: universeCoverage.over10Percent.length > 0
        ? "universe_missingness_per_ticker_blocked"
        : "universe_missingness_share_blocked",
      reason: universeCoverage.reason,
      fix: "Choose a later start date, an earlier end date, or a different universe.",
      action: null,
    })
  }

  if (benchmarkCoverage.status === "warning" && benchmarkCoverage.reason) {
    issues.push({
      severity: "warn",
      code: "benchmark_missingness_warning",
      reason: benchmarkCoverage.reason,
      fix: `You can continue, but results versus ${benchmark} may be less reliable.`,
      action: null,
    })
  }
  if (universeCoverage.status === "warning" && universeCoverage.reason) {
    issues.push({
      severity: "warn",
      code: "universe_missingness_warning",
      reason: universeCoverage.reason,
      fix: "You can continue, but this data quality may affect the rankings.",
      action: null,
    })
  }

  return finalizeRunPreflightResult({
    constraints,
    coverage: {
      benchmark: benchmarkCoverage,
      universe: universeCoverage,
      symbols: symbolRows,
    },
    requiredStart: symbolRows.length > 0
      ? subtractCalendarDays(startDate, STRATEGY_WARMUP_CALENDAR_DAYS[strategyId] ?? 0)
      : startDate,
    requiredEnd: endDate > constraints.maxEndDate ? constraints.maxEndDate : endDate,
    issues,
  })
}

export function buildRunPreflightSnapshot(params: {
  strategyId: StrategyId
  startDate: string
  endDate: string
  benchmark: string
  constraints: RunPreflightConstraints
  symbolRows: MissingnessCoverageRow[]
}): RunPreflightSnapshot {
  const { strategyId, startDate, endDate, benchmark, constraints, symbolRows } = params
  const benchmarkRow = symbolRows.find((row) => row.symbol === benchmark)
  const universeRows = symbolRows.filter((row) => !row.isBenchmark)
  return {
    constraints,
    coverage: {
      benchmark: buildBenchmarkCoverageStatus(benchmark, benchmarkRow),
      universe: buildUniverseCoverageStatus({ strategyId, universeRows }),
      symbols: symbolRows,
    },
    requiredStart: symbolRows.length > 0
      ? subtractCalendarDays(startDate, STRATEGY_WARMUP_CALENDAR_DAYS[strategyId] ?? 0)
      : startDate,
    requiredEnd: endDate > constraints.maxEndDate ? constraints.maxEndDate : endDate,
  }
}

export async function evaluateRunPreflightSnapshot(params: {
  strategyId: StrategyId
  startDate: string
  endDate: string
  universeSymbols: string[]
  benchmark: string
  dataCutoffDate: string
  universeEarliestStart: string | null
  universeValidFrom: string | null
  missingTickers: string[]
}): Promise<RunPreflightSnapshot> {
  const {
    strategyId,
    startDate,
    endDate,
    universeSymbols,
    benchmark,
    dataCutoffDate,
    universeEarliestStart,
    universeValidFrom,
    missingTickers,
  } = params

  const minStartDate =
    universeEarliestStart && universeValidFrom
      ? (universeEarliestStart > universeValidFrom ? universeEarliestStart : universeValidFrom)
      : (universeEarliestStart ?? universeValidFrom ?? null)

  const constraints: RunPreflightConstraints = {
    dataCutoffDate,
    universeEarliestStart,
    universeValidFrom,
    minStartDate,
    maxEndDate: dataCutoffDate,
    missingTickers,
  }

  const warmupDays = STRATEGY_WARMUP_CALENDAR_DAYS[strategyId] ?? 0
  const requiredStart = subtractCalendarDays(startDate, warmupDays)
  const requiredEnd = endDate > dataCutoffDate ? dataCutoffDate : endDate
  const allSymbols = [...new Set([...universeSymbols, benchmark])]

  const admin = createAdminClient()

  type StatsRow = { symbol: string; first_date: string | null; last_date: string | null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: statsRows, error: statsError } = await (admin as any)
    .from("ticker_stats")
    .select("symbol, first_date, last_date")
    .in("symbol", allSymbols) as { data: StatsRow[] | null; error: { message: string } | null }

  if (statsError) {
    console.error("[coverage-check] ticker_stats error:", statsError.message)
  }

  const firstDateMap = new Map<string, string>()
  const lastDateMap = new Map<string, string>()
  for (const row of statsRows ?? []) {
    if (row.first_date) firstDateMap.set(row.symbol, row.first_date)
    if (row.last_date) lastDateMap.set(row.symbol, row.last_date)
  }

  type AggRow = { ticker: string; actual_days: string | number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcData, error: rpcError } = await (admin as any).rpc(
    "get_benchmark_coverage_agg",
    { p_tickers: allSymbols, p_start: requiredStart, p_end: requiredEnd }
  ) as { data: AggRow[] | null; error: { message: string } | null }

  if (rpcError) {
    console.error("[coverage-check] get_benchmark_coverage_agg error:", rpcError.message)
  }

  const actualDaysMap = new Map<string, number>()
  for (const row of rpcData ?? []) {
    actualDaysMap.set(row.ticker, Number(row.actual_days))
  }

  const symbolRows: MissingnessCoverageRow[] = allSymbols.map((symbol) => {
    const firstDate = firstDateMap.get(symbol) ?? null
    const actualStart =
      firstDate && firstDate > requiredStart
        ? firstDate
        : requiredStart
    const expectedDays =
      firstDate === null || actualStart > requiredEnd
        ? 0
        : countBusinessDays(actualStart, requiredEnd)
    const actualDays = actualDaysMap.get(symbol) ?? 0
    const trueMissingDays = expectedDays > 0 ? Math.max(expectedDays - actualDays, 0) : 0
    const trueMissingRate = expectedDays > 0 ? trueMissingDays / expectedDays : 0
    return {
      symbol,
      isBenchmark: symbol === benchmark,
      firstDate,
      lastDate: lastDateMap.get(symbol) ?? null,
      expectedDays,
      actualDays,
      trueMissingDays,
      trueMissingRate,
    }
  })

  return buildRunPreflightSnapshot({
    strategyId,
    startDate,
    endDate,
    benchmark,
    constraints,
    symbolRows,
  })
}

export async function evaluateRunPreflight(params: {
  strategyId: StrategyId
  startDate: string
  endDate: string
  universeSymbols: string[]
  benchmark: string
  dataCutoffDate: string
  universeEarliestStart: string | null
  universeValidFrom: string | null
  missingTickers: string[]
}): Promise<RunPreflightResult> {
  const snapshot = await evaluateRunPreflightSnapshot(params)
  return buildRunPreflightResult({
    strategyId: params.strategyId,
    startDate: params.startDate,
    endDate: params.endDate,
    benchmark: params.benchmark,
    constraints: snapshot.constraints,
    symbolRows: snapshot.coverage.symbols,
  })
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
