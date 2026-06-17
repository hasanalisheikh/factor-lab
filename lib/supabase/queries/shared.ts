import "server-only";

import { BENCHMARK_OPTIONS } from "@/lib/benchmark";
import { getRequiredTickers, type DataUpdateMode } from "@/lib/data-cutoff";
import { normalizeDataIngestStatus } from "@/lib/data-ingest-jobs";
import { UNIVERSE_PRESETS, computeUniverseValidFrom, type UniverseId } from "@/lib/universe-config";
import { COVERAGE_WINDOW_START, type TickerDateRange } from "../types";
import type {
  BenchmarkCoverage,
  CompareRunBundle,
  DataIngestJobStatus,
  DataLastUpdatedRow,
  DataStateRow,
  EquityCurveRow,
  JobRow,
  ModelMetadataRow,
  ModelPredictionRow,
  PositionRow,
  PriceRow,
  ReportRow,
  RunMetricsRow,
  RunRow,
  RunWithMetrics,
  TickerMissingness,
  UserSettings,
} from "../types";

// Re-export for server-side consumers that import types from this module.
export type {
  BenchmarkCoverage,
  CompareRunBundle,
  DataIngestJobStatus,
  DataLastUpdatedRow,
  DataStateRow,
  EquityCurveRow,
  JobRow,
  ModelMetadataRow,
  ModelPredictionRow,
  PositionRow,
  PriceRow,
  ReportRow,
  RunMetricsRow,
  RunRow,
  RunWithMetrics,
  TickerMissingness,
  UserSettings,
};
export { COVERAGE_WINDOW_START };

export type DataHealthSummary = {
  tickersCount: number;
  dateStart: string | null;
  dateEnd: string | null;
  businessDaysInWindow: number;
  expectedTickerDays: number;
  actualTickerDays: number;
  missingTickerDays: number;
  completenessPercent: number | null;
  lastUpdatedAt: string | null;
};

export type DataStateSummary = {
  dataCutoffDate: string | null;
  lastUpdateAt: string | null;
  updateMode: DataUpdateMode | null;
  updatedBy: string | null;
  nextMonthlyRefresh: string;
  dailyUpdatesEnabled: boolean;
  /** Set by the daily cron on no-op runs (weekend, holiday, already current). */
  lastNoopCheckAt: string | null;
};

export type ScheduledRefreshActivity = {
  monthlyActiveJobs: number;
  dailyActiveJobs: number;
};

export type UniverseBatchStatus = "pending" | "running" | "succeeded" | "blocked";

export type UniverseBatchStatusSummary = {
  batchId: string;
  status: UniverseBatchStatus;
  totalJobs: number;
  completedJobs: number;
  avgProgress: number;
  symbols: Array<{ symbol: string; status: string; progress: number }>;
};

export type UniverseConstraintsSnapshot = {
  universe: UniverseId;
  universeEarliestStart: string | null;
  universeValidFrom: string | null;
  missingTickers: string[];
  ingestedCount: number;
  totalCount: number;
  ready: boolean;
  dataCutoffDate: string | null;
};

export type DataIngestJobHistoryEntry = {
  id: string;
  symbol: string;
  status: string;
  stage: string | null;
  requestMode: string | null;
  requestedBy: string | null;
  triggerLabel: string;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  nextRetryAt: string | null;
  attemptCount: number | null;
  rowsInserted: number;
  targetCutoffDate: string | null;
  error: string | null;
};

export type RequiredTickerResearchRow = {
  ticker: string;
  researchStart: string;
  researchEnd: string;
  expectedDays: number;
  actualDays: number;
  trueMissingDays: number;
  coveragePercent: number;
  maxGapDays: number;
  firstObservedDate: string | null;
  lastObservedDate: string | null;
  isBenchmark: boolean;
  isIngested: boolean;
};

export type RequiredTickerResearchSummary = {
  rows: RequiredTickerResearchRow[];
  requiredTickers: string[];
  notIngestedTickers: string[];
  ingestedTickers: number;
  completeness: number | null;
  totalExpected: number;
  totalActual: number;
  totalTrueMissing: number;
  trueMissingRate: number;
  marketCalendarDays: number;
};

export type IngestionLogEntry = {
  id: string;
  ingested_at: string;
  status: string;
  tickers_updated: number;
  rows_upserted: number;
  note: string | null;
  source: string;
};

export type RunBenchmarkContext = Pick<
  RunRow,
  "id" | "benchmark" | "benchmark_ticker" | "strategy_id" | "universe_symbols"
>;

export type GetRunsOptions = {
  limit?: number;
  search?: string;
  status?: string;
  strategy?: string;
  universe?: string;
};

export function getErrorMessage(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message?: unknown };
    return typeof message === "string" ? message : undefined;
  }
  return undefined;
}

function isAbortLikeError(error: unknown): boolean {
  const message = getErrorMessage(error)?.toLowerCase();
  if (message && (message.includes("aborterror") || message.includes("operation was aborted"))) {
    return true;
  }

  if (error && typeof error === "object" && "name" in error) {
    const { name } = error as { name?: unknown };
    return name === "AbortError" || name === "TimeoutError";
  }

  return false;
}

export function logQueryError(scope: string, error: unknown): void {
  if (isAbortLikeError(error)) return;
  console.error(`${scope} error:`, getErrorMessage(error) ?? error);
}

export function logQueryException(scope: string, error: unknown): void {
  if (isAbortLikeError(error)) return;
  console.error(`${scope} exception:`, error);
}

export function isMissingBenchmarkColumnError(message?: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes("benchmark") && m.includes("does not exist");
}

export function isMissingPositionsTableError(message?: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes("public.positions") && m.includes("could not find the table");
}

export function countBusinessDays(startStr: string, endStr: string): number {
  if (!startStr || !endStr || startStr > endStr) return 0;
  const start = new Date(`${startStr}T00:00:00Z`);
  const end = new Date(`${endStr}T00:00:00Z`);
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

export function maxIsoDateNullable(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export function buildRequiredTickerResearchStarts(ranges: TickerDateRange[]): Map<string, string> {
  const requiredTickers = getRequiredTickers();
  const starts = new Map<string, string>();

  for (const ticker of requiredTickers) {
    starts.set(ticker, COVERAGE_WINDOW_START);
  }

  for (const [universeId, tickers] of Object.entries(UNIVERSE_PRESETS) as [
    UniverseId,
    readonly string[],
  ][]) {
    const validFrom = computeUniverseValidFrom(universeId, ranges);
    const researchStart =
      maxIsoDateNullable(validFrom, COVERAGE_WINDOW_START) ?? COVERAGE_WINDOW_START;

    for (const ticker of tickers) {
      const existing = starts.get(ticker);
      starts.set(ticker, existing && existing <= researchStart ? existing : researchStart);
    }
  }

  return starts;
}

export function summarizeTickerAgainstCalendar(params: {
  ticker: string;
  researchStart: string;
  researchEnd: string;
  marketCalendar: readonly string[];
  observedDates: readonly string[];
}): RequiredTickerResearchRow {
  const { ticker, researchStart, researchEnd, marketCalendar, observedDates } = params;
  const relevantCalendar = marketCalendar.filter(
    (date) => date >= researchStart && date <= researchEnd
  );
  const observedSet = new Set(
    observedDates.filter((date) => date >= researchStart && date <= researchEnd)
  );

  let trueMissingDays = 0;
  let maxGapDays = 0;
  let currentGap = 0;

  for (const date of relevantCalendar) {
    if (observedSet.has(date)) {
      if (currentGap > maxGapDays) maxGapDays = currentGap;
      currentGap = 0;
      continue;
    }
    trueMissingDays += 1;
    currentGap += 1;
  }

  if (currentGap > maxGapDays) maxGapDays = currentGap;

  const expectedDays = relevantCalendar.length;
  const actualDays = observedSet.size;

  return {
    ticker,
    researchStart,
    researchEnd,
    expectedDays,
    actualDays,
    trueMissingDays,
    coveragePercent: expectedDays > 0 ? Math.min((actualDays / expectedDays) * 100, 100) : 100,
    maxGapDays,
    firstObservedDate: observedDates[0] ?? null,
    lastObservedDate: observedDates[observedDates.length - 1] ?? null,
    isBenchmark: BENCHMARK_OPTIONS.includes(ticker as (typeof BENCHMARK_OPTIONS)[number]),
    isIngested: observedDates.length > 0,
  };
}

export function getEffectiveIngestProgress(
  status: string,
  progress: number | null | undefined
): number {
  const normalized = normalizeDataIngestStatus(status);
  if (normalized === "succeeded") return 100;
  if (normalized === "retrying") return Math.min(progress ?? 0, 95);
  return progress ?? 0;
}

// ---------------------------------------------------------------------------
// Ingest progress for waiting_for_data runs
// ---------------------------------------------------------------------------
