import {
  isMissingDataIngestExtendedColumnError,
  normalizeDataIngestStatus,
  stripExtendedDataIngestFields,
} from "@/lib/data-ingest-jobs";
import { DATA_STATE_SINGLETON_ID, getLastCompleteTradingDayUtc } from "@/lib/data-cutoff";

import type { SupabaseClient } from "@supabase/supabase-js";

export const ALLOWED_TICKERS = new Set([
  "SPY",
  "QQQ",
  "IWM",
  "VTI",
  "EFA",
  "EEM",
  "TLT",
  "GLD",
  "VNQ",
]);
export const CANCELLABLE_INGEST_STATUSES = ["queued", "running", "retrying", "failed"];

export type DataIngestJobRow = {
  id: string;
  symbol: string;
  start_date: string;
  end_date: string;
  status: string;
  stage: string | null;
  progress: number;
  error: string | null;
  request_mode: string | null;
  batch_id: string | null;
  target_cutoff_date: string | null;
  requested_by: string | null;
  created_at: string | null;
  started_at: string | null;
  updated_at: string | null;
  last_heartbeat_at: string | null;
  finished_at: string | null;
  rows_inserted: number | null;
  next_retry_at: string | null;
  attempt_count: number | null;
  requested_by_run_id: string | null;
  requested_by_user_id: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dij(admin: SupabaseClient<any, any, any>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (admin as any).from("data_ingest_jobs");
}

function normalizeJobRow(job: DataIngestJobRow | null): DataIngestJobRow | null {
  if (!job) return null;
  return {
    ...job,
    status: normalizeDataIngestStatus(job.status),
  };
}

function toLegacyCompatiblePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const compat = stripExtendedDataIngestFields(payload);
  if (compat.status === "succeeded") compat.status = "completed";
  if (compat.status === "retrying") compat.status = "failed";
  return compat;
}

function shouldRetryLegacyWrite(
  message: string | undefined,
  payload: Record<string, unknown>
): boolean {
  const lower = String(message ?? "").toLowerCase();
  return (
    isMissingDataIngestExtendedColumnError(message) ||
    ((payload.status === "succeeded" || payload.status === "retrying") &&
      lower.includes("data_ingest_jobs_status_check"))
  );
}

export async function runDataIngestWriteCompat<T>(
  run: (payload: Record<string, unknown>) => Promise<T>,
  payload: Record<string, unknown>
): Promise<T> {
  let result = await run(payload);
  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    result.error &&
    typeof result.error === "object" &&
    "message" in result.error &&
    shouldRetryLegacyWrite(String(result.error.message), payload)
  ) {
    result = await run(toLegacyCompatiblePayload(payload));
  }
  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    result.error &&
    typeof result.error === "object" &&
    "message" in result.error
  ) {
    throw new Error(String(result.error.message));
  }
  return result;
}

export async function selectDataIngestJobsCompat(
  admin: SupabaseClient,
  buildQuery: (
    selectColumns: string
  ) => Promise<{ data: DataIngestJobRow[] | null; error: { message: string } | null }>
): Promise<{ data: DataIngestJobRow[] | null; error: { message: string } | null }> {
  let result = await buildQuery(
    "id, symbol, status, stage, progress, error, created_at, started_at, updated_at, last_heartbeat_at, finished_at, rows_inserted, next_retry_at, attempt_count, request_mode, batch_id, target_cutoff_date, requested_by, requested_by_run_id, requested_by_user_id, start_date, end_date"
  );

  if (result.error && isMissingDataIngestExtendedColumnError(result.error.message)) {
    result = await buildQuery(
      "id, symbol, status, stage, progress, error, created_at, started_at, updated_at, finished_at, next_retry_at, attempt_count, requested_by_run_id, requested_by_user_id, start_date, end_date"
    );
  }

  return {
    data: (result.data ?? []).map((job) => normalizeJobRow(job)!),
    error: result.error,
  };
}

export async function resolveCurrentCutoffDate(admin: SupabaseClient): Promise<string> {
  const { data } = await admin
    .from("data_state")
    .select("data_cutoff_date")
    .eq("id", DATA_STATE_SINGLETON_ID)
    .maybeSingle();

  return (
    (data as { data_cutoff_date?: string } | null)?.data_cutoff_date ??
    getLastCompleteTradingDayUtc()
  );
}

export async function isUserOwnedIngestJob(
  admin: SupabaseClient,
  job: DataIngestJobRow,
  userId: string
): Promise<boolean> {
  if (job.requested_by_user_id) {
    return job.requested_by_user_id === userId;
  }

  if (!job.requested_by_run_id) {
    return false;
  }

  const { data: run } = await admin
    .from("runs")
    .select("user_id")
    .eq("id", job.requested_by_run_id)
    .maybeSingle();

  return (run as { user_id?: string } | null)?.user_id === userId;
}

export async function findUserOwnedIngestJob(
  admin: SupabaseClient,
  jobId: string,
  userId: string
): Promise<DataIngestJobRow | null> {
  const { data: rows, error } = await selectDataIngestJobsCompat(admin, (selectColumns) =>
    dij(admin).select(selectColumns).eq("id", jobId).limit(1)
  );
  const job = rows?.[0] ?? null;

  if (error || !job) {
    return null;
  }

  if (!(await isUserOwnedIngestJob(admin, job, userId))) {
    return null;
  }

  return job;
}
