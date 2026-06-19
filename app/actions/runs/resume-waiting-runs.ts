"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { JobRow } from "@/lib/supabase/types";
import { triggerWorker } from "@/lib/worker-trigger";
import { RETRY_WAKE_MIN_AGE_SECONDS } from "./constants";
import { hasWorkerClaimSignal } from "./shared";
import type { RetryQueuedRunWakeResult } from "./types";

const RETRY_WAKE_JOB_SELECT = `
  id,
  run_id,
  name,
  status,
  stage,
  progress,
  error_message,
  started_at,
  finished_at,
  duration,
  created_at,
  job_type,
  payload,
  preflight_run_id,
  updated_at,
  attempt_count,
  next_retry_at,
  locked_at,
  claimed_at,
  worker_id,
  heartbeat_at
`;

export async function retryQueuedRunWakeAction(
  runId: string,
  ordinal: 1 | 2
): Promise<RetryQueuedRunWakeResult> {
  if (ordinal !== 1 && ordinal !== 2) {
    return { attempted: false, reason: "maxed" };
  }

  const parsedRunId = z.string().uuid().safeParse(runId);
  if (!parsedRunId.success) {
    return { attempted: false, reason: "not_found" };
  }

  const serverClient = await createClient();
  const {
    data: { user },
    error: userError,
  } = await serverClient.auth.getUser();
  if (userError || !user) {
    return { attempted: false, reason: "unauthorized" };
  }

  const { data: run, error: runError } = await serverClient
    .from("runs")
    .select("id, status, user_id")
    .eq("id", parsedRunId.data)
    .maybeSingle();
  if (runError) {
    console.error("retryQueuedRunWakeAction run lookup error:", runError.message);
    return { attempted: false, reason: "not_found" };
  }
  if (!run) {
    return { attempted: false, reason: "not_found" };
  }
  if (run.user_id !== user.id) {
    return { attempted: false, reason: "unauthorized" };
  }
  if (run.status !== "queued") {
    return { attempted: false, reason: "not_queued" };
  }

  const { data: latestJobData, error: latestJobError } = await serverClient
    .from("jobs")
    .select(RETRY_WAKE_JOB_SELECT)
    .eq("run_id", parsedRunId.data)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestJobError) {
    console.error("retryQueuedRunWakeAction job lookup error:", latestJobError.message);
    return { attempted: false, reason: "not_found" };
  }

  const latestJob = (latestJobData ?? null) as JobRow | null;
  if (!latestJob || latestJob.status !== "queued") {
    return { attempted: false, reason: "not_queued" };
  }
  if (hasWorkerClaimSignal(latestJob)) {
    return { attempted: false, reason: "claimed" };
  }

  const jobCreatedAt = new Date(latestJob.created_at).getTime();
  if (!Number.isFinite(jobCreatedAt)) {
    return { attempted: false, reason: "too_early" };
  }

  const ageSeconds = Math.floor((Date.now() - jobCreatedAt) / 1000);
  if (ageSeconds < RETRY_WAKE_MIN_AGE_SECONDS[ordinal]) {
    return { attempted: false, reason: "too_early" };
  }

  const triggerResult = await triggerWorker(`runs.retryQueuedRunWakeAction.${ordinal}`);
  if (triggerResult && triggerResult.status !== "ok") {
    return { attempted: false, reason: "trigger_failed" };
  }
  return { attempted: true, reason: "triggered" };
}
