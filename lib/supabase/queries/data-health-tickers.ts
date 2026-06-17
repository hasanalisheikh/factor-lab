import "server-only";

import { unstable_cache } from "next/cache";

import { createAdminClient } from "../admin";
import { createClient } from "../server";
import type { TickerDateRange } from "../types";

type TickerStatsRow = {
  symbol: string;
  first_date: string;
  last_date: string;
  distinct_days: string | number;
  max_gap_days_window: string | number | null;
  updated_at: string | null;
};

/**
 * Cross-request cache for ticker_stats using the admin (service-role) client
 * which doesn't require user cookies. TTL: 2 minutes.
 * ticker_stats is global (not user-scoped), so sharing the cache is safe.
 */
const _getCachedTickerStats = unstable_cache(
  async (): Promise<TickerDateRange[]> => {
    const supabase = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = (await (supabase as any)
      .from("ticker_stats")
      .select("symbol, first_date, last_date, distinct_days, max_gap_days_window, updated_at")) as {
      data: TickerStatsRow[] | null;
      error: { message: string } | null;
    };
    if (error || !data || data.length === 0) return [];
    return data.map((r) => ({
      ticker: r.symbol,
      firstDate: r.first_date,
      lastDate: r.last_date,
      actualDays: Number(r.distinct_days),
      maxGapDays: r.max_gap_days_window != null ? Number(r.max_gap_days_window) : undefined,
      updatedAt: r.updated_at ?? undefined,
    }));
  },
  ["ticker-stats"],
  { revalidate: 120, tags: ["ticker-stats"] }
);

export async function getAllTickerStats(): Promise<TickerDateRange[]> {
  try {
    // Try the cross-request cache first (admin client, no cookies).
    // Falls back to the per-request client path if admin key is unavailable.
    const cached = await _getCachedTickerStats();
    if (cached.length > 0) return cached;
  } catch {
    // Admin key missing or cache unavailable — fall through to live query.
  }

  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = (await (supabase as any)
      .from("ticker_stats")
      .select("symbol, first_date, last_date, distinct_days, max_gap_days_window, updated_at")) as {
      data: TickerStatsRow[] | null;
      error: { message: string } | null;
    };
    if (error) {
      if (
        error.message.includes("does not exist") ||
        error.message.includes("relation") ||
        error.message.includes("schema cache")
      ) {
        // Migration not yet applied — fall back to legacy full-table RPC
        return getTickerDateRanges();
      }
      console.error("getAllTickerStats error:", error.message);
      return [];
    }
    // Table exists but hasn't been populated yet (migration applied before worker ran).
    // Fall back to live query so existing prices are still discovered.
    if ((data ?? []).length === 0) {
      return getTickerDateRanges();
    }
    return (data ?? []).map((r) => ({
      ticker: r.symbol,
      firstDate: r.first_date,
      lastDate: r.last_date,
      actualDays: Number(r.distinct_days),
      maxGapDays: r.max_gap_days_window != null ? Number(r.max_gap_days_window) : undefined,
      updatedAt: r.updated_at ?? undefined,
    }));
  } catch (err) {
    console.error("getAllTickerStats exception:", err);
    return [];
  }
}

/**
 * Fetches first_date, last_date, and actual_days per ticker from the DB.
 * Requires migration 20260309_ticker_date_ranges.sql to be applied.
 * Returns an empty array gracefully if the RPC doesn't exist yet.
 * @deprecated Use getAllTickerStats() which reads from the fast ticker_stats cache.
 */
export async function getTickerDateRanges(): Promise<TickerDateRange[]> {
  try {
    const supabase = await createClient();
    type RawRow = {
      ticker: string;
      first_date: string;
      last_date: string;
      actual_days: string | number;
    };
    const { data, error } = (await supabase.rpc("get_ticker_date_ranges")) as unknown as {
      data: RawRow[] | null;
      error: { message: string } | null;
    };
    if (error) {
      if (!error.message.includes("Could not find the function")) {
        console.error("getTickerDateRanges error:", error.message);
      }
      return [];
    }
    return (data ?? []).map((r) => ({
      ticker: r.ticker,
      firstDate: r.first_date,
      lastDate: r.last_date,
      actualDays: Number(r.actual_days),
    }));
  } catch (err) {
    console.error("getTickerDateRanges exception:", err);
    return [];
  }
}

// computeUniverseValidFrom is a pure function defined in lib/universe-config.ts
// and re-exported from there so client components and tests can import it
