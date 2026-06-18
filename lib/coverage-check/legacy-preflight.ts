import { createAdminClient } from "@/lib/supabase/admin";
import { STRATEGY_WARMUP_CALENDAR_DAYS } from "@/lib/strategy-warmup";
import { TICKER_INCEPTION_DATES } from "@/lib/supabase/types";
import { classifyUnhealthySymbols } from "@/lib/coverage-check/classification";
import {
  addCalendarDays,
  countBusinessDays,
  formatDateForMessage,
  subtractCalendarDays,
} from "@/lib/coverage-check/date-utils";
import {
  BENCHMARK_COVERAGE_THRESHOLD,
  getUniverseThreshold,
} from "@/lib/coverage-check/thresholds";

import type {
  PreflightResult,
  PreflightStatus,
  SymbolCoverage,
  SymbolCoverageStatus,
} from "@/lib/coverage-check/types";
import type { StrategyId } from "@/lib/types";

/**
 * Check whether all required symbols have sufficient price coverage for the
 * backtest window (including strategy warmup period).
 *
 * Strict mode (default): any symbol below threshold -> allHealthy = false.
 *
 * Gap policy:
 *   - Coverage is measured as actualDays / expectedDays using a Mon-Fri
 *     business-day approximation (market holidays are not excluded).
 *   - We do NOT forward-fill to fabricate missing days; missing days are
 *     counted as absent.
 *   - For large gaps (coverage < threshold): run waits for ingestion.
 *   - For Yahoo gaps that persist after ingestion: STRICT runs fail with a
 *     clear diagnostic.
 *
 * Thresholds:
 *   - Benchmark:          >= 99%  (BENCHMARK_COVERAGE_THRESHOLD)
 *   - Universe (standard): >= 98%  (UNIVERSE_COVERAGE_THRESHOLD)
 *   - Universe (momentum/ML): >= 99% (HIGH_SENSITIVITY_UNIVERSE_THRESHOLD)
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

  const allSymbols = [...new Set([...universeSymbols, benchmark])];

  {
    const universeThresholdForCheck = getUniverseThreshold(strategyId);
    const expectedForCheck = expectedDays;

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

  type AggRow = { ticker: string; actual_days: string | number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcData, error: rpcError } = (await (admin as any).rpc(
    "get_benchmark_coverage_agg",
    { p_tickers: allSymbols, p_start: requiredStart, p_end: requiredEnd }
  )) as { data: AggRow[] | null; error: { message: string } | null };

  if (rpcError) {
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
