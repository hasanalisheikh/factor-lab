import "server-only";

import { getLastCompleteTradingDayUtc } from "@/lib/data-cutoff";
import { UNIVERSE_PRESETS } from "@/lib/universe-config";
import { createAdminClient } from "../admin";
import { TICKER_INCEPTION_DATES, type BenchmarkCoverage, type TickerDateRange } from "../types";
import { getDataState } from "./data-health";

export async function autoQueueBenchmarkIngestions(
  coverages: BenchmarkCoverage[],
  tickerStats?: TickerDateRange[]
): Promise<void> {
  try {
    const dataState = await getDataState();
    const cutoffDate = dataState.dataCutoffDate ?? getLastCompleteTradingDayUtc();

    // Build a map of ticker → lastDate from ticker_stats for staleness check
    const lastDateMap = new Map<string, string>();
    for (const r of tickerStats ?? []) {
      if (r.lastDate) lastDateMap.set(r.ticker.toUpperCase(), r.lastDate);
    }

    // Determine which tickers need action (including staleness)
    const needsAction = coverages.filter((c) => {
      if (c.status === "not_ingested") return true;
      if (c.needsHistoricalBackfill) return true;
      const lastDate = lastDateMap.get(c.ticker.toUpperCase()) ?? c.latestDate;
      if (lastDate && lastDate < cutoffDate) return true;
      return false;
    });
    if (needsAction.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Fetch active jobs from data_ingest_jobs to avoid duplicates
    const { data: activeJobs } = await admin
      .from("data_ingest_jobs")
      .select("symbol, status, start_date, end_date, id")
      .in(
        "symbol",
        needsAction.map((c) => c.ticker)
      )
      .in("status", ["queued", "running", "retrying"]);

    const activeBySymbol = new Map<
      string,
      { id: string; status: string; start_date: string; end_date: string }
    >();
    for (const j of activeJobs ?? []) {
      if (!activeBySymbol.has(j.symbol)) activeBySymbol.set(j.symbol, j);
    }

    const toInsert: {
      symbol: string;
      start_date: string;
      end_date: string;
      status: string;
      stage: string;
      progress: number;
      request_mode: string;
      target_cutoff_date: string;
      requested_by: string;
    }[] = [];
    const toWiden: { id: string; start_date: string; end_date: string }[] = [];

    for (const c of needsAction) {
      const inceptionDate = TICKER_INCEPTION_DATES[c.ticker] ?? "1993-01-01";
      const lastDate = lastDateMap.get(c.ticker.toUpperCase()) ?? c.latestDate;
      const existing = activeBySymbol.get(c.ticker);

      // Determine desired start date
      let desiredStart: string;
      if (c.status === "not_ingested" || c.needsHistoricalBackfill) {
        desiredStart = inceptionDate;
      } else {
        // Incremental only
        if (!lastDate) {
          desiredStart = inceptionDate;
        } else {
          const next = new Date(lastDate);
          next.setDate(next.getDate() + 1);
          desiredStart = next.toISOString().slice(0, 10);
          if (desiredStart > cutoffDate) continue; // Already current through the cutoff
        }
      }

      if (existing) {
        if (existing.status === "queued") {
          // Widen range if needed
          const newStart = desiredStart < existing.start_date ? desiredStart : existing.start_date;
          const newEnd = cutoffDate > existing.end_date ? cutoffDate : existing.end_date;
          if (newStart !== existing.start_date || newEnd !== existing.end_date) {
            toWiden.push({ id: existing.id, start_date: newStart, end_date: newEnd });
          }
        }
        // running — leave it alone
        continue;
      }

      toInsert.push({
        symbol: c.ticker,
        start_date: desiredStart,
        end_date: cutoffDate,
        status: "queued",
        stage: "download",
        progress: 0,
        request_mode: "manual",
        target_cutoff_date: cutoffDate,
        requested_by: "auto-queue:benchmark",
      });
    }

    if (toInsert.length > 0) {
      await admin.from("data_ingest_jobs").insert(toInsert);
      console.log(
        `[auto-ingest] queued ${toInsert.length} benchmark job(s):`,
        toInsert.map((j) => j.symbol).join(", ")
      );
    }
    for (const w of toWiden) {
      await admin
        .from("data_ingest_jobs")
        .update({ start_date: w.start_date, end_date: w.end_date })
        .eq("id", w.id);
    }
    if (toWiden.length > 0) {
      console.log(`[auto-ingest] widened ${toWiden.length} queued job(s)`);
    }
  } catch (err) {
    // Non-fatal — page still renders; user can trigger manually
    console.error("[auto-ingest] autoQueueBenchmarkIngestions error:", err);
  }
}

// ---------------------------------------------------------------------------
// Auto-queue universe ticker ingestions
// ---------------------------------------------------------------------------

/**
 * Idempotently queues data_ingest_jobs for all universe preset tickers that are
 * not yet ingested or are behind the current data cutoff. Deprecated for
 * page-load use; duplicates are widened or skipped, not created.
 */
export async function autoQueueUniverseIngestions(
  tickerRanges: TickerDateRange[]
): Promise<{ queued: string[]; widened: string[]; skipped: string[] }> {
  const result = { queued: [] as string[], widened: [] as string[], skipped: [] as string[] };
  try {
    const dataState = await getDataState();
    const cutoffDate = dataState.dataCutoffDate ?? getLastCompleteTradingDayUtc();

    // All unique tickers from every universe preset
    const allUniverseTickers = [...new Set(Object.values(UNIVERSE_PRESETS).flat())];

    // Build map from existing ticker stats
    const statsMap = new Map<string, TickerDateRange>();
    for (const r of tickerRanges) {
      statsMap.set(r.ticker.toUpperCase(), r);
    }

    // Determine which tickers need action
    const needsAction: { ticker: string; needsFullIngest: boolean; desiredStart: string }[] = [];
    for (const ticker of allUniverseTickers) {
      const stats = statsMap.get(ticker.toUpperCase());
      const inceptionDate = TICKER_INCEPTION_DATES[ticker] ?? "2003-01-01";

      if (!stats || stats.actualDays === 0) {
        needsAction.push({ ticker, needsFullIngest: true, desiredStart: inceptionDate });
      } else if (stats.lastDate && stats.lastDate < cutoffDate) {
        const next = new Date(stats.lastDate);
        next.setDate(next.getDate() + 1);
        const nextStr = next.toISOString().slice(0, 10);
        if (nextStr <= cutoffDate) {
          needsAction.push({ ticker, needsFullIngest: false, desiredStart: nextStr });
        } else {
          result.skipped.push(ticker);
        }
      } else {
        result.skipped.push(ticker);
      }
    }

    if (needsAction.length === 0) return result;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Fetch active (queued/running) jobs to avoid duplicates
    const { data: activeJobs } = await admin
      .from("data_ingest_jobs")
      .select("symbol, status, start_date, end_date, id")
      .in(
        "symbol",
        needsAction.map((n) => n.ticker)
      )
      .in("status", ["queued", "running", "retrying"]);

    const activeBySymbol = new Map<
      string,
      { id: string; status: string; start_date: string; end_date: string }
    >();
    for (const j of activeJobs ?? []) {
      if (!activeBySymbol.has(j.symbol)) activeBySymbol.set(j.symbol, j);
    }

    const toInsert: {
      symbol: string;
      start_date: string;
      end_date: string;
      status: string;
      stage: string;
      progress: number;
      request_mode: string;
      target_cutoff_date: string;
      requested_by: string;
    }[] = [];

    for (const { ticker, desiredStart } of needsAction) {
      const existing = activeBySymbol.get(ticker);
      if (existing) {
        if (existing.status === "queued") {
          const newStart = desiredStart < existing.start_date ? desiredStart : existing.start_date;
          const newEnd = cutoffDate > existing.end_date ? cutoffDate : existing.end_date;
          if (newStart !== existing.start_date || newEnd !== existing.end_date) {
            await admin
              .from("data_ingest_jobs")
              .update({ start_date: newStart, end_date: newEnd })
              .eq("id", existing.id);
            result.widened.push(ticker);
          } else {
            result.skipped.push(ticker);
          }
        } else {
          // running — leave alone
          result.skipped.push(ticker);
        }
        continue;
      }

      toInsert.push({
        symbol: ticker,
        start_date: desiredStart,
        end_date: cutoffDate,
        status: "queued",
        stage: "download",
        progress: 0,
        request_mode: "manual",
        target_cutoff_date: cutoffDate,
        requested_by: "auto-queue:universe",
      });
    }

    if (toInsert.length > 0) {
      await admin.from("data_ingest_jobs").insert(toInsert);
      result.queued.push(...toInsert.map((j) => j.symbol));
      console.log(
        `[auto-ingest] queued ${toInsert.length} universe job(s):`,
        result.queued.join(", ")
      );
    }
  } catch (err) {
    // Non-fatal — page still renders
    console.error("[auto-ingest] autoQueueUniverseIngestions error:", err);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Backtest window verification
// ---------------------------------------------------------------------------
