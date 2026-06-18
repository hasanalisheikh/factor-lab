import { isActiveDataIngestStatus } from "@/lib/data-ingest-jobs";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Returns the set of tickers that already have an active (queued or running)
 * data_ingest_job, so we can skip creating duplicate ingestion storms.
 * Queries the dedicated data_ingest_jobs table (explicit symbol column).
 */
export async function getActiveIngestTickers(): Promise<Set<string>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("data_ingest_jobs")
      .select("symbol, status, next_retry_at")
      .in("status", ["queued", "running", "retrying", "failed"]);

    return new Set(
      (data ?? [])
        .filter((j: { status?: string | null; next_retry_at?: string | null }) =>
          isActiveDataIngestStatus(j.status, j.next_retry_at)
        )
        .map((j: { symbol?: string }) => j.symbol?.toUpperCase())
        .filter((t: string | undefined): t is string => Boolean(t))
    );
  } catch {
    return new Set();
  }
}
