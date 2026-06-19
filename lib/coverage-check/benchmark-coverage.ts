import { countDatesInRange, resolveCoverageWindowStart } from "@/lib/coverage-check/date-utils";

import type {
  BenchmarkCoverageComputation,
  BenchmarkCoverageStatus,
  CoverageStatsSnapshot,
  MissingnessCoverageRow,
} from "@/lib/coverage-check/types";

export async function fetchTickerStats(
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

export async function fetchObservedDatesByTicker(params: {
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

export async function fetchObservedDateCountsByTicker(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  windowsBySymbol: Map<string, { startDate: string; endDate: string }>;
}): Promise<Map<string, number>> {
  const { admin, windowsBySymbol } = params;
  const counts = new Map<string, number>();
  for (const symbol of windowsBySymbol.keys()) {
    counts.set(symbol, 0);
  }

  const windows = [...windowsBySymbol.entries()].filter(
    ([, window]) => window.startDate <= window.endDate
  );
  const batchSize = 8;

  for (let offset = 0; offset < windows.length; offset += batchSize) {
    const batch = windows.slice(offset, offset + batchSize);
    const results = await Promise.all(
      batch.map(async ([symbol, window]) => {
        const { count, error } = (await admin
          .from("prices")
          .select("*", { count: "exact", head: true })
          .eq("ticker", symbol)
          .gte("date", window.startDate)
          .lte("date", window.endDate)) as {
          count: number | null;
          error: { message: string } | null;
        };

        if (error) {
          console.error(`[coverage-check] prices count error for ${symbol}:`, error.message);
          return [symbol, 0] as const;
        }

        return [symbol, count ?? 0] as const;
      })
    );

    for (const [symbol, count] of results) {
      counts.set(symbol, count);
    }
  }

  return counts;
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
  metricSourceUsed?: "research_window" | "run_window" | "db_wide";
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

export function buildBenchmarkMissingnessRow(
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

export function buildUniverseMissingnessRow(params: {
  symbol: string;
  benchmarkDates: readonly string[];
  warmupStart: string;
  requiredEnd: string;
  stats: CoverageStatsSnapshot | undefined;
  observedDates?: readonly string[];
  observedDateCount?: number;
}): MissingnessCoverageRow {
  const {
    symbol,
    benchmarkDates,
    warmupStart,
    requiredEnd,
    stats,
    observedDates = [],
    observedDateCount,
  } = params;
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
  const actualDays = !windowStart
    ? 0
    : (observedDateCount ?? countDatesInRange(observedDates, windowStart, requiredEnd));
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
