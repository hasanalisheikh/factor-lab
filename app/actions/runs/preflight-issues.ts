import "server-only";

import { z } from "zod";

import type { RunPreflightIssue, RunPreflightSnapshot } from "@/lib/coverage-check";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UniverseId } from "@/lib/universe-config";
import {
  ML_STRATEGIES,
  RANKING_STRATEGIES,
  TREND_DEFENSIVE_FALLBACK,
  TREND_DEFENSIVE_PRIMARY,
} from "./constants";
import { ensureUniverseDataReadyInternal } from "./data-readiness";
import {
  addCalendarDays,
  countBusinessDays,
  dayBefore,
  getMinTrainDays,
  getTrainWindowCalendarDays,
  getTrainWindowDays,
  nextDate,
  normalizeDate,
  pickLaterDate,
  subtractCalendarDays,
} from "./date-utils";
import { defaultIngestStartDate, ensureSymbolRepairsInternal } from "./repairs";
import { runConfigSchema } from "./schema";
import type { TickerStatsSnapshot } from "./types";

function formatSymbolList(symbols: string[]): string {
  if (symbols.length === 0) return "";
  if (symbols.length === 1) return symbols[0];
  if (symbols.length === 2) return `${symbols[0]} and ${symbols[1]}`;
  return `${symbols.slice(0, -1).join(", ")}, and ${symbols.at(-1)}`;
}

export async function getTickerStatsSnapshot(
  symbols: string[]
): Promise<Map<string, TickerStatsSnapshot>> {
  const uniqueSymbols = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
  const result = new Map<string, TickerStatsSnapshot>();
  if (uniqueSymbols.length === 0) return result;

  type StatsRow = { symbol: string; first_date: string | null; last_date: string | null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = (await admin
    .from("ticker_stats")
    .select("symbol, first_date, last_date")
    .in("symbol", uniqueSymbols)) as { data: StatsRow[] | null; error: { message: string } | null };

  if (error) {
    console.error("getTickerStatsSnapshot error:", error.message);
    return result;
  }

  for (const row of data ?? []) {
    result.set(row.symbol.toUpperCase(), {
      symbol: row.symbol.toUpperCase(),
      firstDate: normalizeDate(row.first_date),
      lastDate: normalizeDate(row.last_date),
    });
  }

  return result;
}

export function buildRepairIssue(params: {
  code: string;
  symbols: string[];
  failedSymbols: string[];
  reasonPrefix: string;
  waitingFix: string;
  retryLabel: string;
}): RunPreflightIssue {
  const { code, symbols, failedSymbols, reasonPrefix, waitingFix, retryLabel } = params;
  const names = formatSymbolList(symbols);
  if (failedSymbols.length > 0) {
    return {
      severity: "blocked",
      code,
      reason: `${reasonPrefix} for ${formatSymbolList(failedSymbols)}. We couldn't start that data refresh automatically.`,
      fix: retryLabel,
      action: {
        kind: "retry_repairs",
        value: failedSymbols,
        label: "Retry repair",
      },
    };
  }

  return {
    severity: "blocked",
    code,
    reason: `${reasonPrefix} for ${names}. We've queued a data refresh.`,
    fix: waitingFix,
    action: null,
  };
}

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

export async function buildRepairIssues(params: {
  input: z.infer<typeof runConfigSchema>;
  userId: string;
  snapshot: RunPreflightSnapshot;
}): Promise<RunPreflightIssue[]> {
  const { input, userId, snapshot } = params;
  const issues: RunPreflightIssue[] = [];
  if (input.end_date > snapshot.constraints.maxEndDate) {
    return issues;
  }
  const requiredEnd = snapshot.requiredEnd;
  const universeId = input.universe as UniverseId;

  if (snapshot.constraints.missingTickers.length > 0) {
    const universeRepair = await ensureUniverseDataReadyInternal(universeId, userId, {
      createBatch: true,
    });
    issues.push(
      buildRepairIssue({
        code: "universe_missing_data_repair_started",
        symbols: snapshot.constraints.missingTickers,
        failedSymbols: universeRepair.failedSymbols,
        reasonPrefix: "We're missing price history",
        waitingFix: "Try queueing the run again after the repair batch finishes.",
        retryLabel: "Retry the universe data repair.",
      })
    );
  }

  const benchmarkRow = snapshot.coverage.symbols.find((row) => row.isBenchmark);
  const universeRows = snapshot.coverage.symbols.filter((row) => !row.isBenchmark);

  const staleUniversePlans = universeRows
    .filter((row) => row.symbol !== input.benchmark)
    .filter((row) => row.firstDate && row.lastDate && row.lastDate < requiredEnd)
    .map((row) => ({
      symbol: row.symbol,
      desiredStart: nextDate(row.lastDate as string),
      desiredEnd: requiredEnd,
    }));

  if (staleUniversePlans.length > 0) {
    const universeRepair = await ensureSymbolRepairsInternal({
      plans: staleUniversePlans,
      userId,
      requestedBy: `run-preflight:${userId}:${input.universe}:universe`,
    });
    issues.push(
      buildRepairIssue({
        code: "universe_stale_data_repair_started",
        symbols: staleUniversePlans.map((plan) => plan.symbol),
        failedSymbols: universeRepair.failedSymbols,
        reasonPrefix: `We do not have price data through ${requiredEnd}`,
        waitingFix: "Try queueing the run again after those prices are available.",
        retryLabel: "Retry the universe repair.",
      })
    );
  }

  const benchmarkNeedsRepair =
    benchmarkRow &&
    (benchmarkRow.firstDate === null ||
      (benchmarkRow.lastDate !== null && benchmarkRow.lastDate < requiredEnd));
  if (benchmarkNeedsRepair && benchmarkRow) {
    const benchmarkRepair = await ensureSymbolRepairsInternal({
      plans: [
        {
          symbol: benchmarkRow.symbol,
          desiredStart: benchmarkRow.lastDate
            ? nextDate(benchmarkRow.lastDate)
            : defaultIngestStartDate(benchmarkRow.symbol),
          desiredEnd: requiredEnd,
        },
      ],
      userId,
      requestedBy: `run-preflight:${userId}:${input.universe}:benchmark`,
    });
    issues.push(
      buildRepairIssue({
        code: "benchmark_repair_started",
        symbols: [benchmarkRow.symbol],
        failedSymbols: benchmarkRepair.failedSymbols,
        reasonPrefix: `We do not have price data through ${requiredEnd}`,
        waitingFix: "Try queueing the run again after those prices are available.",
        retryLabel: "Retry the benchmark repair.",
      })
    );
  }

  if (input.strategy_id === "trend_filter") {
    const stats = await getTickerStatsSnapshot([TREND_DEFENSIVE_PRIMARY, TREND_DEFENSIVE_FALLBACK]);
    const primary = stats.get(TREND_DEFENSIVE_PRIMARY) ?? {
      symbol: TREND_DEFENSIVE_PRIMARY,
      firstDate: null,
      lastDate: null,
    };
    const fallback = stats.get(TREND_DEFENSIVE_FALLBACK) ?? {
      symbol: TREND_DEFENSIVE_FALLBACK,
      firstDate: null,
      lastDate: null,
    };
    const primaryReady = Boolean(
      primary.firstDate && primary.lastDate && primary.lastDate >= requiredEnd
    );
    const fallbackReady = Boolean(
      fallback.firstDate && fallback.lastDate && fallback.lastDate >= requiredEnd
    );
    if (!primaryReady && !fallbackReady) {
      const repairTarget =
        primary.lastDate && primary.lastDate < requiredEnd
          ? primary
          : primary.firstDate
            ? fallback
            : primary;
      const repairResult = await ensureSymbolRepairsInternal({
        plans: [
          {
            symbol: repairTarget.symbol,
            desiredStart: repairTarget.lastDate
              ? nextDate(repairTarget.lastDate)
              : defaultIngestStartDate(repairTarget.symbol),
            desiredEnd: requiredEnd,
          },
        ],
        userId,
        requestedBy: `run-preflight:${userId}:${input.universe}:defensive`,
      });
      issues.push(
        buildRepairIssue({
          code: "trend_defensive_repair_started",
          symbols: [repairTarget.symbol],
          failedSymbols: repairResult.failedSymbols,
          reasonPrefix: "Trend Filter needs a defensive risk-off asset",
          waitingFix: "Try queueing the run again after the defensive asset repair finishes.",
          retryLabel: "Retry the defensive asset repair.",
        })
      );
    }
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
