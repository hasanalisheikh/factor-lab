import "server-only";

import {
  getDataIngestTriggerLabel,
  isActiveDataIngestStatus,
  isMissingDataIngestExtendedColumnError,
  normalizeDataIngestStatus,
} from "@/lib/data-ingest-jobs";
import { createAdminClient } from "../admin";
import { createClient } from "../server";
import type { DataIngestJobStatus } from "../types";
import type {
  DataIngestJobHistoryEntry,
  IngestionLogEntry,
  ScheduledRefreshActivity,
} from "./shared";

export async function getActiveScheduledRefreshActivity(): Promise<ScheduledRefreshActivity> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("data_ingest_jobs")
      .select("request_mode, status, next_retry_at, batch_id")
      .in("request_mode", ["monthly", "daily"])
      .not("batch_id", "is", null)
      .in("status", ["queued", "running"]);

    if (error) {
      return {
        monthlyActiveJobs: 0,
        dailyActiveJobs: 0,
      };
    }

    let monthlyActiveJobs = 0;
    let dailyActiveJobs = 0;

    for (const row of (data ?? []) as Array<{
      request_mode?: string | null;
      status?: string | null;
      next_retry_at?: string | null;
    }>) {
      if (!isActiveDataIngestStatus(row.status, row.next_retry_at ?? null)) continue;
      if (row.request_mode === "monthly") monthlyActiveJobs += 1;
      if (row.request_mode === "daily") dailyActiveJobs += 1;
    }

    return { monthlyActiveJobs, dailyActiveJobs };
  } catch {
    return {
      monthlyActiveJobs: 0,
      dailyActiveJobs: 0,
    };
  }
}

/**
 * Returns the number of scheduled-refresh data_ingest_jobs currently queued,
 * running, or retrying. Manual/preflight jobs are excluded so the banner only
 * reflects cutoff-advancing refresh batches.
 * Returns 0 on error (non-fatal).
 */
export async function getActiveIngestJobCount(): Promise<number> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error } = await (supabase as any)
      .from("data_ingest_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "running", "retrying"])
      .not("batch_id", "is", null);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function getRecentDataIngestJobHistory(
  limit = 15
): Promise<DataIngestJobHistoryEntry[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let { data, error } = await (supabase as any)
      .from("data_ingest_jobs")
      .select(
        "id, symbol, status, stage, request_mode, requested_by, created_at, started_at, finished_at, next_retry_at, attempt_count, rows_inserted, target_cutoff_date, error"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error && isMissingDataIngestExtendedColumnError(error.message)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const legacyFallback = await (supabase as any)
        .from("data_ingest_jobs")
        .select(
          "id, symbol, status, stage, created_at, started_at, finished_at, next_retry_at, attempt_count, target_cutoff_date, error"
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      data = legacyFallback.data;
      error = legacyFallback.error;
    }

    if (error) {
      console.warn("getRecentDataIngestJobHistory:", error.message);
      return [];
    }

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      symbol: String(row.symbol ?? ""),
      status: normalizeDataIngestStatus(String(row.status ?? "queued")),
      stage: typeof row.stage === "string" ? row.stage : null,
      requestMode: typeof row.request_mode === "string" ? row.request_mode : null,
      requestedBy: typeof row.requested_by === "string" ? row.requested_by : null,
      triggerLabel: getDataIngestTriggerLabel(
        typeof row.request_mode === "string" ? row.request_mode : null,
        typeof row.requested_by === "string" ? row.requested_by : null
      ),
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
      startedAt: typeof row.started_at === "string" ? row.started_at : null,
      finishedAt: typeof row.finished_at === "string" ? row.finished_at : null,
      nextRetryAt: typeof row.next_retry_at === "string" ? row.next_retry_at : null,
      attemptCount:
        typeof row.attempt_count === "number" ? row.attempt_count : Number(row.attempt_count ?? 0),
      rowsInserted:
        typeof row.rows_inserted === "number" ? row.rows_inserted : Number(row.rows_inserted ?? 0),
      targetCutoffDate: typeof row.target_cutoff_date === "string" ? row.target_cutoff_date : null,
      error: typeof row.error === "string" ? row.error : null,
    }));
  } catch (err) {
    console.error("getRecentDataIngestJobHistory exception:", err);
    return [];
  }
}

export async function getLatestDataIngestJob(ticker: string): Promise<DataIngestJobStatus | null> {
  const normalizedTicker = ticker.trim().toUpperCase();
  try {
    const supabase = createAdminClient();
    // Fetch the 20 most-recent data_ingest jobs and filter by ticker client-side
    // (JSONB @> filtering may not be available in all environments)
    const { data, error } = await supabase
      .from("jobs")
      .select(
        "id, status, stage, progress, error_message, created_at, started_at, updated_at, next_retry_at, attempt_count, payload, job_type"
      )
      .eq("job_type", "data_ingest")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      // Column likely doesn't exist yet — migration not applied, silently skip
      if (error.message.includes("job_type") || error.message.includes("does not exist"))
        return null;
      console.error("getLatestDataIngestJob error:", error.message);
      return null;
    }

    const match = (data ?? []).find((j) => {
      const p = j.payload as { ticker?: string } | null;
      return p?.ticker?.toUpperCase() === normalizedTicker;
    });
    if (!match) return null;

    return {
      id: match.id,
      status: match.status,
      stage: match.stage,
      progress: match.progress,
      error_message: match.error_message,
      created_at: match.created_at ?? null,
      started_at: match.started_at ?? null,
      updated_at: match.updated_at ?? null,
      next_retry_at: match.next_retry_at ?? null,
      attempt_count: match.attempt_count ?? null,
    };
  } catch (err) {
    console.error("getLatestDataIngestJob exception:", err);
    return null;
  }
}

/**
 * Fetch the latest data_ingest_job for each ticker using the DB-side RPC
 * `get_latest_data_ingest_jobs`. Falls back to a direct table scan if the
 * RPC is not yet deployed. Never limited to 50 rows — uses DISTINCT ON per symbol.
 */
export async function getLatestDataIngestJobs(
  tickers: readonly string[]
): Promise<Record<string, DataIngestJobStatus | null>> {
  const normalized = tickers.map((t) => t.toUpperCase());
  const result: Record<string, DataIngestJobStatus | null> = {};
  for (const t of normalized) result[t] = null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;

    // Try RPC first (returns 1 row per symbol, no LIMIT needed)
    const { data: rpcData, error: rpcError } = await supabase.rpc("get_latest_data_ingest_jobs", {
      p_symbols: normalized,
    });

    if (!rpcError && Array.isArray(rpcData)) {
      for (const j of rpcData) {
        const t = String(j.symbol ?? "").toUpperCase();
        if (!normalized.includes(t)) continue;
        result[t] = {
          id: j.id,
          status: normalizeDataIngestStatus(j.status),
          stage: j.stage ?? null,
          progress: j.progress ?? 0,
          symbol: j.symbol ?? null,
          start_date: j.start_date ?? null,
          end_date: j.end_date ?? null,
          request_mode: j.request_mode ?? null,
          batch_id: j.batch_id ?? null,
          target_cutoff_date: j.target_cutoff_date ?? null,
          requested_by: j.requested_by ?? null,
          error: j.error ?? null,
          error_message: j.error ?? null,
          created_at: j.created_at ?? null,
          started_at: j.started_at ?? null,
          updated_at: j.updated_at ?? null,
          finished_at: j.finished_at ?? null,
          last_heartbeat_at: j.last_heartbeat_at ?? null,
          rows_inserted: j.rows_inserted ?? null,
          next_retry_at: j.next_retry_at ?? null,
          attempt_count: j.attempt_count ?? null,
        };
      }
      return result;
    }

    // Fallback: direct scan of data_ingest_jobs (all rows per symbol, pick latest in JS)
    let { data, error } = await supabase
      .from("data_ingest_jobs")
      .select(
        "id, symbol, status, stage, progress, error, created_at, started_at, updated_at, finished_at, next_retry_at, attempt_count, start_date, end_date, request_mode, batch_id, target_cutoff_date, requested_by, last_heartbeat_at, rows_inserted"
      )
      .in("symbol", normalized)
      .order("created_at", { ascending: false });

    if (error && isMissingDataIngestExtendedColumnError(error.message)) {
      const legacyFallback = await supabase
        .from("data_ingest_jobs")
        .select(
          "id, symbol, status, stage, progress, error, created_at, started_at, updated_at, next_retry_at, attempt_count, start_date, end_date"
        )
        .in("symbol", normalized)
        .order("created_at", { ascending: false });
      data = legacyFallback.data;
      error = legacyFallback.error;
    }

    if (error) {
      console.error("getLatestDataIngestJobs fallback error:", error.message);
      return result;
    }

    for (const j of data ?? []) {
      const t = String(j.symbol ?? "").toUpperCase();
      if (!normalized.includes(t)) continue;
      if (result[t] !== null) continue; // already have a newer row
      result[t] = {
        id: j.id,
        status: normalizeDataIngestStatus(j.status),
        stage: j.stage ?? null,
        progress: j.progress ?? 0,
        symbol: j.symbol ?? null,
        start_date: j.start_date ?? null,
        end_date: j.end_date ?? null,
        request_mode: j.request_mode ?? null,
        batch_id: j.batch_id ?? null,
        target_cutoff_date: j.target_cutoff_date ?? null,
        requested_by: j.requested_by ?? null,
        error: j.error ?? null,
        error_message: j.error ?? null,
        created_at: j.created_at ?? null,
        started_at: j.started_at ?? null,
        updated_at: j.updated_at ?? null,
        finished_at: j.finished_at ?? null,
        last_heartbeat_at: j.last_heartbeat_at ?? null,
        rows_inserted: j.rows_inserted ?? null,
        next_retry_at: j.next_retry_at ?? null,
        attempt_count: j.attempt_count ?? null,
      };
    }
  } catch (err) {
    console.error("getLatestDataIngestJobs exception:", err);
  }

  return result;
}

export async function getRecentIngestionHistory(limit = 5): Promise<IngestionLogEntry[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("data_ingestion_log")
      .select("id, ingested_at, status, tickers_updated, rows_upserted, note, source")
      .order("ingested_at", { ascending: false })
      .limit(limit);

    if (error) {
      // Table may not exist yet if migration hasn't been applied
      console.warn("getRecentIngestionHistory:", error.message);
      return [];
    }

    return (data ?? []) as IngestionLogEntry[];
  } catch (err) {
    console.error("getRecentIngestionHistory exception:", err);
    return [];
  }
}
