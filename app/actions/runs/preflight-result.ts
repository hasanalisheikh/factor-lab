import "server-only";

import { z } from "zod";

import {
  buildUniverseCoverageStatus,
  evaluateRunPreflightSnapshot,
  finalizeRunPreflightResult,
  type RunPreflightIssue,
  type RunPreflightResult,
  type RunPreflightSnapshot,
} from "@/lib/coverage-check";
import { getLastCompleteTradingDayUtc } from "@/lib/data-cutoff";
import { getUniverseConstraintsSnapshot } from "@/lib/supabase/queries";
import type { UniverseId } from "@/lib/universe-config";
import { ML_STRATEGIES } from "./constants";
import { resolveUniverseSymbols } from "./data-readiness";
import { buildErrorPreflightResult } from "./preflight-error";
import { runConfigSchema } from "./schema";
import {
  buildDateIssues,
  buildMlIssues,
  buildRepairIssues,
  buildTopNIssues,
  getRepairableBenchmarkSymbol,
  getRepairableUniverseSymbols,
  pickBenchmarkSuggestion,
} from "./preflight-issues";
import type { RunConfigInput } from "./types";

function buildCoverageIssues(params: {
  input: z.infer<typeof runConfigSchema>;
  snapshot: RunPreflightSnapshot;
}): RunPreflightIssue[] {
  const { input, snapshot } = params;
  const issues: RunPreflightIssue[] = [];
  const repairableUniverseSymbols = getRepairableUniverseSymbols(snapshot);
  const repairableBenchmarkSymbol = getRepairableBenchmarkSymbol(snapshot);
  const benchmarkRow = snapshot.coverage.symbols.find((row) => row.isBenchmark);
  const universeRows = snapshot.coverage.symbols.filter(
    (row) => !row.isBenchmark && !repairableUniverseSymbols.has(row.symbol)
  );
  const benchmarkCoverage = repairableBenchmarkSymbol
    ? {
        status: "good",
        reason: null,
        metricSourceUsed: snapshot.coverage.benchmark.metricSourceUsed,
        trueMissingRate: 0,
        symbol: input.benchmark,
        windowStartUsed: benchmarkRow?.windowStart ?? snapshot.coverage.benchmark.windowStartUsed,
        windowEndUsed: snapshot.coverage.benchmark.windowEndUsed,
        expectedDays: benchmarkRow?.expectedDays ?? 0,
        actualDays: benchmarkRow?.actualDays ?? 0,
        missingDays: benchmarkRow?.trueMissingDays ?? 0,
      }
    : snapshot.coverage.benchmark;
  const universeCoverage = buildUniverseCoverageStatus({
    strategyId: input.strategy_id,
    universeRows,
  });
  const combinedStatus: "ok" | "warn" | "block" =
    benchmarkCoverage.status === "blocked" || universeCoverage.status === "blocked"
      ? "block"
      : benchmarkCoverage.status === "warning" || universeCoverage.status === "warning"
        ? "warn"
        : "ok";
  const benchmarkSuggestion = pickBenchmarkSuggestion({
    snapshot,
    currentBenchmark: input.benchmark,
    currentStatus: combinedStatus,
  });

  if (benchmarkCoverage.status === "blocked" && benchmarkCoverage.reason) {
    issues.push({
      severity: "blocked",
      code: "benchmark_missingness_blocked",
      reason: benchmarkCoverage.reason,
      fix: benchmarkSuggestion
        ? `Choose ${benchmarkSuggestion} instead of ${input.benchmark}, or pick an earlier end date.`
        : `Pick an earlier end date or choose another benchmark instead of ${input.benchmark}.`,
      action: benchmarkSuggestion
        ? {
            kind: "change_benchmark",
            value: benchmarkSuggestion,
            label: `Use ${benchmarkSuggestion}`,
          }
        : null,
    });
  } else if (benchmarkCoverage.status === "warning" && benchmarkCoverage.reason) {
    issues.push({
      severity: "warning",
      code: "benchmark_missingness_warning",
      reason: benchmarkCoverage.reason,
      fix: benchmarkSuggestion
        ? `You can continue, but comparisons versus ${input.benchmark} may be noisy. ${benchmarkSuggestion} is a cleaner alternative for this window.`
        : `You can continue, but comparisons versus ${input.benchmark} may be noisy.`,
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
      fix: benchmarkSuggestion
        ? `Choose ${benchmarkSuggestion}, a later start date, an earlier end date, or a different universe.`
        : "Choose a later start date, an earlier end date, or a different universe.",
      action: benchmarkSuggestion
        ? {
            kind: "change_benchmark",
            value: benchmarkSuggestion,
            label: `Use ${benchmarkSuggestion}`,
          }
        : null,
    });
  } else if (universeCoverage.status === "warning" && universeCoverage.reason) {
    issues.push({
      severity: "warning",
      code: "universe_missingness_warning",
      reason: universeCoverage.reason,
      fix: "You can continue, but this missingness may affect rankings and risk estimates.",
      action: null,
    });
  }

  return issues;
}

export function buildPersistedPreflightSnapshot(
  preflight: RunPreflightResult,
  acknowledged: boolean
) {
  return {
    data_cutoff_date: preflight.constraints.dataCutoffDate,
    universe_earliest_start: preflight.constraints.universeEarliestStart,
    universe_valid_from: preflight.constraints.universeValidFrom,
    min_start_date: preflight.constraints.minStartDate,
    max_end_date: preflight.constraints.maxEndDate,
    missing_tickers: preflight.constraints.missingTickers,
    warmup_start: preflight.warmupStart,
    required_start: preflight.requiredStart,
    required_end: preflight.requiredEnd,
    benchmark_coverage_health: preflight.coverage.benchmark,
    universe_missingness_summary: preflight.coverage.universe,
    benchmark_candidates: preflight.coverage.benchmarkCandidates,
    issues: preflight.issues,
    reasons: preflight.reasons,
    warnings_acknowledged: acknowledged,
    status: preflight.status,
  };
}

export function dedupeIssues(issues: RunPreflightIssue[]): RunPreflightIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = JSON.stringify(issue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function preflightRunInternal(
  input: RunConfigInput,
  userId: string
): Promise<RunPreflightResult> {
  const parsed = runConfigSchema.safeParse(input);
  const universe = (parsed.success ? parsed.data.universe : "ETF8") as UniverseId;
  const constraints = await getUniverseConstraintsSnapshot(universe);

  if (!parsed.success) {
    return buildErrorPreflightResult(parsed.error.issues[0].message, constraints);
  }

  const cutoffDate =
    ML_STRATEGIES.has(parsed.data.strategy_id) && constraints.dataCutoffDate
      ? constraints.dataCutoffDate
      : getLastCompleteTradingDayUtc();
  const snapshot = await evaluateRunPreflightSnapshot({
    strategyId: parsed.data.strategy_id,
    startDate: parsed.data.start_date,
    endDate: parsed.data.end_date,
    universeSymbols: resolveUniverseSymbols(parsed.data.universe),
    benchmark: parsed.data.benchmark,
    dataCutoffDate: cutoffDate,
    universeEarliestStart: constraints.universeEarliestStart,
    universeValidFrom: constraints.universeValidFrom,
    missingTickers: constraints.missingTickers,
  });

  const issues = dedupeIssues([
    ...buildDateIssues(snapshot, parsed.data),
    ...(await buildRepairIssues({
      input: parsed.data,
      userId,
      snapshot,
    })),
    ...buildCoverageIssues({
      input: parsed.data,
      snapshot,
    }),
    ...buildTopNIssues({
      input: parsed.data,
      universeSize: resolveUniverseSymbols(parsed.data.universe as UniverseId).length,
    }),
    ...buildMlIssues({
      input: parsed.data,
      snapshot,
    }),
  ]);

  return finalizeRunPreflightResult({
    constraints: snapshot.constraints,
    coverage: snapshot.coverage,
    warmupStart: snapshot.warmupStart,
    requiredStart: snapshot.requiredStart,
    requiredEnd: snapshot.requiredEnd,
    issues,
  });
}
