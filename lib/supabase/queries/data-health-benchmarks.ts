import "server-only";

import { BENCHMARK_OPTIONS } from "@/lib/benchmark";
import { createAdminClient } from "../admin";
import { COVERAGE_WINDOW_START, TICKER_INCEPTION_DATES, type BenchmarkCoverage } from "../types";

export async function getBenchmarkCoverage(
  ticker: string,
  dateStart: string | null,
  dateEnd: string | null,
  businessDaysInWindow: number
): Promise<BenchmarkCoverage | null> {
  if (!dateStart || !dateEnd || businessDaysInWindow === 0) return null;

  // Normalize: yfinance stores tickers as uppercase, user input may differ
  const normalizedTicker = ticker.trim().toUpperCase();

  try {
    const supabase = createAdminClient();
    const { count, error } = await supabase
      .from("prices")
      .select("*", { count: "exact", head: true })
      .eq("ticker", normalizedTicker)
      .gte("date", dateStart)
      .lte("date", dateEnd);

    if (error) {
      console.error("getBenchmarkCoverage error:", error.message);
      return null;
    }

    const actualDays = count ?? 0;

    // When 0 rows found: run a diagnostic to detect symbol mismatches or missing ingestion
    let debugSimilarTickers: string[] | undefined;
    let latestDate: string | null = null;
    let earliestDate: string | null = null;
    if (actualDays === 0) {
      const prefix = normalizedTicker.slice(0, 3);
      const { data: similarRows } = await supabase
        .from("prices")
        .select("ticker")
        .ilike("ticker", `%${prefix}%`)
        .limit(30);
      const similar = [...new Set((similarRows ?? []).map((r) => r.ticker as string))].slice(0, 10);
      console.warn(
        `[getBenchmarkCoverage] 0 rows for "${normalizedTicker}" in prices [${dateStart}–${dateEnd}]. ` +
          `Similar tickers found: ${similar.join(", ") || "(none)"}. ` +
          `If empty, "${normalizedTicker}" is not in the prices table — ingest it or check the benchmark setting.`
      );
      if (process.env.NODE_ENV !== "production") {
        debugSimilarTickers = similar;
      }
    } else {
      // Fetch the earliest and latest dates for this ticker (may differ from global window)
      const [latestRow, earliestRow] = await Promise.all([
        supabase
          .from("prices")
          .select("date")
          .eq("ticker", normalizedTicker)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("prices")
          .select("date")
          .eq("ticker", normalizedTicker)
          .order("date", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);
      latestDate = latestRow.data?.date ?? null;
      earliestDate = earliestRow.data?.date ?? null;
    }

    const expectedDays = businessDaysInWindow;
    const missingDays = Math.max(expectedDays - actualDays, 0);
    const coveragePercent = expectedDays > 0 ? Math.min((actualDays / expectedDays) * 100, 100) : 0;

    const status: BenchmarkCoverage["status"] =
      actualDays === 0
        ? "not_ingested"
        : coveragePercent < 50
          ? "missing"
          : coveragePercent < 99
            ? "partial"
            : "ok";

    const needsHistoricalBackfill = earliestDate !== null && earliestDate > COVERAGE_WINDOW_START;

    return {
      ticker: normalizedTicker,
      actualDays,
      expectedDays,
      missingDays,
      coveragePercent,
      latestDate,
      earliestDate,
      needsHistoricalBackfill,
      status,
      debugSimilarTickers,
    };
  } catch (err) {
    console.error("getBenchmarkCoverage exception:", err);
    return null;
  }
}

/**
 * Fetch coverage for all BENCHMARK_OPTIONS using a server-side GROUP BY RPC.
 * Returns null on error so callers can distinguish "query failed" from "not ingested".
 */
export async function getAllBenchmarkCoverage(
  dateStart: string | null,
  dateEnd: string | null,
  businessDaysInWindow: number
): Promise<BenchmarkCoverage[] | null> {
  const tickers = [...BENCHMARK_OPTIONS];
  try {
    const supabase = createAdminClient();

    // Fast path: read coverage_window_days from ticker_stats cache.
    // coverage_window_days = COUNT(*) WHERE date >= '2015-01-02' (COVERAGE_WINDOW_START).
    // This avoids a GROUP BY on prices entirely (migration 20260316).
    // Falls back to the get_benchmark_coverage_agg RPC if the column is missing
    // (pre-migration environment), and then to row-level fetch as a last resort.
    type StatsRow = {
      symbol: string;
      first_date: string;
      last_date: string;
      coverage_window_days: string | number | null;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: statsData, error: statsError } = (await (supabase as any)
      .from("ticker_stats")
      .select("symbol, first_date, last_date, coverage_window_days")
      .in("symbol", tickers)) as { data: StatsRow[] | null; error: { message: string } | null };

    // Fast path is usable when: no error, rows returned, and at least one row
    // has coverage_window_days populated (i.e. migration 20260316 was applied).
    const fastPathOk =
      !statsError &&
      statsData !== null &&
      statsData.length > 0 &&
      statsData.some((r) => r.coverage_window_days !== null);
    const useTickerStatsFastPath = fastPathOk && dateStart === COVERAGE_WINDOW_START;

    let agg: Map<string, { actualDays: number; earliest: string | null; latest: string | null }>;

    if (useTickerStatsFastPath) {
      // Build from ticker_stats — zero prices queries.
      agg = new Map();
      for (const row of statsData!) {
        agg.set(row.symbol, {
          actualDays: Number(row.coverage_window_days ?? 0),
          earliest: row.first_date ?? null,
          latest: row.last_date ?? null,
        });
      }
    } else {
      // Fallback: DB-side GROUP BY RPC (returns 1 row per ticker, not ~25k rows to JS).
      if (statsError) {
        console.warn(
          "getAllBenchmarkCoverage: ticker_stats unavailable, using RPC fallback:",
          statsError.message
        );
      }
      type AggRow = {
        ticker: string;
        actual_days: string | number;
        earliest_date: string | null;
        latest_date: string | null;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rpcData, error: rpcError } = (await (supabase as any).rpc(
        "get_benchmark_coverage_agg",
        {
          p_tickers: tickers,
          p_start: dateStart ?? "1900-01-01",
          p_end: dateEnd ?? "9999-12-31",
        }
      )) as { data: AggRow[] | null; error: { message: string } | null };

      if (rpcError) {
        if (rpcError.message.includes("Could not find the function")) {
          // RPC not deployed yet — fall back to row-level fetch
          const { data: rowData, error: rowError } = await supabase
            .from("prices")
            .select("ticker, date")
            .in("ticker", tickers)
            .gte("date", dateStart ?? "1900-01-01")
            .lte("date", dateEnd ?? "9999-12-31");

          if (rowError) {
            console.error("getAllBenchmarkCoverage fallback error:", rowError.message);
            return null;
          }

          agg = new Map();
          for (const row of rowData ?? []) {
            const t = row.ticker as string;
            const d = row.date as string;
            const existing = agg.get(t);
            if (!existing) {
              agg.set(t, { actualDays: 1, earliest: d, latest: d });
            } else {
              existing.actualDays += 1;
              if (d < (existing.earliest ?? d)) existing.earliest = d;
              if (d > (existing.latest ?? d)) existing.latest = d;
            }
          }
        } else {
          console.error("getAllBenchmarkCoverage RPC error:", rpcError.message);
          return null;
        }
      } else {
        agg = new Map();
        for (const row of rpcData ?? []) {
          agg.set(row.ticker, {
            actualDays: Number(row.actual_days),
            earliest: row.earliest_date,
            latest: row.latest_date,
          });
        }
      }
    }

    return tickers.map((ticker) => {
      const stats = agg.get(ticker);
      const actualDays = stats?.actualDays ?? 0;
      const earliestDate = stats?.earliest ?? null;
      const latestDate = stats?.latest ?? null;
      const expectedDays = businessDaysInWindow;
      const missingDays = Math.max(expectedDays - actualDays, 0);
      const coveragePercent =
        expectedDays > 0 ? Math.min((actualDays / expectedDays) * 100, 100) : 0;
      const status: BenchmarkCoverage["status"] =
        actualDays === 0
          ? "not_ingested"
          : coveragePercent < 50
            ? "missing"
            : coveragePercent < 99
              ? "partial"
              : "ok";
      const inceptionDate = TICKER_INCEPTION_DATES[ticker] ?? null;
      const needsHistoricalBackfill =
        earliestDate !== null && inceptionDate !== null && earliestDate > inceptionDate;
      return {
        ticker,
        actualDays,
        expectedDays,
        missingDays,
        coveragePercent,
        latestDate,
        earliestDate,
        needsHistoricalBackfill,
        status,
      };
    });
  } catch (err) {
    console.error("getAllBenchmarkCoverage exception:", err);
    return null;
  }
}
