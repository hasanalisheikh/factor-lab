import { HIGH_SENSITIVITY_STRATEGIES } from "@/lib/coverage-check/thresholds";

import type {
  BenchmarkMetricSource,
  BenchmarkSuggestionCandidate,
  MissingnessCoverageRow,
  PreflightSuggestedFix,
  RunPreflightConstraints,
  RunPreflightCoverageSummary,
  RunPreflightIssue,
  RunPreflightResult,
  RunPreflightSnapshot,
  RunPreflightStatus,
} from "@/lib/coverage-check/types";
import type { StrategyId } from "@/lib/types";

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

export function formatBenchmarkWindowLabel(windowStart: string, windowEnd: string): string {
  return ` over ${windowStart} -> ${windowEnd}`;
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
      reason: `We do not have data past ${constraints.maxEndDate} yet.`,
      fix: `Use ${constraints.maxEndDate} or an earlier end date. Weekend and market-holiday prices appear on the previous trading day.`,
      action: {
        kind: "clamp_end_date",
        value: constraints.maxEndDate,
        label: `Use ${constraints.maxEndDate}`,
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

export { formatPercent };
