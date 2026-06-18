import "server-only";

import { z } from "zod";

import type { RunPreflightIssue, RunPreflightSnapshot } from "@/lib/coverage-check";
import { ML_STRATEGIES, RANKING_STRATEGIES } from "./constants";
import {
  addCalendarDays,
  countBusinessDays,
  dayBefore,
  getMinTrainDays,
  getTrainWindowCalendarDays,
  getTrainWindowDays,
  pickLaterDate,
  subtractCalendarDays,
} from "./date-utils";
import { runConfigSchema } from "./schema";

export {
  buildRepairIssue,
  buildRepairIssues,
  getTickerStatsSnapshot,
} from "./preflight-issues/repairs";

export function buildDateIssues(
  snapshot: RunPreflightSnapshot,
  input: z.infer<typeof runConfigSchema>
): RunPreflightIssue[] {
  const issues: RunPreflightIssue[] = [];
  if (snapshot.constraints.minStartDate && input.start_date < snapshot.constraints.minStartDate) {
    const limitingUniverseRow = snapshot.coverage.symbols
      .filter((row) => !row.isBenchmark && row.firstDate === snapshot.constraints.minStartDate)
      .sort((left, right) => left.symbol.localeCompare(right.symbol))[0];
    issues.push({
      severity: "blocked",
      code: "start_before_universe_min",
      reason: limitingUniverseRow
        ? `This universe can't start before ${snapshot.constraints.minStartDate} because ${limitingUniverseRow.symbol} did not exist yet.`
        : `This universe can't start before ${snapshot.constraints.minStartDate}.`,
      fix: `Choose ${snapshot.constraints.minStartDate} or a later start date.`,
      action: {
        kind: "clamp_start_date",
        value: snapshot.constraints.minStartDate,
        label: "Use earliest start",
      },
    });
  }
  if (input.end_date > snapshot.constraints.maxEndDate) {
    issues.push({
      severity: "blocked",
      code: "end_after_cutoff",
      reason: `We do not have data past ${snapshot.constraints.maxEndDate} yet.`,
      fix: `Use ${snapshot.constraints.maxEndDate} or an earlier end date. Weekend and market-holiday prices appear on the previous trading day.`,
      action: {
        kind: "clamp_end_date",
        value: snapshot.constraints.maxEndDate,
        label: `Use ${snapshot.constraints.maxEndDate}`,
      },
    });
  }
  return issues;
}

export function buildTopNIssues(params: {
  input: z.infer<typeof runConfigSchema>;
  universeSize: number;
}): RunPreflightIssue[] {
  const { input, universeSize } = params;
  if (!RANKING_STRATEGIES.has(input.strategy_id)) return [];
  if (input.top_n <= universeSize) return [];
  return [
    {
      severity: "blocked",
      code: "top_n_above_universe_size",
      reason: `Top N is ${input.top_n}, but ${input.universe} only has ${universeSize} assets available for this strategy.`,
      fix: `Reduce Top N to ${universeSize} or lower.`,
      action: {
        kind: "reduce_top_n",
        value: universeSize,
        label: `Reduce Top N to ${universeSize}`,
      },
    },
  ];
}

export function buildMlIssues(params: {
  input: z.infer<typeof runConfigSchema>;
  snapshot: RunPreflightSnapshot;
}): RunPreflightIssue[] {
  const { input, snapshot } = params;
  if (!ML_STRATEGIES.has(input.strategy_id)) return [];

  const benchmarkRow = snapshot.coverage.symbols.find((row) => row.isBenchmark);
  const universeRows = snapshot.coverage.symbols.filter((row) => !row.isBenchmark);
  const benchmarkFirstDate = benchmarkRow?.firstDate;
  if (!benchmarkFirstDate) return [];

  const minTrainDays = getMinTrainDays();
  const trainWindowDays = getTrainWindowDays();
  const trainWindowCalendarDays = getTrainWindowCalendarDays();
  const featureLookbackDays = 252;
  const benchmarkFeatureLookbackDays = 60;
  const lastTrainDate = dayBefore(input.start_date);
  if (lastTrainDate < benchmarkFirstDate) {
    return [
      {
        severity: "blocked",
        code: "ml_insufficient_training_history",
        reason: "This ML strategy needs more training history before the selected start date.",
        fix: "Pick a later start date, a smaller Top N, or a universe with longer history.",
        action: null,
      },
    ];
  }

  const trainWindowStart = subtractCalendarDays(lastTrainDate, trainWindowCalendarDays);
  const benchmarkReadyDate = pickLaterDate(
    trainWindowStart,
    addCalendarDays(benchmarkFirstDate, benchmarkFeatureLookbackDays)
  );
  const trainDays =
    benchmarkReadyDate && benchmarkReadyDate <= lastTrainDate
      ? countBusinessDays(benchmarkReadyDate, lastTrainDate)
      : 0;

  let trainRows = 0;
  let investableCount = 0;
  for (const row of universeRows) {
    if (!row.firstDate) continue;
    const rowReadyDate = pickLaterDate(
      addCalendarDays(row.firstDate, featureLookbackDays),
      benchmarkReadyDate
    );
    if (!rowReadyDate || rowReadyDate > lastTrainDate) continue;
    trainRows += countBusinessDays(rowReadyDate, lastTrainDate);
    investableCount += 1;
  }

  const avgSymbolsPerDay = trainDays > 0 ? trainRows / trainDays : 0;
  const requiredRows = minTrainDays * input.top_n;
  const issues: RunPreflightIssue[] = [];

  if (investableCount < input.top_n && investableCount > 0) {
    issues.push({
      severity: "blocked",
      code: "top_n_above_investable_count",
      reason: `Top N is ${input.top_n}, but only ${investableCount} symbols have enough ML training history on this start date.`,
      fix: `Reduce Top N to ${investableCount} or choose a later start date.`,
      action: {
        kind: "reduce_top_n",
        value: investableCount,
        label: `Reduce Top N to ${investableCount}`,
      },
    });
  }

  if (
    investableCount === 0 ||
    trainDays < minTrainDays ||
    trainRows < requiredRows ||
    avgSymbolsPerDay < Math.max(input.top_n, 2)
  ) {
    issues.push({
      severity: "blocked",
      code: "ml_insufficient_training_history",
      reason: `This ML strategy needs more training history. We found ${trainDays} train days, ${trainRows} train rows, and ${avgSymbolsPerDay.toFixed(1)} symbols per day.`,
      fix: `Pick a later start date or reduce Top N. Current requirements are at least ${minTrainDays} train days, ${requiredRows} train rows, and ${Math.max(input.top_n, 2)} symbols per day.`,
      action:
        investableCount > 0 && investableCount < input.top_n
          ? {
              kind: "reduce_top_n",
              value: investableCount,
              label: `Reduce Top N to ${investableCount}`,
            }
          : null,
    });
  }

  if (trainWindowDays > 0 && trainDays < trainWindowDays) {
    issues.push({
      severity: "warning",
      code: "ml_training_window_short",
      reason: `This ML run has ${trainDays} pre-start train days, which is shorter than the configured ${trainWindowDays}-day rolling window.`,
      fix: "You can continue, but the model will begin with a smaller-than-configured training window.",
      action: null,
    });
  }

  return issues;
}

export function getRepairableUniverseSymbols(snapshot: RunPreflightSnapshot): Set<string> {
  return new Set(
    snapshot.coverage.symbols
      .filter((row) => !row.isBenchmark)
      .filter((row) => row.firstDate && row.lastDate && row.lastDate < snapshot.requiredEnd)
      .map((row) => row.symbol)
  );
}

export function getRepairableBenchmarkSymbol(snapshot: RunPreflightSnapshot): string | null {
  const benchmarkRow = snapshot.coverage.symbols.find((row) => row.isBenchmark);
  if (!benchmarkRow) return null;
  if (benchmarkRow.firstDate === null) return benchmarkRow.symbol;
  if (benchmarkRow.lastDate !== null && benchmarkRow.lastDate < snapshot.requiredEnd) {
    return benchmarkRow.symbol;
  }
  return null;
}

export function getStatusRank(status: "ok" | "warn" | "block"): number {
  if (status === "ok") return 0;
  if (status === "warn") return 1;
  return 2;
}

export function pickBenchmarkSuggestion(params: {
  snapshot: RunPreflightSnapshot;
  currentBenchmark: string;
  currentStatus: "ok" | "warn" | "block";
}): string | null {
  const { snapshot, currentBenchmark, currentStatus } = params;
  const currentRank = getStatusRank(currentStatus);
  const suggestion = snapshot.coverage.benchmarkCandidates.find(
    (candidate) =>
      candidate.symbol !== currentBenchmark && getStatusRank(candidate.status) < currentRank
  );
  return suggestion?.symbol ?? null;
}
