import "server-only";

import { createClient } from "../server";
import type { ReportRow } from "../types";

export async function getReportByRunId(runId: string): Promise<ReportRow | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    return data as ReportRow;
  } catch (err) {
    console.error("getReportByRunId exception:", err);
    return null;
  }
}

export async function getReportUrlsByRunIds(runIds: string[]): Promise<Record<string, string>> {
  if (runIds.length === 0) {
    return {};
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("reports")
      .select("run_id, url, created_at")
      .in("run_id", runIds)
      .order("created_at", { ascending: false });

    if (error || !data) {
      return {};
    }

    const reportUrls: Record<string, string> = {};
    for (const row of data as Array<Pick<ReportRow, "run_id" | "url">>) {
      if (!row.run_id || !row.url || row.run_id in reportUrls) continue;
      reportUrls[row.run_id] = row.url;
    }

    return reportUrls;
  } catch (err) {
    console.error("getReportUrlsByRunIds exception:", err);
    return {};
  }
}
