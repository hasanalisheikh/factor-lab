import "server-only";

import { createClient } from "../server";
import type { JobRow } from "../types";

const JOB_SELECT = `
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
  locked_at
`;

export async function getJobs(): Promise<JobRow[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("jobs")
      .select(JOB_SELECT)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("getJobs error:", error.message);
      return [];
    }

    return (data ?? []) as JobRow[];
  } catch (err) {
    console.error("getJobs exception:", err);
    return [];
  }
}

export async function getJobByRunId(runId: string): Promise<JobRow | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("jobs")
      .select(JOB_SELECT)
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    return data as JobRow;
  } catch (err) {
    console.error("getJobByRunId exception:", err);
    return null;
  }
}
