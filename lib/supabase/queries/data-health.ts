import "server-only";

import {
  DATA_STATE_SINGLETON_ID,
  getLastCompleteTradingDayUtc,
  getNextMonthStartUtc,
  isDailyUpdatesEnabled,
} from "@/lib/data-cutoff";
import {
  summarizeUniverseConstraints,
  UNIVERSE_PRESETS,
  type UniverseId,
} from "@/lib/universe-config";
import { createAdminClient } from "../admin";
import { createClient } from "../server";
import type {
  DataStateRow,
  TickerDateRange,
  TickerMissingness,
  TickerMissingnessV2,
} from "../types";
import { getAllTickerStats } from "./data-health-tickers";
import {
  countBusinessDays,
  type DataHealthSummary,
  type DataStateSummary,
  type UniverseConstraintsSnapshot,
} from "./shared";

export type DataCoverage = {
  minDate: string | null;
  maxDate: string | null;
  lastUpdatedAt?: string | null;
};

export async function getDataState(): Promise<DataStateSummary> {
  try {
    const supabase = await createClient();
    const { data, error } = (await supabase
      .from("data_state")
      .select("data_cutoff_date, last_update_at, update_mode, updated_by, last_noop_check_at")
      .eq("id", DATA_STATE_SINGLETON_ID)
      .maybeSingle()) as {
      data: Pick<
        DataStateRow,
        "data_cutoff_date" | "last_update_at" | "update_mode" | "updated_by" | "last_noop_check_at"
      > | null;
      error: { message: string } | null;
    };

    if (!error && data) {
      return {
        dataCutoffDate: data.data_cutoff_date,
        lastUpdateAt: data.last_update_at,
        updateMode: data.update_mode,
        updatedBy: data.updated_by,
        nextMonthlyRefresh: getNextMonthStartUtc(),
        dailyUpdatesEnabled: isDailyUpdatesEnabled(),
        lastNoopCheckAt: data.last_noop_check_at ?? null,
      };
    }

    const safeCutoff = getLastCompleteTradingDayUtc();
    const { data: maxRow } = await supabase
      .from("prices")
      .select("date")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const fallbackMaxDate = (maxRow as { date?: string } | null)?.date ?? null;
    const fallbackCutoff =
      fallbackMaxDate && fallbackMaxDate < safeCutoff ? fallbackMaxDate : safeCutoff;

    return {
      dataCutoffDate: fallbackCutoff,
      lastUpdateAt: null,
      updateMode: null,
      updatedBy: null,
      nextMonthlyRefresh: getNextMonthStartUtc(),
      dailyUpdatesEnabled: isDailyUpdatesEnabled(),
      lastNoopCheckAt: null,
    };
  } catch {
    return {
      dataCutoffDate: getLastCompleteTradingDayUtc(),
      lastUpdateAt: null,
      updateMode: null,
      updatedBy: null,
      nextMonthlyRefresh: getNextMonthStartUtc(),
      dailyUpdatesEnabled: isDailyUpdatesEnabled(),
      lastNoopCheckAt: null,
    };
  }
}

export async function getDataCoverage(): Promise<DataCoverage> {
  try {
    const supabase = await createClient();
    const [dataState, firstStatsRes] = await Promise.all([
      getDataState(),
      supabase
        .from("ticker_stats")
        .select("first_date")
        .order("first_date", { ascending: true })
        .limit(1) as unknown as Promise<{
        data: Array<{ first_date: string }> | null;
        error: { message: string } | null;
      }>,
    ]);

    let minDate = firstStatsRes.data?.[0]?.first_date ?? null;
    if (!minDate && dataState.dataCutoffDate) {
      const { data: minRow } = await supabase
        .from("prices")
        .select("date")
        .lte("date", dataState.dataCutoffDate)
        .order("date", { ascending: true })
        .limit(1)
        .maybeSingle();
      minDate = (minRow as { date?: string } | null)?.date ?? null;
    }

    return {
      minDate,
      maxDate: dataState.dataCutoffDate,
      lastUpdatedAt: dataState.lastUpdateAt,
    };
  } catch {
    return { minDate: null, maxDate: null, lastUpdatedAt: null };
  }
}

export async function getDataHealthSummary(
  prefetchedRanges?: TickerDateRange[],
  prefetchedDataState?: DataStateSummary
): Promise<DataHealthSummary> {
  const empty: DataHealthSummary = {
    tickersCount: 0,
    dateStart: null,
    dateEnd: null,
    businessDaysInWindow: 0,
    expectedTickerDays: 0,
    actualTickerDays: 0,
    missingTickerDays: 0,
    completenessPercent: null,
    lastUpdatedAt: null,
  };

  try {
    const supabase = await createClient();

    let tickersCount = 0;
    let dateStart: string | null = null;
    let actualTickerDays = 0;

    // If caller provides cached ranges, compute directly without a DB round-trip.
    if (prefetchedRanges && prefetchedRanges.length > 0) {
      tickersCount = prefetchedRanges.length;
      dateStart = prefetchedRanges.reduce<string | null>(
        (min, r) => (!min || r.firstDate < min ? r.firstDate : min),
        null
      );
      actualTickerDays = prefetchedRanges.reduce((sum, r) => sum + (r.actualDays ?? 0), 0);
    }

    const dataState = prefetchedDataState ?? (await getDataState());
    const dateEnd = dataState.dataCutoffDate;

    if (tickersCount === 0) {
      type StatsRow = {
        symbol: string;
        first_date: string;
        distinct_days: string | number;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statsRes = (await (supabase as any)
        .from("ticker_stats")
        .select("symbol, first_date, distinct_days")) as {
        data: StatsRow[] | null;
        error: { message: string } | null;
      };

      if (!statsRes.error && statsRes.data) {
        tickersCount = statsRes.data.length;
        dateStart = statsRes.data.reduce<string | null>(
          (min, row) => (!min || row.first_date < min ? row.first_date : min),
          null
        );
        actualTickerDays = statsRes.data.reduce(
          (sum, row) => sum + Number(row.distinct_days ?? 0),
          0
        );
      } else if (dateEnd) {
        type AggRow = {
          ticker_count: number;
          min_date: string | null;
          max_date: string | null;
          actual_rows: number;
        };
        const { data: aggData } = (await supabase.rpc("get_data_health_agg")) as unknown as {
          data: AggRow | null;
          error: { message: string } | null;
        };
        tickersCount = aggData?.ticker_count ?? 0;
        dateStart = aggData?.min_date ?? null;
        actualTickerDays = aggData?.actual_rows ?? 0;
      }
    }

    let businessDaysInWindow = 0;
    let expectedTickerDays = 0;
    let missingTickerDays = 0;
    let completenessPercent: number | null = null;

    if (tickersCount > 0 && dateStart && dateEnd) {
      businessDaysInWindow = countBusinessDays(dateStart, dateEnd);
      expectedTickerDays = businessDaysInWindow * tickersCount;
      missingTickerDays = Math.max(expectedTickerDays - actualTickerDays, 0);
      completenessPercent =
        expectedTickerDays > 0
          ? Math.min((actualTickerDays / expectedTickerDays) * 100, 100)
          : null;
    }

    return {
      tickersCount,
      dateStart,
      dateEnd,
      businessDaysInWindow,
      expectedTickerDays,
      actualTickerDays,
      missingTickerDays,
      completenessPercent,
      lastUpdatedAt: dataState.lastUpdateAt,
    };
  } catch (err) {
    console.error("getDataHealthSummary exception:", err);
    return empty;
  }
}

export async function getTopMissingTickers(
  limit: number,
  businessDaysInWindow: number
): Promise<TickerMissingness[]> {
  if (businessDaysInWindow === 0) return [];

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("get_ticker_day_counts");

    if (error) {
      // Silently skip if the RPC function doesn't exist yet (migration pending)
      if (!error.message.includes("Could not find the function")) {
        console.error("getTopMissingTickers error:", error.message);
      }
      return [];
    }

    const rows = (data ?? []) as { ticker: string; actual_days: number }[];
    return rows
      .map(({ ticker, actual_days }) => {
        const actualDays = Number(actual_days);
        const missingDays = Math.max(businessDaysInWindow - actualDays, 0);
        const coveragePercent = Math.min((actualDays / businessDaysInWindow) * 100, 100);
        return { ticker, actualDays, missingDays, coveragePercent };
      })
      .filter((r) => r.missingDays > 0)
      .sort((a, b) => b.missingDays - a.missingDays)
      .slice(0, limit);
  } catch (err) {
    console.error("getTopMissingTickers exception:", err);
    return [];
  }
}

export async function getUniverseConstraintsSnapshot(
  universe: UniverseId,
  prefetchedRanges?: TickerDateRange[]
): Promise<UniverseConstraintsSnapshot> {
  const [ranges, dataState] = await Promise.all([
    prefetchedRanges ? Promise.resolve(prefetchedRanges) : getAllTickerStats(),
    getDataState(),
  ]);

  const summary = summarizeUniverseConstraints(universe, ranges);
  return {
    universe,
    universeEarliestStart: summary.earliestStart,
    universeValidFrom: summary.validFrom,
    missingTickers: summary.missingTickers,
    ingestedCount: summary.ingestedCount,
    totalCount: summary.totalCount,
    ready: summary.ready,
    dataCutoffDate: dataState.dataCutoffDate,
  };
}

/**
 * Returns inception-aware missingness for each ticker that has data.
 * "True missing" = gaps within the ticker's own [firstDate, lastDate] window.
 * "Pre-inception" = business days in [globalStart, firstDate) — not an error.
 * Pass prefetchedRanges to avoid an extra DB round-trip when caller already has stats.
 */
export async function getTopMissingTickersV2(
  limit: number,
  globalStart: string | null,
  globalEnd: string | null,
  prefetchedRanges?: TickerDateRange[]
): Promise<TickerMissingnessV2[]> {
  const ranges = prefetchedRanges ?? (await getAllTickerStats());
  if (!ranges.length) return [];

  const effectiveGlobalStart =
    globalStart ??
    ranges.reduce(
      (min, r) => (!min || r.firstDate < min ? r.firstDate : min),
      null as string | null
    ) ??
    "";

  const rows: TickerMissingnessV2[] = ranges.map((r) => {
    const expectedDays = countBusinessDays(r.firstDate, r.lastDate);
    const trueMissingDays = Math.max(expectedDays - r.actualDays, 0);
    // Business days from globalStart up to (but not including) firstDate
    const dayBeforeFirst = (() => {
      const d = new Date(`${r.firstDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const preInceptionDays =
      effectiveGlobalStart < r.firstDate
        ? countBusinessDays(effectiveGlobalStart, dayBeforeFirst)
        : 0;
    const coveragePercent =
      expectedDays > 0 ? Math.min((r.actualDays / expectedDays) * 100, 100) : 100;

    return {
      ticker: r.ticker,
      firstDate: r.firstDate,
      lastDate: r.lastDate,
      actualDays: r.actualDays,
      expectedDays,
      trueMissingDays,
      preInceptionDays,
      coveragePercent,
    };
  });

  // Filter to window if globalEnd provided
  const filtered = globalEnd ? rows.filter((r) => r.firstDate <= globalEnd) : rows;

  return filtered
    .filter((r) => r.trueMissingDays > 0)
    .sort((a, b) => b.trueMissingDays - a.trueMissingDays)
    .slice(0, limit);
}

/**
 * Returns tickers from all universe presets that have zero rows in the prices table.
 * Pass prefetchedRanges to avoid an extra DB round-trip when caller already has stats.
 */
export async function getNotIngestedUniverseTickers(
  prefetchedRanges?: TickerDateRange[]
): Promise<string[]> {
  const ranges = prefetchedRanges ?? (await getAllTickerStats());
  const ingested = new Set(ranges.map((r) => r.ticker));
  const allTickers = new Set<string>();
  for (const tickers of Object.values(UNIVERSE_PRESETS)) {
    for (const t of tickers) allTickers.add(t);
  }
  return [...allTickers].filter((t) => !ingested.has(t)).sort();
}
