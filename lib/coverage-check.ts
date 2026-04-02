import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { BENCHMARK_OPTIONS } from "@/lib/benchmark";
import { getLastCompleteTradingDayUtc, subtractTradingDays } from "@/lib/data-cutoff";
import { isActiveDataIngestStatus } from "@/lib/data-ingest-jobs";
import { STRATEGY_WARMUP_CALENDAR_DAYS } from "@/lib/strategy-warmup";
import { COVERAGE_WINDOW_START, TICKER_INCEPTION_DATES } from "@/lib/supabase/types";
import type { StrategyId } from "@/lib/types";

// ---------------------------------------------------------------------------
// Coverage thresholds
// ---------------------------------------------------------------------------

/**
 * Benchmark must be ≥ 99% covered in the required window.
 * Gaps directly affect "vs {benchmark}" comparisons and equity alignment.
 */
export const BENCHMARK_COVERAGE_THRESHOLD = 0.99;

/**
 * Universe symbols must be ≥ 98% covered (standard strategies).
 * Small gaps are tolerated if handled, but major gaps bias selection/ranking.
 */
export const UNIVERSE_COVERAGE_THRESHOLD = 0.98;

/**
 * Momentum and ML strategies require tighter universe coverage (≥ 99%)
 * because ranking depends on stable price history across all assets.
 */
export const HIGH_SENSITIVITY_UNIVERSE_THRESHOLD = 0.99;

/** Strategies that require HIGH_SENSITIVITY_UNIVERSE_THRESHOLD */
const HIGH_SENSITIVITY_STRATEGIES = new Set<StrategyId>([
  "momentum_12_1",
  "trend_filter",
  "ml_ridge",
  "ml_lightgbm",
]);

export function getUniverseThreshold(strategyId: StrategyId): number {
  return HIGH_SENSITIVITY_STRATEGIES.has(strategyId)
    ? HIGH_SENSITIVITY_UNIVERSE_THRESHOLD
    : UNIVERSE_COVERAGE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

/**
 * Count Mon–Fri business days in [startDate, endDate] inclusive.
 * Labeled as "approximation" — does not account for market holidays.
 */
export function countBusinessDays(startDate: string, endDate: string): number {
  const s = new Date(startDate + "T00:00:00Z");
  const e = new Date(endDate + "T00:00:00Z");
  if (e < s) return 0;
  let count = 0;
  const d = new Date(s);
  while (d <= e) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++; // 0=Sun, 6=Sat
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
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
  const now = new Date();
  // Work in UTC to avoid local-timezone drift
  const dow = now.getUTCDay(); // 0=Sun, 6=Sat
  let daysBack = 1; // default: yesterday
  if (dow === 0) daysBack = 2; // Sunday → Friday
  if (dow === 6) daysBack = 1; // Saturday → Friday
  const safe = new Date(now);
  safe.setUTCDate(safe.getUTCDate() - daysBack);
  return safe.toISOString().slice(0, 10);
}

/**
 * Subtract calendar days from a YYYY-MM-DD string.
 * Returns the new date as YYYY-MM-DD.
 */
export function subtractCalendarDays(dateStr: string, days: number): string {
  if (days <= 0) return dateStr;
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function getMinTrainDays(): number {
  return Number(process.env.ML_MIN_TRAIN_DAYS ?? "252");
}

export function getStrategyWarmupTradingDays(strategyId: StrategyId): number {
  if (strategyId === "momentum_12_1") return 252;
  if (strategyId === "low_vol") return 60;
  if (strategyId === "trend_filter") return 200;
  if (strategyId === "ml_ridge" || strategyId === "ml_lightgbm") {
    return 252 + getMinTrainDays();
  }
  return 0;
}

export function resolveRunPreflightWindow(params: {
  strategyId: StrategyId;
  startDate: string;
  endDate: string;
  minStartDate: string | null;
}): {
  warmupStart: string;
  requiredStart: string;
  requiredEnd: string;
} {
  const requiredStart =
    params.minStartDate && params.minStartDate > params.startDate
      ? params.minStartDate
      : params.startDate;
  const requiredEnd = params.endDate;
  const warmupStart = subtractTradingDays(
    requiredStart,
    getStrategyWarmupTradingDays(params.strategyId)
  );
  return {
    warmupStart,
    requiredStart,
    requiredEnd,
  };
}

function countDatesInRange(dates: readonly string[], startDate: string, endDate: string): number {
  if (!startDate || !endDate || endDate < startDate) return 0;
  let count = 0;
  for (const date of dates) {
    if (date < startDate) continue;
    if (date > endDate) break;
    count += 1;
  }
  return count;
}

export type CoverageStatsSnapshot = {
  firstDate: string | null;
  lastDate: string | null;
};

export type BenchmarkCoverageStatus = "good" | "warning" | "blocked";
export type BenchmarkMetricSource = "research_window" | "run_window" | "db_wide";

export type BenchmarkCoverageComputation = {
  benchmarkTicker: string;
  firstDate: string | null;
  lastDate: string | null;
  metricSourceUsed: BenchmarkMetricSource;
  windowStartUsed: string;
  windowEndUsed: string;
  expectedDays: number;
  actualDays: number;
  missingDays: number;
  trueMissingRate: number;
  status: BenchmarkCoverageStatus;
};

async function fetchTickerStats(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  symbols: string[]
): Promise<Map<string, CoverageStatsSnapshot>> {
  const stats = new Map<string, CoverageStatsSnapshot>();
  if (symbols.length === 0) return stats;

  type StatsRow = { symbol: string; first_date: string | null; last_date: string | null };
  const { data, error } = (await admin
    .from("ticker_stats")
    .select("symbol, first_date, last_date")
    .in("symbol", symbols)) as { data: StatsRow[] | null; error: { message: string } | null };

  if (error) {
    console.error("[coverage-check] ticker_stats error:", error.message);
    return stats;
  }

  for (const row of data ?? []) {
    stats.set(row.symbol.toUpperCase(), {
      firstDate: row.first_date,
      lastDate: row.last_date,
    });
  }

  return stats;
}

async function fetchObservedDatesByTicker(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  symbols: string[];
  startDate: string;
  endDate: string;
}): Promise<Map<string, string[]>> {
  const { admin, symbols, startDate, endDate } = params;
  const observedByTicker = new Map<string, string[]>();
  for (const symbol of symbols) {
    observedByTicker.set(symbol, []);
  }
  if (symbols.length === 0 || endDate < startDate) return observedByTicker;

  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = (await admin
      .from("prices")
      .select("ticker, date")
      .in("ticker", symbols)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true })
      .range(offset, offset + pageSize - 1)) as {
      data: Array<{ ticker: string; date: string }> | null;
      error: { message: string } | null;
    };

    if (error) {
      console.error("[coverage-check] prices date fetch error:", error.message);
      break;
    }

    const rows = data ?? [];
    for (const row of rows) {
      const symbol = String(row.ticker ?? "").toUpperCase();
      const date = String(row.date ?? "");
      const bucket = observedByTicker.get(symbol);
      if (!bucket || !date) continue;
      if (bucket.at(-1) !== date) {
        bucket.push(date);
      }
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return observedByTicker;
}

function resolveCoverageWindowStart(params: {
  windowFloor: string;
  windowEnd: string;
  firstDate: string | null;
}): string | null {
  const { windowFloor, windowEnd, firstDate } = params;
  if (!firstDate) return null;
  const windowStart = firstDate > windowFloor ? firstDate : windowFloor;
  return windowStart <= windowEnd ? windowStart : null;
}

function getBenchmarkCoverageStatus(params: {
  actualDays: number;
  trueMissingRate: number;
}): BenchmarkCoverageStatus {
  if (params.actualDays === 0) return "blocked";
  if (params.trueMissingRate > 0.1) return "blocked";
  if (params.trueMissingRate > 0.02) return "warning";
  return "good";
}

export function computeBenchmarkCoverage(params: {
  benchmarkTicker: string;
  windowStart: string;
  windowEnd: string;
  cutoffDate: string;
  metricSourceUsed?: BenchmarkMetricSource;
  stats: CoverageStatsSnapshot | undefined;
  benchmarkDates: readonly string[];
}): BenchmarkCoverageComputation {
  const {
    benchmarkTicker,
    windowStart,
    windowEnd,
    cutoffDate,
    metricSourceUsed = "run_window",
    stats,
    benchmarkDates,
  } = params;
  const firstDate = stats?.firstDate ?? null;
  const lastDate = stats?.lastDate ?? null;
  const windowEndUsed = windowEnd > cutoffDate ? cutoffDate : windowEnd;
  const windowStartUsed =
    resolveCoverageWindowStart({
      windowFloor: windowStart,
      windowEnd: windowEndUsed,
      firstDate,
    }) ?? windowStart;
  const expectedDays =
    windowStartUsed > windowEndUsed
      ? 0
      : countDatesInRange(benchmarkDates, windowStartUsed, windowEndUsed);
  const actualDays =
    windowStartUsed > windowEndUsed
      ? 0
      : countDatesInRange(benchmarkDates, windowStartUsed, windowEndUsed);
  const missingDays = expectedDays > 0 ? Math.max(expectedDays - actualDays, 0) : 0;
  const trueMissingRate = expectedDays > 0 ? missingDays / expectedDays : 0;
  const status = getBenchmarkCoverageStatus({
    actualDays,
    trueMissingRate,
  });

  return {
    benchmarkTicker,
    firstDate,
    lastDate,
    metricSourceUsed,
    windowStartUsed,
    windowEndUsed,
    expectedDays,
    actualDays,
    missingDays,
    trueMissingRate,
    status,
  };
}

function buildBenchmarkMissingnessRow(
  coverage: BenchmarkCoverageComputation
): MissingnessCoverageRow {
  return {
    symbol: coverage.benchmarkTicker,
    isBenchmark: true,
    firstDate: coverage.firstDate,
    lastDate: coverage.lastDate,
    windowStart: coverage.windowStartUsed,
    expectedDays: coverage.expectedDays,
    actualDays: coverage.actualDays,
    trueMissingDays: coverage.missingDays,
    trueMissingRate: coverage.trueMissingRate,
  };
}

function buildUniverseMissingnessRow(params: {
  symbol: string;
  benchmarkDates: readonly string[];
  warmupStart: string;
  requiredEnd: string;
  stats: CoverageStatsSnapshot | undefined;
  observedDates: readonly string[];
}): MissingnessCoverageRow {
  const { symbol, benchmarkDates, warmupStart, requiredEnd, stats, observedDates } = params;
  const firstDate = stats?.firstDate ?? null;
  const lastDate = stats?.lastDate ?? null;
  const windowStart = resolveCoverageWindowStart({
    windowFloor: warmupStart,
    windowEnd: requiredEnd,
    firstDate,
  });
  const expectedDays = !windowStart
    ? 0
    : countDatesInRange(benchmarkDates, windowStart, requiredEnd);
  const actualDays = !windowStart ? 0 : countDatesInRange(observedDates, windowStart, requiredEnd);
  const trueMissingDays = expectedDays > 0 ? Math.max(expectedDays - actualDays, 0) : 0;
  const trueMissingRate = expectedDays > 0 ? trueMissingDays / expectedDays : 0;

  return {
    symbol,
    isBenchmark: false,
    firstDate,
    lastDate,
    windowStart,
    expectedDays,
    actualDays,
    trueMissingDays,
    trueMissingRate,
  };
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
export type PreflightStatus = "READY" | "WAITING_FOR_DATA" | "USER_ACTION_REQUIRED";

export type SymbolCoverageStatus = "healthy" | "partial" | "not_ingested";

export type SymbolCoverage = {
  symbol: string;
  /** True when this symbol is the run benchmark */
  isBenchmark: boolean;
  /** Rows found in [requiredStart, requiredEnd] */
  actualDays: number;
  /** Business-day count in [requiredStart, requiredEnd] (Mon–Fri approximation) */
  expectedDays: number;
  /** actualDays / expectedDays (0–1) */
  coverageRatio: number;
  /** Applied threshold (0–1) */
  threshold: number;
  status: SymbolCoverageStatus;
};

export type CoverageHealthStatus = "good" | "warning" | "blocked";

export type RunPreflightStatus = "ok" | "warn" | "block";
export type RunPreflightIssueSeverity = "good" | "warning" | "blocked";

export type PreflightSuggestedFix = {
  kind:
    | "clamp_start_date"
    | "clamp_end_date"
    | "queue_data_repairs"
    | "reduce_top_n"
    | "set_top_n"
    | "retry_repairs"
    | "change_benchmark";
  value?: string | number | string[];
};

export type RunPreflightIssueAction =
  | { kind: "clamp_start_date"; value: string; label: string }
  | { kind: "clamp_end_date"; value: string; label: string }
  | { kind: "reduce_top_n"; value: number; label: string }
  | { kind: "set_top_n"; value: number; label: string }
  | { kind: "retry_repairs"; value: string[]; label: string }
  | { kind: "change_benchmark"; value: string; label: string };

export type RunPreflightIssue = {
  severity: RunPreflightIssueSeverity;
  code: string;
  reason: string;
  fix: string;
  action: RunPreflightIssueAction | null;
};

export type RunPreflightConstraints = {
  dataCutoffDate: string;
  universeEarliestStart: string | null;
  universeValidFrom: string | null;
  minStartDate: string | null;
  maxEndDate: string;
  missingTickers: string[];
  warmupStart: string;
  requiredStart: string;
  requiredEnd: string;
};

export type MissingnessCoverageRow = {
  symbol: string;
  isBenchmark: boolean;
  firstDate: string | null;
  lastDate: string | null;
  windowStart: string | null;
  expectedDays: number;
  actualDays: number;
  trueMissingDays: number;
  trueMissingRate: number;
};

export type BenchmarkSuggestionCandidate = {
  symbol: string;
  status: RunPreflightStatus;
  benchmarkTrueMissingRate: number;
  affectedShare: number;
};

export type RunPreflightCoverageSummary = {
  benchmark: {
    status: CoverageHealthStatus;
    reason: string | null;
    metricSourceUsed: BenchmarkMetricSource;
    trueMissingRate: number;
    symbol: string;
    windowStartUsed: string;
    windowEndUsed: string;
    expectedDays: number;
    actualDays: number;
    missingDays: number;
  };
  universe: {
    status: CoverageHealthStatus;
    reason: string | null;
    over2Percent: string[];
    over10Percent: string[];
    affectedShare: number;
  };
  symbols: MissingnessCoverageRow[];
  benchmarkCandidates: BenchmarkSuggestionCandidate[];
};

export type RunPreflightResult = {
  status: RunPreflightStatus;
  issues: RunPreflightIssue[];
  reasons: string[];
  suggested_fixes: PreflightSuggestedFix[];
  constraints: RunPreflightConstraints;
  coverage: RunPreflightCoverageSummary;
  warmupStart: string;
  requiredStart: string;
  requiredEnd: string;
};

export type RunPreflightSnapshot = {
  constraints: RunPreflightConstraints;
  coverage: RunPreflightCoverageSummary;
  warmupStart: string;
  requiredStart: string;
  requiredEnd: string;
};

export type PreflightResult = {
  /** Canonical classification — use this to decide what to do next. */
  status: PreflightStatus;
  /**
   * Plain-English reasons the run can't proceed as-is.
   * Non-empty only when status ≠ READY.
   * For USER_ACTION_REQUIRED these are the messages shown to the user.
   * For WAITING_FOR_DATA they describe what's being auto-fixed.
   */
  reasons: string[];
  /** @deprecated Use `status === "READY"` instead. Kept for backward compat. */
  allHealthy: boolean;
  /** Symbols below their coverage threshold */
  unhealthy: SymbolCoverage[];
  /** All symbols checked */
  all: SymbolCoverage[];
  /** Warmup-adjusted start date used for the coverage window */
  requiredStart: string;
  requiredEnd: string;
};

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
  });
}

/** Add calendar days to a YYYY-MM-DD string, returning a new YYYY-MM-DD. */
function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
  if (unhealthy.length === 0) return { status: "READY", reasons: [] };

  const reasons: string[] = [];
  let hasUserActionRequired = false;

  for (const cov of unhealthy) {
    const inceptionDate = TICKER_INCEPTION_DATES[cov.symbol];

    if (inceptionDate && inceptionDate > requiredStart) {
      // Ticker hasn't existed since requiredStart. Check if even full coverage
      // from inception day forward would satisfy the threshold.
      const maxPossibleDays = countBusinessDays(inceptionDate, requiredEnd);
      if (expectedDays > 0 && maxPossibleDays / expectedDays < cov.threshold) {
        // Permanently insufficient — user must adjust settings.
        hasUserActionRequired = true;
        const role = cov.isBenchmark ? "benchmark" : "universe asset";
        const minStart = addCalendarDays(inceptionDate, warmupDays);
        const inceptionFmt = formatDateForMessage(inceptionDate);
        const minStartFmt = formatDateForMessage(minStart);
        if (warmupDays > 0) {
          reasons.push(
            `${cov.symbol} (${role}) started trading on ${inceptionFmt}. ` +
              `This strategy needs ~${warmupDays} calendar days of history before the start date. ` +
              `Please choose a start date of ${minStartFmt} or later.`
          );
        } else {
          reasons.push(
            `${cov.symbol} (${role}) started trading on ${inceptionFmt}. ` +
              `Please choose a start date of ${minStartFmt} or later.`
          );
        }
        continue;
      }
    }

    // Fixable by ingestion.
    const role = cov.isBenchmark ? "benchmark" : "universe asset";
    if (cov.status === "not_ingested") {
      reasons.push(
        `We're missing price data for ${cov.symbol} (${role}). ` +
          `Downloading it now — your run will start automatically when ready.`
      );
    } else {
      const pct = (cov.coverageRatio * 100).toFixed(0);
      const thr = (cov.threshold * 100).toFixed(0);
      reasons.push(
        `${cov.symbol} (${role}) has ${pct}% of required price history ` +
          `(need ${thr}%). Downloading missing days now.`
      );
    }
  }

  if (hasUserActionRequired) {
    return { status: "USER_ACTION_REQUIRED", reasons };
  }
  return { status: "WAITING_FOR_DATA", reasons };
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
  strategyId: StrategyId;
  startDate: string;
  endDate: string;
  universeSymbols: string[];
  benchmark: string;
  dataCutoffDate?: string | null;
}): Promise<PreflightResult> {
  const { strategyId, startDate, endDate, universeSymbols, benchmark, dataCutoffDate } = params;

  // Warmup-adjusted required window.
  // Cap requiredEnd at the global data cutoff so the preflight never treats
  // dates beyond "Current through" as missing.
  const warmupDays = STRATEGY_WARMUP_CALENDAR_DAYS[strategyId] ?? 0;
  const requiredStart = subtractCalendarDays(startDate, warmupDays);
  const requiredEnd = dataCutoffDate && dataCutoffDate < endDate ? dataCutoffDate : endDate;

  const expectedDays = countBusinessDays(requiredStart, requiredEnd);
  if (expectedDays === 0) {
    return {
      status: "READY",
      reasons: [],
      allHealthy: true,
      unhealthy: [],
      all: [],
      requiredStart,
      requiredEnd,
    };
  }

  // Unique symbols (benchmark may also be in universe)
  const allSymbols = [...new Set([...universeSymbols, benchmark])];

  // ── universe_valid_from pre-check ─────────────────────────────────────────
  // For tickers with known inception dates, verify that even full coverage from
  // inception would meet the threshold for the requested window. Catching this
  // before the RPC avoids a DB round-trip and gives a cleaner single error.
  {
    const universeThresholdForCheck = getUniverseThreshold(strategyId);
    const expectedForCheck = expectedDays; // same as computed above

    for (const symbol of allSymbols) {
      const inceptionDate = TICKER_INCEPTION_DATES[symbol];
      if (inceptionDate && inceptionDate > requiredStart) {
        const maxPossibleDays = countBusinessDays(inceptionDate, requiredEnd);
        const threshold =
          symbol === benchmark ? BENCHMARK_COVERAGE_THRESHOLD : universeThresholdForCheck;
        if (expectedForCheck > 0 && maxPossibleDays / expectedForCheck < threshold) {
          const role = symbol === benchmark ? "benchmark" : "universe asset";
          const minStart = addCalendarDays(inceptionDate, warmupDays);
          const inceptionFmt = formatDateForMessage(inceptionDate);
          const minStartFmt = formatDateForMessage(minStart);
          const reason =
            warmupDays > 0
              ? `${symbol} (${role}) started trading on ${inceptionFmt}. This strategy needs ~${warmupDays} calendar days of history before the start date. Please choose a start date of ${minStartFmt} or later.`
              : `${symbol} (${role}) started trading on ${inceptionFmt}. Please choose a start date of ${minStartFmt} or later.`;
          return {
            status: "USER_ACTION_REQUIRED" as PreflightStatus,
            reasons: [reason],
            allHealthy: false,
            unhealthy: [],
            all: [],
            requiredStart,
            requiredEnd,
          };
        }
      }
    }
  }

  const benchmarkThreshold = BENCHMARK_COVERAGE_THRESHOLD;
  const universeThreshold = getUniverseThreshold(strategyId);

  const admin = createAdminClient();

  // ONE batch RPC call instead of N parallel COUNT queries.
  // get_benchmark_coverage_agg (migration 20260311_ticker_stats.sql) does a
  // single DB-side GROUP BY using idx_prices_ticker_date — vastly faster than
  // N individual COUNT(*) queries under load.
  type AggRow = { ticker: string; actual_days: string | number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcData, error: rpcError } = (await (admin as any).rpc(
    "get_benchmark_coverage_agg",
    { p_tickers: allSymbols, p_start: requiredStart, p_end: requiredEnd }
  )) as { data: AggRow[] | null; error: { message: string } | null };

  if (rpcError) {
    // Log for debugging but don't throw — fall through with empty map so every
    // symbol gets status="not_ingested" (conservative: run waits for data).
    console.error("[coverage-check] get_benchmark_coverage_agg error:", rpcError.message);
  }

  const actualDaysMap = new Map<string, number>();
  for (const row of rpcData ?? []) {
    actualDaysMap.set(row.ticker, Number(row.actual_days));
  }

  const coverages: SymbolCoverage[] = allSymbols.map((symbol): SymbolCoverage => {
    const isBenchmark = symbol === benchmark;
    const threshold = isBenchmark ? benchmarkThreshold : universeThreshold;
    const actualDays = actualDaysMap.get(symbol) ?? 0;
    const coverageRatio = actualDays / expectedDays;

    let status: SymbolCoverageStatus;
    if (actualDays === 0) {
      status = "not_ingested";
    } else if (coverageRatio < threshold) {
      status = "partial";
    } else {
      status = "healthy";
    }

    return { symbol, isBenchmark, actualDays, expectedDays, coverageRatio, status, threshold };
  });

  const unhealthy = coverages.filter((c) => c.status !== "healthy");
  const { status, reasons } = classifyUnhealthySymbols(
    unhealthy,
    requiredStart,
    requiredEnd,
    expectedDays,
    warmupDays
  );
  return {
    status,
    reasons,
    allHealthy: status === "READY",
    unhealthy,
    all: coverages,
    requiredStart,
    requiredEnd,
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function issueToSuggestedFix(issue: RunPreflightIssue): PreflightSuggestedFix | null {
  if (!issue.action) return null;
  switch (issue.action.kind) {
    case "clamp_start_date":
      return { kind: "clamp_start_date", value: issue.action.value };
    case "clamp_end_date":
      return { kind: "clamp_end_date", value: issue.action.value };
    case "reduce_top_n":
      return { kind: "reduce_top_n", value: issue.action.value };
    case "set_top_n":
      return { kind: "set_top_n", value: issue.action.value };
    case "retry_repairs":
      return { kind: "retry_repairs", value: issue.action.value };
    case "change_benchmark":
      return { kind: "change_benchmark", value: issue.action.value };
  }
}

function uniqueFixes(fixes: PreflightSuggestedFix[]): PreflightSuggestedFix[] {
  const seen = new Set<string>();
  return fixes.filter((fix) => {
    const key = JSON.stringify(fix);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildUniverseCoverageStatus(params: {
  strategyId: StrategyId;
  universeRows: MissingnessCoverageRow[];
}): RunPreflightCoverageSummary["universe"] {
  const { strategyId, universeRows } = params;
  const over2Percent = universeRows
    .filter((row) => row.expectedDays > 0 && row.trueMissingRate > 0.02)
    .map((row) => row.symbol);
  const over10Percent = universeRows
    .filter((row) => row.expectedDays > 0 && row.trueMissingRate > 0.1)
    .map((row) => row.symbol);
  const affectedShare = universeRows.length > 0 ? over2Percent.length / universeRows.length : 0;

  if (over10Percent.length > 0) {
    return {
      status: "blocked",
      reason: `Too much true missingness in ${over10Percent.join(", ")} (${formatPercent(0.1)} max allowed per ticker).`,
      over2Percent,
      over10Percent,
      affectedShare,
    };
  }

  if (affectedShare > 0.05) {
    if (HIGH_SENSITIVITY_STRATEGIES.has(strategyId)) {
      return {
        status: "blocked",
        reason: `More than 5% of the universe exceeds ${formatPercent(0.02)} true missingness, which is too risky for this ranking-sensitive strategy.`,
        over2Percent,
        over10Percent,
        affectedShare,
      };
    }
    return {
      status: "warning",
      reason: `More than 5% of the universe exceeds ${formatPercent(0.02)} true missingness: ${over2Percent.join(", ")}.`,
      over2Percent,
      over10Percent,
      affectedShare,
    };
  }

  return {
    status: "good",
    reason: null,
    over2Percent,
    over10Percent,
    affectedShare,
  };
}

function formatBenchmarkWindowLabel(windowStart: string, windowEnd: string): string {
  return ` over ${windowStart} -> ${windowEnd}`;
}

function buildBenchmarkCoverageSummary(
  coverage: BenchmarkCoverageComputation
): RunPreflightCoverageSummary["benchmark"] {
  const base = {
    metricSourceUsed: coverage.metricSourceUsed,
    trueMissingRate: coverage.trueMissingRate,
    symbol: coverage.benchmarkTicker,
    windowStartUsed: coverage.windowStartUsed,
    windowEndUsed: coverage.windowEndUsed,
    expectedDays: coverage.expectedDays,
    actualDays: coverage.actualDays,
    missingDays: coverage.missingDays,
  };
  const windowLabel = formatBenchmarkWindowLabel(base.windowStartUsed, base.windowEndUsed);
  const sourceLabel = ` (source: ${coverage.metricSourceUsed})`;

  if (!coverage.firstDate || coverage.actualDays === 0) {
    return {
      status: "blocked",
      reason: `${coverage.benchmarkTicker} is not ingested yet${windowLabel}${sourceLabel}.`,
      ...base,
      trueMissingRate: 1,
    };
  }

  if (coverage.status === "blocked") {
    return {
      status: "blocked",
      reason: `${coverage.benchmarkTicker} missingness is ${formatPercent(coverage.trueMissingRate)}${windowLabel}${sourceLabel} (${formatPercent(0.1)} max allowed).`,
      ...base,
    };
  }

  if (coverage.status === "warning") {
    return {
      status: "warning",
      reason: `${coverage.benchmarkTicker} missingness is ${formatPercent(coverage.trueMissingRate)}${windowLabel}${sourceLabel} (${formatPercent(0.02)} good threshold, ${formatPercent(0.1)} block threshold).`,
      ...base,
    };
  }

  return {
    status: "good",
    reason: null,
    ...base,
  };
}

export function finalizeRunPreflightResult(params: {
  constraints: RunPreflightConstraints;
  coverage: RunPreflightCoverageSummary;
  warmupStart: string;
  requiredStart: string;
  requiredEnd: string;
  issues: RunPreflightIssue[];
}): RunPreflightResult {
  const { constraints, coverage, warmupStart, requiredStart, requiredEnd, issues } = params;
  const blockIssues = issues.filter((issue) => issue.severity === "blocked");
  const warnIssues = issues.filter((issue) => issue.severity === "warning");
  const status: RunPreflightStatus =
    blockIssues.length > 0 ? "block" : warnIssues.length > 0 ? "warn" : "ok";

  const visibleIssues = status === "block" ? blockIssues : status === "warn" ? warnIssues : [];
  return {
    status,
    issues,
    reasons: visibleIssues.map((issue) => issue.reason),
    suggested_fixes: uniqueFixes(
      visibleIssues
        .map(issueToSuggestedFix)
        .filter((fix): fix is PreflightSuggestedFix => Boolean(fix))
    ),
    constraints,
    coverage,
    warmupStart,
    requiredStart,
    requiredEnd,
  };
}

export function buildRunPreflightResult(params: {
  strategyId: StrategyId;
  startDate: string;
  endDate: string;
  benchmark: string;
  constraints: RunPreflightConstraints;
  symbolRows: MissingnessCoverageRow[];
  benchmarkCoverage?: RunPreflightCoverageSummary["benchmark"];
  benchmarkCandidates?: BenchmarkSuggestionCandidate[];
}): RunPreflightResult {
  const { strategyId, startDate, endDate, benchmark, constraints, symbolRows } = params;
  const issues: RunPreflightIssue[] = [];

  if (constraints.minStartDate && startDate < constraints.minStartDate) {
    issues.push({
      severity: "blocked",
      code: "start_before_universe_min",
      reason: `Start date ${startDate} is earlier than the earliest valid start for this universe (${constraints.minStartDate}).`,
      fix: `Choose ${constraints.minStartDate} or a later start date.`,
      action: {
        kind: "clamp_start_date",
        value: constraints.minStartDate,
        label: "Use earliest start",
      },
    });
  }

  if (endDate > constraints.maxEndDate) {
    issues.push({
      severity: "blocked",
      code: "end_after_cutoff",
      reason: `End date ${endDate} is after the current data cutoff (${constraints.maxEndDate}).`,
      fix: `Choose ${constraints.maxEndDate} or an earlier end date.`,
      action: {
        kind: "clamp_end_date",
        value: constraints.maxEndDate,
        label: "Use cutoff end date",
      },
    });
  }

  const benchmarkRow = symbolRows.find((row) => row.symbol === benchmark);
  const universeRows = symbolRows.filter((row) => !row.isBenchmark);
  const fallbackWindowStart = benchmarkRow?.windowStart ?? constraints.warmupStart;
  const fallbackWindowLabel = formatBenchmarkWindowLabel(
    fallbackWindowStart,
    constraints.requiredEnd
  );
  const benchmarkCoverage = params.benchmarkCoverage ?? {
    status:
      benchmarkRow && benchmarkRow.firstDate
        ? benchmarkRow.trueMissingRate > 0.1
          ? "blocked"
          : benchmarkRow.trueMissingRate > 0.02
            ? "warning"
            : "good"
        : "blocked",
    metricSourceUsed: "run_window" as BenchmarkMetricSource,
    reason:
      !benchmarkRow || !benchmarkRow.firstDate
        ? `${benchmark} is not ingested yet${fallbackWindowLabel} (source: run_window).`
        : benchmarkRow.trueMissingRate > 0.1
          ? `${benchmark} missingness is ${formatPercent(benchmarkRow.trueMissingRate)}${fallbackWindowLabel} (source: run_window) (${formatPercent(0.1)} max allowed).`
          : benchmarkRow.trueMissingRate > 0.02
            ? `${benchmark} missingness is ${formatPercent(benchmarkRow.trueMissingRate)}${fallbackWindowLabel} (source: run_window) (${formatPercent(0.02)} good threshold, ${formatPercent(0.1)} block threshold).`
            : null,
    trueMissingRate: benchmarkRow?.trueMissingRate ?? (benchmarkRow?.firstDate ? 0 : 1),
    symbol: benchmark,
    windowStartUsed: fallbackWindowStart,
    windowEndUsed: constraints.requiredEnd,
    expectedDays: benchmarkRow?.expectedDays ?? 0,
    actualDays: benchmarkRow?.actualDays ?? 0,
    missingDays: benchmarkRow?.trueMissingDays ?? 0,
  };
  const universeCoverage = buildUniverseCoverageStatus({ strategyId, universeRows });

  if (benchmarkCoverage.status === "blocked" && benchmarkCoverage.reason) {
    issues.push({
      severity: "blocked",
      code: "benchmark_missingness_blocked",
      reason: benchmarkCoverage.reason,
      fix: `Choose another benchmark or an earlier date range for ${benchmark}.`,
      action: null,
    });
  }

  if (universeCoverage.status === "blocked" && universeCoverage.reason) {
    issues.push({
      severity: "blocked",
      code:
        universeCoverage.over10Percent.length > 0
          ? "universe_missingness_per_ticker_blocked"
          : "universe_missingness_share_blocked",
      reason: universeCoverage.reason,
      fix: "Choose a later start date, an earlier end date, or a different universe.",
      action: null,
    });
  }

  if (benchmarkCoverage.status === "warning" && benchmarkCoverage.reason) {
    issues.push({
      severity: "warning",
      code: "benchmark_missingness_warning",
      reason: benchmarkCoverage.reason,
      fix: `You can continue, but results versus ${benchmark} may be less reliable.`,
      action: null,
    });
  }
  if (universeCoverage.status === "warning" && universeCoverage.reason) {
    issues.push({
      severity: "warning",
      code: "universe_missingness_warning",
      reason: universeCoverage.reason,
      fix: "You can continue, but this data quality may affect the rankings.",
      action: null,
    });
  }

  return finalizeRunPreflightResult({
    constraints,
    coverage: {
      benchmark: benchmarkCoverage,
      universe: universeCoverage,
      symbols: symbolRows,
      benchmarkCandidates: params.benchmarkCandidates ?? [],
    },
    warmupStart: constraints.warmupStart,
    requiredStart: constraints.requiredStart,
    requiredEnd: constraints.requiredEnd,
    issues,
  });
}

export function buildRunPreflightSnapshot(params: {
  strategyId: StrategyId;
  startDate: string;
  endDate: string;
  benchmark: string;
  constraints: RunPreflightConstraints;
  symbolRows: MissingnessCoverageRow[];
  benchmarkCoverage: RunPreflightCoverageSummary["benchmark"];
  benchmarkCandidates: BenchmarkSuggestionCandidate[];
}): RunPreflightSnapshot {
  const { strategyId, constraints, symbolRows, benchmarkCoverage, benchmarkCandidates } = params;
  const universeRows = symbolRows.filter((row) => !row.isBenchmark);
  return {
    constraints,
    coverage: {
      benchmark: benchmarkCoverage,
      universe: buildUniverseCoverageStatus({ strategyId, universeRows }),
      symbols: symbolRows,
      benchmarkCandidates,
    },
    warmupStart: constraints.warmupStart,
    requiredStart: constraints.requiredStart,
    requiredEnd: constraints.requiredEnd,
  };
}

function statusFromCoverage(params: {
  benchmarkStatus: CoverageHealthStatus;
  universeStatus: CoverageHealthStatus;
}): RunPreflightStatus {
  if (params.benchmarkStatus === "blocked" || params.universeStatus === "blocked") {
    return "block";
  }
  if (params.benchmarkStatus === "warning" || params.universeStatus === "warning") {
    return "warn";
  }
  return "ok";
}

function buildBenchmarkCandidates(params: {
  strategyId: StrategyId;
  universeSymbols: string[];
  warmupStart: string;
  requiredEnd: string;
  statsBySymbol: Map<string, CoverageStatsSnapshot>;
  observedByTicker: Map<string, string[]>;
}): BenchmarkSuggestionCandidate[] {
  const { strategyId, universeSymbols, warmupStart, requiredEnd, statsBySymbol, observedByTicker } =
    params;

  return [...BENCHMARK_OPTIONS]
    .map((symbol) => {
      const benchmarkCoverage = computeBenchmarkCoverage({
        benchmarkTicker: symbol,
        windowStart: warmupStart,
        windowEnd: requiredEnd,
        cutoffDate: requiredEnd,
        stats: statsBySymbol.get(symbol),
        benchmarkDates: observedByTicker.get(symbol) ?? [],
      });
      const benchmarkDates = observedByTicker.get(symbol) ?? [];
      const universeRows = universeSymbols
        .filter((universeSymbol) => universeSymbol !== symbol)
        .map((universeSymbol) =>
          buildUniverseMissingnessRow({
            symbol: universeSymbol,
            benchmarkDates,
            warmupStart,
            requiredEnd,
            stats: statsBySymbol.get(universeSymbol),
            observedDates: observedByTicker.get(universeSymbol) ?? [],
          })
        );
      const universeCoverage = buildUniverseCoverageStatus({
        strategyId,
        universeRows,
      });
      return {
        symbol,
        status: statusFromCoverage({
          benchmarkStatus: benchmarkCoverage.status,
          universeStatus: universeCoverage.status,
        }),
        benchmarkTrueMissingRate: benchmarkCoverage.trueMissingRate,
        affectedShare: universeCoverage.affectedShare,
      };
    })
    .sort((left, right) => {
      const statusRank = { ok: 0, warn: 1, block: 2 } as const;
      const byStatus = statusRank[left.status] - statusRank[right.status];
      if (byStatus !== 0) return byStatus;
      const byMissing = left.benchmarkTrueMissingRate - right.benchmarkTrueMissingRate;
      if (byMissing !== 0) return byMissing;
      return left.symbol.localeCompare(right.symbol);
    });
}

export async function evaluateRunPreflightSnapshot(params: {
  strategyId: StrategyId;
  startDate: string;
  endDate: string;
  universeSymbols: string[];
  benchmark: string;
  dataCutoffDate: string;
  universeEarliestStart: string | null;
  universeValidFrom: string | null;
  missingTickers: string[];
}): Promise<RunPreflightSnapshot> {
  const {
    strategyId,
    universeSymbols,
    benchmark,
    dataCutoffDate,
    universeEarliestStart,
    universeValidFrom,
    missingTickers,
  } = params;

  const minStartDate =
    universeEarliestStart && universeValidFrom
      ? universeEarliestStart > universeValidFrom
        ? universeEarliestStart
        : universeValidFrom
      : (universeEarliestStart ?? universeValidFrom ?? null);

  const { warmupStart, requiredStart, requiredEnd } = resolveRunPreflightWindow({
    strategyId,
    startDate: params.startDate,
    endDate: params.endDate,
    minStartDate,
  });

  const constraints: RunPreflightConstraints = {
    dataCutoffDate,
    universeEarliestStart,
    universeValidFrom,
    minStartDate,
    maxEndDate: getLastCompleteTradingDayUtc(),
    missingTickers,
    warmupStart,
    requiredStart,
    requiredEnd,
  };

  const researchWindowStart = COVERAGE_WINDOW_START;
  const metricSourceUsed: BenchmarkMetricSource =
    params.startDate >= researchWindowStart && requiredEnd <= dataCutoffDate
      ? "research_window"
      : "run_window";
  const metricWindowStart =
    metricSourceUsed === "research_window" ? researchWindowStart : warmupStart;

  const snapshotSymbols = [...new Set([...universeSymbols, benchmark])];
  const allSymbols = [...new Set([...universeSymbols, ...BENCHMARK_OPTIONS])];

  const admin = createAdminClient();
  const statsBySymbol = await fetchTickerStats(admin, allSymbols);
  const observedByTicker = await fetchObservedDatesByTicker({
    admin,
    symbols: allSymbols,
    startDate: metricWindowStart,
    endDate: requiredEnd,
  });

  const benchmarkDates = observedByTicker.get(benchmark) ?? [];
  const benchmarkCoverage = computeBenchmarkCoverage({
    benchmarkTicker: benchmark,
    windowStart: metricWindowStart,
    windowEnd: requiredEnd,
    cutoffDate: requiredEnd,
    metricSourceUsed,
    stats: statsBySymbol.get(benchmark),
    benchmarkDates,
  });
  const benchmarkRow = buildBenchmarkMissingnessRow(benchmarkCoverage);

  const universeRows = universeSymbols
    .filter((symbol) => symbol !== benchmark)
    .map((symbol) =>
      buildUniverseMissingnessRow({
        symbol,
        benchmarkDates,
        warmupStart: metricWindowStart,
        requiredEnd,
        stats: statsBySymbol.get(symbol),
        observedDates: observedByTicker.get(symbol) ?? [],
      })
    );

  const symbolRows: MissingnessCoverageRow[] = [benchmarkRow, ...universeRows];

  const benchmarkCandidates = buildBenchmarkCandidates({
    strategyId,
    universeSymbols,
    warmupStart: metricWindowStart,
    requiredEnd,
    statsBySymbol,
    observedByTicker,
  });

  return buildRunPreflightSnapshot({
    strategyId,
    startDate: params.startDate,
    endDate: params.endDate,
    benchmark,
    constraints,
    symbolRows: symbolRows.filter((row) => snapshotSymbols.includes(row.symbol)),
    benchmarkCoverage: buildBenchmarkCoverageSummary(benchmarkCoverage),
    benchmarkCandidates,
  });
}

export async function evaluateRunPreflight(params: {
  strategyId: StrategyId;
  startDate: string;
  endDate: string;
  universeSymbols: string[];
  benchmark: string;
  dataCutoffDate: string;
  universeEarliestStart: string | null;
  universeValidFrom: string | null;
  missingTickers: string[];
}): Promise<RunPreflightResult> {
  const snapshot = await evaluateRunPreflightSnapshot(params);
  return buildRunPreflightResult({
    strategyId: params.strategyId,
    startDate: params.startDate,
    endDate: params.endDate,
    benchmark: params.benchmark,
    constraints: snapshot.constraints,
    symbolRows: snapshot.coverage.symbols,
    benchmarkCoverage: snapshot.coverage.benchmark,
    benchmarkCandidates: snapshot.coverage.benchmarkCandidates,
  });
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
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("data_ingest_jobs")
      .select("symbol, status, next_retry_at")
      .in("status", ["queued", "running", "retrying", "failed"]);

    return new Set(
      (data ?? [])
        .filter((j: { status?: string | null; next_retry_at?: string | null }) =>
          isActiveDataIngestStatus(j.status, j.next_retry_at)
        )
        .map((j: { symbol?: string }) => j.symbol?.toUpperCase())
        .filter((t: string | undefined): t is string => Boolean(t))
    );
  } catch {
    return new Set();
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
    const pct = (c.coverageRatio * 100).toFixed(1);
    const thr = (c.threshold * 100).toFixed(0);
    const role = c.isBenchmark ? "benchmark" : "universe";
    if (c.status === "not_ingested") {
      return `${c.symbol} (${role}): not ingested`;
    }
    return `${c.symbol} (${role}): ${pct}% < ${thr}% required (${c.actualDays}/${c.expectedDays} days)`;
  });
  return lines.join("; ");
}
