import type { BenchmarkCoverage, DataIngestJobStatus } from "@/lib/supabase/types";

export type BenchmarkRowData = {
  ticker: string;
  coverage: BenchmarkCoverage | null;
  initialJob: DataIngestJobStatus | null;
};

export type BenchmarkCoverageCardProps = {
  /** null signals a query failure — renders "Coverage unavailable" instead of "Not ingested" */
  benchmarks: BenchmarkRowData[] | null;
  isDev?: boolean;
};
