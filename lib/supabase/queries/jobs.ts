import "server-only";

import { createClient } from "../server";
import type { JobRow } from "../types";

export async function getJobs(): Promise<JobRow[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
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
      .select("*")
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
