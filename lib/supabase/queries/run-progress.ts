import "server-only";

import { isActiveDataIngestStatus, normalizeDataIngestStatus } from "@/lib/data-ingest-jobs";
import { createClient } from "../server";
import { getEffectiveIngestProgress, type UniverseBatchStatusSummary } from "./shared";

export function classifyUniverseBatchStatus(
  rows: Array<{
    status: string;
    progress: number | null;
    next_retry_at: string | null;
  }>
): Pick<UniverseBatchStatusSummary, "status" | "completedJobs" | "avgProgress"> {
  const totalJobs = rows.length;
  const completedJobs = rows.filter(
    (row) => normalizeDataIngestStatus(row.status) === "succeeded"
  ).length;
  const avgProgress =
    totalJobs === 0
      ? 0
      : Math.round(
          rows.reduce((sum, row) => sum + getEffectiveIngestProgress(row.status, row.progress), 0) /
            totalJobs
        );

  const hasRunning = rows.some((row) => normalizeDataIngestStatus(row.status) === "running");
  const hasActive = rows.some((row) => isActiveDataIngestStatus(row.status, row.next_retry_at));
  const hasTerminalFailure = rows.some((row) => {
    const normalized = normalizeDataIngestStatus(row.status);
    return normalized === "blocked" || (normalized === "failed" && !row.next_retry_at);
  });

  return {
    status: hasActive
      ? hasRunning
        ? "running"
        : "pending"
      : hasTerminalFailure
        ? "blocked"
        : "succeeded",
    completedJobs,
    avgProgress,
  };
}

export type IngestProgress = {
  /** Total data_ingest_jobs linked to this run via requested_by_run_id. */
  totalJobs: number;
  /** Jobs with status = 'succeeded'. */
  completedJobs: number;
  /**
   * Weighted average of progress (0–100) across all ingest jobs.
   * Succeeded jobs contribute 100. Used for the aggregated progress bar.
   */
  avgProgress: number;
  /**
   * Earliest started_at across all ingest jobs, for ETA computation.
   * Null until at least one job has started.
   */
  minStartedAt: string | null;
  /** Per-symbol detail for tooltip / diagnostics. */
  symbols: Array<{ symbol: string; status: string; progress: number }>;
};

/**
 * Returns aggregated ingest progress for a waiting_for_data run.
 * Queries data_ingest_jobs WHERE requested_by_run_id = runId.
 * Returns null if there are no ingest jobs (e.g. run was already READY).
 */
export async function getIngestProgressForRun(runId: string): Promise<IngestProgress | null> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("data_ingest_jobs")
    .select("symbol, status, progress, started_at")
    .eq("requested_by_run_id", runId);

  if (error) {
    console.error("[getIngestProgressForRun] query error:", error.message);
    return null;
  }
  if (!data || data.length === 0) return null;

  type Row = { symbol: string; status: string; progress: number; started_at: string | null };
  const rows = data as Row[];
  const totalJobs = rows.length;
  const completedJobs = rows.filter(
    (r) => normalizeDataIngestStatus(r.status) === "succeeded"
  ).length;

  // Succeeded jobs contribute 100 to the average even if they stored 100 already.
  const totalProgress = rows.reduce(
    (sum, r) => sum + getEffectiveIngestProgress(r.status, r.progress),
    0
  );
  const avgProgress = Math.round(totalProgress / totalJobs);

  const startedAts = rows.map((r) => r.started_at).filter(Boolean) as string[];
  const minStartedAt = startedAts.length > 0 ? startedAts.reduce((a, b) => (a < b ? a : b)) : null;

  return {
    totalJobs,
    completedJobs,
    avgProgress,
    minStartedAt,
    symbols: rows.map((r) => ({ symbol: r.symbol, status: r.status, progress: r.progress ?? 0 })),
  };
}

export async function getUniverseBatchStatus(
  batchId: string
): Promise<UniverseBatchStatusSummary | null> {
  if (!batchId) return null;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("data_ingest_jobs")
    .select("symbol, status, progress, next_retry_at")
    .eq("batch_id", batchId);

  if (error) {
    console.error("[getUniverseBatchStatus] query error:", error.message);
    return null;
  }

  type Row = {
    symbol: string;
    status: string;
    progress: number | null;
    next_retry_at: string | null;
  };

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return null;

  const totalJobs = rows.length;
  const { status, completedJobs, avgProgress } = classifyUniverseBatchStatus(rows);

  return {
    batchId,
    status,
    totalJobs,
    completedJobs,
    avgProgress,
    symbols: rows.map((row) => ({
      symbol: row.symbol,
      status: normalizeDataIngestStatus(row.status),
      progress: row.progress ?? 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// Active-runs progress: lightweight batch query for the runs list
// ---------------------------------------------------------------------------

export type RunProgressMap = Map<string, number>; // runId → progress 0-100

/**
 * Returns a progress percentage (0-100) for each provided run ID that is
 * currently active (running or waiting_for_data).
 *
 * For 'running' runs: uses the latest backtest job's progress from the jobs table.
 * For 'waiting_for_data' runs: uses averaged ingest progress from data_ingest_jobs.
 *
 * Designed for the runs list page — one call instead of N per-run queries.
 */
export async function getActiveRunsProgress(runIds: string[]): Promise<RunProgressMap> {
  if (runIds.length === 0) return new Map();
  const supabase = await createClient();

  const [jobsResult, ingestResult] = await Promise.all([
    // Backtest jobs: latest job per run_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("jobs")
      .select("run_id, progress")
      .in("run_id", runIds)
      .in("status", ["running", "queued"])
      .order("created_at", { ascending: false }),
    // Ingest jobs: all linked jobs so we can average per run
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("data_ingest_jobs")
      .select("requested_by_run_id, status, progress")
      .in("requested_by_run_id", runIds),
  ]);

  const result: RunProgressMap = new Map();

  // Build backtest progress map (first row per run_id = latest job)
  const seenBacktest = new Set<string>();
  for (const row of (jobsResult.data ?? []) as Array<{ run_id: string; progress: number }>) {
    if (!seenBacktest.has(row.run_id)) {
      seenBacktest.add(row.run_id);
      result.set(row.run_id, row.progress ?? 0);
    }
  }

  // Build ingest progress map (avg per requested_by_run_id)
  const ingestByRun = new Map<string, number[]>();
  for (const row of (ingestResult.data ?? []) as Array<{
    requested_by_run_id: string;
    status: string;
    progress: number;
  }>) {
    const rid = row.requested_by_run_id;
    if (!rid) continue;
    if (!ingestByRun.has(rid)) ingestByRun.set(rid, []);
    ingestByRun.get(rid)!.push(getEffectiveIngestProgress(row.status, row.progress));
  }
  for (const [rid, progresses] of ingestByRun) {
    if (!result.has(rid)) {
      const avg = Math.round(progresses.reduce((a, b) => a + b, 0) / progresses.length);
      result.set(rid, avg);
    }
  }

  return result;
}
