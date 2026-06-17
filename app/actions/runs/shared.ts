import type { JobRow } from "@/lib/supabase/types";

export function hasWorkerClaimSignal(
  job: Pick<JobRow, "claimed_at" | "worker_id" | "started_at">
): boolean {
  return Boolean(job.claimed_at || job.worker_id || job.started_at);
}

export function isMissingBenchmarkColumnError(message?: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes("benchmark") && lower.includes("does not exist");
}
