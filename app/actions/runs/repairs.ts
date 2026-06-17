import "server-only";

import {
  isActiveDataIngestStatus,
  isMissingDataIngestExtendedColumnError,
  stripExtendedDataIngestFields,
} from "@/lib/data-ingest-jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { TICKER_INCEPTION_DATES } from "@/lib/supabase/types";
import { triggerWorker } from "@/lib/worker-trigger";
import type { ActiveIngestJobRow, RepairBatchResult, SymbolRepairPlan } from "./types";

export function defaultIngestStartDate(symbol: string): string {
  return TICKER_INCEPTION_DATES[symbol] ?? "1993-01-01";
}

export async function getActiveIngestJobsForSymbols(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  symbols: string[]
): Promise<ActiveIngestJobRow[]> {
  if (symbols.length === 0) return [];

  const { data, error } = await supabase
    .from("data_ingest_jobs")
    .select("id, symbol, status, next_retry_at, start_date, end_date, batch_id, request_mode")
    .in("symbol", symbols)
    .in("status", ["queued", "running", "retrying", "failed"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("ensureUniverseDataReady active-ingest query error:", error.message);
    return [];
  }

  const latestBySymbol = new Map<string, ActiveIngestJobRow>();
  for (const row of (data ?? []) as ActiveIngestJobRow[]) {
    const symbol = row.symbol.toUpperCase();
    if (latestBySymbol.has(symbol)) continue;
    if (!isActiveDataIngestStatus(row.status, row.next_retry_at ?? null)) continue;
    latestBySymbol.set(symbol, row);
  }

  return [...latestBySymbol.values()];
}

export async function insertDataIngestJobsCompat(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  rows: Array<Record<string, unknown>>
): Promise<string | null> {
  if (rows.length === 0) return null;

  let { error } = await supabase.from("data_ingest_jobs").insert(rows);

  if (error && isMissingDataIngestExtendedColumnError(error.message)) {
    error = (
      await supabase
        .from("data_ingest_jobs")
        .insert(rows.map((row) => stripExtendedDataIngestFields(row)))
    ).error;
  }

  return error?.message ?? null;
}

export async function updateDataIngestJobCompat(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  jobId: string,
  payload: Record<string, unknown>
): Promise<string | null> {
  let { error } = await supabase.from("data_ingest_jobs").update(payload).eq("id", jobId);

  if (error && isMissingDataIngestExtendedColumnError(error.message)) {
    error = (
      await supabase
        .from("data_ingest_jobs")
        .update(stripExtendedDataIngestFields(payload))
        .eq("id", jobId)
    ).error;
  }

  return error?.message ?? null;
}

export function canAdoptIntoReadinessBatch(job: ActiveIngestJobRow): boolean {
  const mode = (job.request_mode ?? "").toLowerCase();
  return mode !== "monthly" && mode !== "daily";
}

export function findReusableBatchId(
  symbols: string[],
  activeJobs: ActiveIngestJobRow[]
): string | null {
  if (symbols.length === 0) return null;

  const bySymbol = new Map(activeJobs.map((job) => [job.symbol.toUpperCase(), job]));
  if (symbols.some((symbol) => !bySymbol.has(symbol.toUpperCase()))) {
    return null;
  }

  const batchIds = new Set(
    symbols
      .map((symbol) => bySymbol.get(symbol.toUpperCase())?.batch_id ?? null)
      .filter((batchId): batchId is string => Boolean(batchId))
  );

  return batchIds.size === 1 ? [...batchIds][0] : null;
}

export async function ensureSymbolRepairsInternal(params: {
  plans: SymbolRepairPlan[];
  userId: string;
  requestedBy: string;
  createBatch?: boolean;
}): Promise<RepairBatchResult> {
  const { plans, userId, requestedBy, createBatch = true } = params;
  const normalizedPlans = plans.map((plan) => ({
    symbol: plan.symbol.toUpperCase(),
    desiredStart: plan.desiredStart,
    desiredEnd: plan.desiredEnd,
  }));

  if (normalizedPlans.length === 0) {
    return {
      batchId: null,
      queuedSymbols: [],
      widenedSymbols: [],
      activeSymbols: [],
      failedSymbols: [],
    };
  }

  const admin = createAdminClient();
  const symbols = normalizedPlans.map((plan) => plan.symbol);
  const activeJobs = await getActiveIngestJobsForSymbols(admin, symbols);
  const reusableBatchId = findReusableBatchId(symbols, activeJobs);

  if (reusableBatchId) {
    return {
      batchId: reusableBatchId,
      queuedSymbols: [],
      widenedSymbols: [],
      activeSymbols: symbols,
      failedSymbols: [],
    };
  }

  if (!createBatch) {
    return {
      batchId: null,
      queuedSymbols: [],
      widenedSymbols: [],
      activeSymbols: symbols,
      failedSymbols: [],
    };
  }

  const batchId = crypto.randomUUID();
  const activeBySymbol = new Map(activeJobs.map((job) => [job.symbol.toUpperCase(), job]));
  const queuedSymbols: string[] = [];
  const widenedSymbols: string[] = [];
  const activeSymbols: string[] = [];
  const failedSymbols: string[] = [];
  const rowsToInsert: Array<Record<string, unknown>> = [];

  for (const plan of normalizedPlans) {
    const existing = activeBySymbol.get(plan.symbol);
    if (!existing) {
      rowsToInsert.push({
        symbol: plan.symbol,
        start_date: plan.desiredStart,
        end_date: plan.desiredEnd,
        status: "queued",
        stage: "download",
        progress: 0,
        request_mode: "manual",
        batch_id: batchId,
        target_cutoff_date: plan.desiredEnd,
        requested_by: requestedBy,
        requested_by_user_id: userId,
      });
      queuedSymbols.push(plan.symbol);
      continue;
    }

    activeSymbols.push(plan.symbol);

    if (!canAdoptIntoReadinessBatch(existing)) {
      continue;
    }

    const updatePayload: Record<string, unknown> = {
      batch_id: batchId,
      request_mode: "manual",
      target_cutoff_date: plan.desiredEnd,
      requested_by: requestedBy,
      requested_by_user_id: userId,
    };
    const currentStart = existing.start_date ?? plan.desiredStart;
    const currentEnd = existing.end_date ?? plan.desiredEnd;
    if (existing.status === "queued") {
      const nextStart = plan.desiredStart < currentStart ? plan.desiredStart : currentStart;
      const nextEnd = plan.desiredEnd > currentEnd ? plan.desiredEnd : currentEnd;
      updatePayload.start_date = nextStart;
      updatePayload.end_date = nextEnd;
      if (nextStart !== currentStart || nextEnd !== currentEnd || existing.batch_id !== batchId) {
        widenedSymbols.push(plan.symbol);
      }
    }

    const updateError = await updateDataIngestJobCompat(admin, existing.id, updatePayload);
    if (updateError) {
      console.error("ensureSymbolRepairsInternal adopt error:", updateError);
      failedSymbols.push(plan.symbol);
    }
  }

  const insertError = await insertDataIngestJobsCompat(admin, rowsToInsert);
  if (insertError) {
    console.error("ensureSymbolRepairsInternal insert error:", insertError);
    for (const plan of normalizedPlans) {
      if (queuedSymbols.includes(plan.symbol)) {
        failedSymbols.push(plan.symbol);
      }
    }
  }

  if ((rowsToInsert.length > 0 || widenedSymbols.length > 0) && failedSymbols.length === 0) {
    await triggerWorker("runs.ensureSymbolRepairsInternal");
  }

  return {
    batchId,
    queuedSymbols,
    widenedSymbols,
    activeSymbols,
    failedSymbols: [...new Set(failedSymbols)],
  };
}
