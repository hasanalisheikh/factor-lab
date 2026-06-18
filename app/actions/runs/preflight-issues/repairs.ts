import "server-only";

import { z } from "zod";

import type { RunPreflightIssue, RunPreflightSnapshot } from "@/lib/coverage-check";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UniverseId } from "@/lib/universe-config";

import { TREND_DEFENSIVE_FALLBACK, TREND_DEFENSIVE_PRIMARY } from "../constants";
import { ensureUniverseDataReadyInternal } from "../data-readiness";
import { nextDate, normalizeDate } from "../date-utils";
import { defaultIngestStartDate, ensureSymbolRepairsInternal } from "../repairs";
import { runConfigSchema } from "../schema";
import type { TickerStatsSnapshot } from "../types";

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
