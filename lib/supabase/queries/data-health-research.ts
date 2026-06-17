import "server-only";

import { BENCHMARK_OPTIONS } from "@/lib/benchmark";
import { getLastCompleteTradingDayUtc, getRequiredTickers } from "@/lib/data-cutoff";
import { computeBenchmarkCoverage, type CoverageStatsSnapshot } from "@/lib/coverage-check";
import { createClient } from "../server";
import { TICKER_INCEPTION_DATES, type BenchmarkCoverage, type TickerDateRange } from "../types";
import { getAllTickerStats } from "./data-health-tickers";
import {
  buildRequiredTickerResearchStarts,
  COVERAGE_WINDOW_START,
  summarizeTickerAgainstCalendar,
  type RequiredTickerResearchSummary,
} from "./shared";

export async function getRequiredTickerResearchSummary(
  dataCutoffDate: string | null,
  prefetchedRanges?: TickerDateRange[]
): Promise<RequiredTickerResearchSummary> {
  const empty: RequiredTickerResearchSummary = {
    rows: [],
    requiredTickers: getRequiredTickers(),
    notIngestedTickers: [],
    ingestedTickers: 0,
    completeness: null,
    totalExpected: 0,
    totalActual: 0,
    totalTrueMissing: 0,
    trueMissingRate: 0,
    marketCalendarDays: 0,
  };

  const researchEnd = dataCutoffDate ?? getLastCompleteTradingDayUtc();
  const requiredTickers = getRequiredTickers();
  const ranges = prefetchedRanges ?? (await getAllTickerStats());
  const researchStarts = buildRequiredTickerResearchStarts(ranges);
  const minResearchStart = [...researchStarts.values()].sort()[0] ?? COVERAGE_WINDOW_START;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("prices")
      .select("ticker, date")
      .in("ticker", requiredTickers)
      .gte("date", minResearchStart)
      .lte("date", researchEnd)
      .order("date", { ascending: true });

    if (error) {
      console.error("getRequiredTickerResearchSummary error:", error.message);
      return empty;
    }

    const observedByTicker = new Map<string, string[]>();
    const marketCalendarSet = new Set<string>();

    for (const ticker of requiredTickers) {
      observedByTicker.set(ticker, []);
    }

    for (const row of data ?? []) {
      const ticker = String(row.ticker ?? "").toUpperCase();
      const date = String(row.date ?? "");
      const researchStart = researchStarts.get(ticker) ?? COVERAGE_WINDOW_START;

      if (date < researchStart || date > researchEnd) continue;

      marketCalendarSet.add(date);
      const bucket = observedByTicker.get(ticker);
      if (bucket) {
        bucket.push(date);
      } else {
        observedByTicker.set(ticker, [date]);
      }
    }

    let marketCalendar = [...marketCalendarSet].sort();
    if (marketCalendar.length === 0) {
      const weekdayCalendar: string[] = [];
      const cursor = new Date(`${minResearchStart}T00:00:00Z`);
      const end = new Date(`${researchEnd}T00:00:00Z`);
      while (cursor <= end) {
        const day = cursor.getUTCDay();
        if (day !== 0 && day !== 6) {
          weekdayCalendar.push(cursor.toISOString().slice(0, 10));
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      marketCalendar = weekdayCalendar;
    }

    const rows = requiredTickers.map((ticker) =>
      summarizeTickerAgainstCalendar({
        ticker,
        researchStart: researchStarts.get(ticker) ?? COVERAGE_WINDOW_START,
        researchEnd,
        marketCalendar,
        observedDates: observedByTicker.get(ticker) ?? [],
      })
    );

    const totalExpected = rows.reduce((sum, row) => sum + row.expectedDays, 0);
    const totalActual = rows.reduce((sum, row) => sum + row.actualDays, 0);
    const totalTrueMissing = rows.reduce((sum, row) => sum + row.trueMissingDays, 0);
    const notIngestedTickers = rows
      .filter((row) => !row.isIngested)
      .map((row) => row.ticker)
      .sort();

    return {
      rows,
      requiredTickers,
      notIngestedTickers,
      ingestedTickers: rows.filter((row) => row.isIngested).length,
      completeness: totalExpected > 0 ? Math.min((totalActual / totalExpected) * 100, 100) : null,
      totalExpected,
      totalActual,
      totalTrueMissing,
      trueMissingRate: totalExpected > 0 ? totalTrueMissing / totalExpected : 0,
      marketCalendarDays: marketCalendar.length,
    };
  } catch (err) {
    console.error("getRequiredTickerResearchSummary exception:", err);
    return empty;
  }
}

export async function getMonitoredBenchmarkCoverage(
  dataCutoffDate: string | null,
  prefetchedRanges?: TickerDateRange[]
): Promise<BenchmarkCoverage[] | null> {
  const researchEnd = dataCutoffDate ?? getLastCompleteTradingDayUtc();
  const ranges = prefetchedRanges ?? (await getAllTickerStats());
  const researchStarts = buildRequiredTickerResearchStarts(ranges);
  const benchmarkStarts = new Map<string, string>();

  for (const ticker of BENCHMARK_OPTIONS) {
    benchmarkStarts.set(ticker, researchStarts.get(ticker) ?? COVERAGE_WINDOW_START);
  }

  const minResearchStart = [...benchmarkStarts.values()].sort()[0] ?? COVERAGE_WINDOW_START;
  const rangeByTicker = new Map<string, TickerDateRange>(
    ranges.map((row) => [row.ticker.toUpperCase(), row])
  );

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("prices")
      .select("ticker, date")
      .in("ticker", [...BENCHMARK_OPTIONS])
      .gte("date", minResearchStart)
      .lte("date", researchEnd)
      .order("date", { ascending: true });

    if (error) {
      console.error("getMonitoredBenchmarkCoverage error:", error.message);
      return null;
    }

    const observedByTicker = new Map<string, string[]>();
    for (const ticker of BENCHMARK_OPTIONS) {
      observedByTicker.set(ticker, []);
    }

    for (const row of data ?? []) {
      const ticker = String(row.ticker ?? "").toUpperCase();
      const date = String(row.date ?? "");
      const bucket = observedByTicker.get(ticker);
      if (!bucket || !date) continue;
      if (bucket.at(-1) !== date) {
        bucket.push(date);
      }
    }

    return BENCHMARK_OPTIONS.map((ticker) => {
      const range = rangeByTicker.get(ticker) ?? null;
      const stats: CoverageStatsSnapshot | undefined = range
        ? {
            firstDate: range.firstDate,
            lastDate: range.lastDate,
          }
        : undefined;
      const benchmarkCoverage = computeBenchmarkCoverage({
        benchmarkTicker: ticker,
        windowStart: benchmarkStarts.get(ticker) ?? COVERAGE_WINDOW_START,
        windowEnd: researchEnd,
        cutoffDate: researchEnd,
        stats,
        benchmarkDates: observedByTicker.get(ticker) ?? [],
      });
      const inceptionDate = TICKER_INCEPTION_DATES[ticker] ?? null;
      const coveragePercent =
        benchmarkCoverage.expectedDays > 0
          ? Math.min((benchmarkCoverage.actualDays / benchmarkCoverage.expectedDays) * 100, 100)
          : 0;
      const status: BenchmarkCoverage["status"] =
        benchmarkCoverage.status === "good"
          ? "ok"
          : benchmarkCoverage.actualDays === 0
            ? "not_ingested"
            : benchmarkCoverage.status === "warning"
              ? "partial"
              : "missing";

      return {
        ticker,
        actualDays: benchmarkCoverage.actualDays,
        expectedDays: benchmarkCoverage.expectedDays,
        missingDays: benchmarkCoverage.missingDays,
        coveragePercent,
        trueMissingRate: benchmarkCoverage.trueMissingRate,
        windowStart: benchmarkCoverage.windowStartUsed,
        windowEnd: benchmarkCoverage.windowEndUsed,
        latestDate: range?.lastDate ?? null,
        earliestDate: range?.firstDate ?? null,
        needsHistoricalBackfill:
          range?.firstDate != null && inceptionDate != null
            ? range.firstDate > inceptionDate
            : false,
        status,
      };
    });
  } catch (err) {
    console.error("getMonitoredBenchmarkCoverage exception:", err);
    return null;
  }
}
