import type { BenchmarkCoverage } from "@/lib/supabase/types";

export type BenchmarkCoverageActionState = {
  status: BenchmarkCoverage["status"] | "not_ingested";
  needsWindowBackfill: boolean;
  isBehindCutoff: boolean;
  hasOptionalFullHistoryBackfill: boolean;
};

export function getBenchmarkCoverageActionState(
  coverage: BenchmarkCoverage | null
): BenchmarkCoverageActionState {
  const status = coverage?.status ?? "not_ingested";
  const coveragePercent = coverage?.coveragePercent ?? 0;
  const latestDate = coverage?.latestDate ?? null;
  const windowEnd = coverage?.windowEnd ?? null;
  const needsHistoricalBackfill = coverage?.needsHistoricalBackfill ?? false;

  const needsWindowBackfill = status !== "not_ingested" && coveragePercent < 100;
  const isBehindCutoff =
    status !== "not_ingested" &&
    latestDate !== null &&
    windowEnd !== null &&
    latestDate < windowEnd;
  const hasOptionalFullHistoryBackfill =
    status === "ok" && coveragePercent >= 100 && !isBehindCutoff && needsHistoricalBackfill;

  return {
    status,
    needsWindowBackfill,
    isBehindCutoff,
    hasOptionalFullHistoryBackfill,
  };
}
