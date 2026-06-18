import { BENCHMARK_OPTIONS } from "@/lib/benchmark";
import { getLastCompleteTradingDayUtc } from "@/lib/data-cutoff";
import { createAdminClient } from "@/lib/supabase/admin";
import { COVERAGE_WINDOW_START } from "@/lib/supabase/types";
import {
  buildBenchmarkMissingnessRow,
  buildUniverseMissingnessRow,
  computeBenchmarkCoverage,
  fetchObservedDatesByTicker,
  fetchTickerStats,
} from "@/lib/coverage-check/benchmark-coverage";
import { resolveRunPreflightWindow } from "@/lib/coverage-check/date-utils";
import {
  buildRunPreflightResult,
  buildRunPreflightSnapshot,
  buildUniverseCoverageStatus,
  formatBenchmarkWindowLabel,
  formatPercent,
} from "@/lib/coverage-check/preflight-result";

import type {
  BenchmarkCoverageComputation,
  BenchmarkMetricSource,
  BenchmarkSuggestionCandidate,
  CoverageHealthStatus,
  CoverageStatsSnapshot,
  MissingnessCoverageRow,
  RunPreflightConstraints,
  RunPreflightCoverageSummary,
  RunPreflightResult,
  RunPreflightSnapshot,
  RunPreflightStatus,
} from "@/lib/coverage-check/types";
import type { StrategyId } from "@/lib/types";

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
