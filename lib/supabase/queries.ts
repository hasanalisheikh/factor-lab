import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "./server";
import { createAdminClient } from "./admin";
import {
  DATA_STATE_SINGLETON_ID,
  getLastCompleteTradingDayUtc,
  getNextMonthStartUtc,
  getRequiredTickers,
  isDailyUpdatesEnabled,
  type DataUpdateMode,
} from "@/lib/data-cutoff";
import {
  BENCHMARK_OPTIONS,
  getRunBenchmark,
  inferPossibleOverlapFromUniverse,
  isBenchmarkHeldAtLatestRebalance,
  type BenchmarkOverlapState,
} from "@/lib/benchmark";
import type {
  RunRow,
  RunMetricsRow,
  EquityCurveRow,
  ReportRow,
  JobRow,
  PriceRow,
  DataLastUpdatedRow,
  DataStateRow,
  ModelMetadataRow,
  ModelPredictionRow,
  PositionRow,
  UserSettings,
  RunWithMetrics,
  CompareRunBundle,
  TickerMissingness,
  TickerDateRange,
  TickerMissingnessV2,
  BenchmarkCoverage,
  DataIngestJobStatus,
} from "./types";
import { COVERAGE_WINDOW_START, TICKER_INCEPTION_DATES } from "./types";
import {
  getDataIngestTriggerLabel,
  isActiveDataIngestStatus,
  isMissingDataIngestExtendedColumnError,
  normalizeDataIngestStatus,
} from "@/lib/data-ingest-jobs";
import {
  UNIVERSE_PRESETS,
  computeUniverseValidFrom,
  summarizeUniverseConstraints,
  type UniverseId,
} from "@/lib/universe-config";
import { computeBenchmarkCoverage, type CoverageStatsSnapshot } from "@/lib/coverage-check";
import type { RunStatus } from "@/lib/types";

// Re-export for server-side consumers that import types from this module
export type {
  RunRow,
  RunMetricsRow,
  EquityCurveRow,
  ReportRow,
  JobRow,
  PriceRow,
  DataLastUpdatedRow,
  DataStateRow,
  ModelMetadataRow,
  ModelPredictionRow,
  PositionRow,
  UserSettings,
  RunWithMetrics,
  CompareRunBundle,
  TickerMissingness,
  BenchmarkCoverage,
  DataIngestJobStatus,
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

export function classifyUniverseBatchStatus(
  rows: Array<{
    status: string;
    progress: number | null;
    next_retry_at: string | null;
  }>
): Pick<UniverseBatchStatusSummary, "status" | "completedJobs" | "avgProgress"> {
  const totalJobs = rows.length;
  const completedJobs = rows.filter(
    (row) => normalizeDataIngestStatus(row.status) === "succeeded"
  ).length;
  const avgProgress =
    totalJobs === 0
      ? 0
      : Math.round(
          rows.reduce((sum, row) => sum + getEffectiveIngestProgress(row.status, row.progress), 0) /
            totalJobs
        );

  const hasRunning = rows.some((row) => normalizeDataIngestStatus(row.status) === "running");
  const hasActive = rows.some((row) => isActiveDataIngestStatus(row.status, row.next_retry_at));
  const hasTerminalFailure = rows.some((row) => {
    const normalized = normalizeDataIngestStatus(row.status);
    return normalized === "blocked" || (normalized === "failed" && !row.next_retry_at);
  });

  return {
    status: hasActive
      ? hasRunning
        ? "running"
        : "pending"
      : hasTerminalFailure
        ? "blocked"
        : "succeeded",
    completedJobs,
    avgProgress,
  };
}

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

type RunBenchmarkContext = Pick<
  RunRow,
  "id" | "benchmark" | "benchmark_ticker" | "strategy_id" | "universe_symbols"
>;

type GetRunsOptions = {
  limit?: number;
  search?: string;
  status?: string;
  strategy?: string;
  universe?: string;
};

function getErrorMessage(error: unknown): string | undefined {
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

function logQueryError(scope: string, error: unknown): void {
  if (isAbortLikeError(error)) return;
  console.error(`${scope} error:`, getErrorMessage(error) ?? error);
}

function logQueryException(scope: string, error: unknown): void {
  if (isAbortLikeError(error)) return;
  console.error(`${scope} exception:`, error);
}

function isMissingBenchmarkColumnError(message?: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes("benchmark") && m.includes("does not exist");
}

function isMissingPositionsTableError(message?: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes("public.positions") && m.includes("could not find the table");
}

export async function getRuns(options: GetRunsOptions = {}): Promise<RunWithMetrics[]> {
  const { limit = 100, search, status, strategy, universe } = options;
  try {
    const supabase = await createClient();
    let queryWithBenchmark = supabase
      .from("runs")
      .select(
        `
        id,
        name,
        strategy_id,
        status,
        universe,
        benchmark,
        benchmark_ticker,
        start_date,
        end_date,
        created_at,
        run_metrics(run_id, cagr, sharpe, max_drawdown, turnover)
      `
      )
      .order("created_at", { ascending: false });

    if (search) {
      queryWithBenchmark = queryWithBenchmark.ilike("name", `%${search}%`);
    }
    if (status) {
      queryWithBenchmark = queryWithBenchmark.eq("status", status);
    }
    if (strategy) {
      queryWithBenchmark = queryWithBenchmark.eq("strategy_id", strategy);
    }
    if (universe) {
      queryWithBenchmark = queryWithBenchmark.eq("universe", universe);
    }
    if (limit > 0) {
      queryWithBenchmark = queryWithBenchmark.limit(limit);
    }

    let { data, error } = await queryWithBenchmark;
    if (error && isMissingBenchmarkColumnError(error.message)) {
      let queryLegacy = supabase
        .from("runs")
        .select(
          `
          id,
          name,
          strategy_id,
          status,
          universe,
          benchmark_ticker,
          start_date,
          end_date,
          created_at,
          run_metrics(run_id, cagr, sharpe, max_drawdown, turnover)
        `
        )
        .order("created_at", { ascending: false });

      if (search) {
        queryLegacy = queryLegacy.ilike("name", `%${search}%`);
      }
      if (status) {
        queryLegacy = queryLegacy.eq("status", status);
      }
      if (strategy) {
        queryLegacy = queryLegacy.eq("strategy_id", strategy);
      }
      if (universe) {
        queryLegacy = queryLegacy.eq("universe", universe);
      }
      if (limit > 0) {
        queryLegacy = queryLegacy.limit(limit);
      }
      const fallback = await queryLegacy;
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      logQueryError("getRuns", error);
      return [];
    }

    return (data ?? []) as RunWithMetrics[];
  } catch (err) {
    logQueryException("getRuns", err);
    return [];
  }
}

export async function getRunsCount(options: Omit<GetRunsOptions, "limit"> = {}): Promise<number> {
  const { search, status, strategy, universe } = options;
  try {
    const supabase = await createClient();
    let query = supabase.from("runs").select("*", { count: "exact", head: true });

    if (search) {
      query = query.ilike("name", `%${search}%`);
    }
    if (status) {
      query = query.eq("status", status);
    }
    if (strategy) {
      query = query.eq("strategy_id", strategy);
    }
    if (universe) {
      query = query.eq("universe", universe);
    }

    const { count, error } = await query;

    if (error) {
      logQueryError("getRunsCount", error);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    logQueryException("getRunsCount", err);
    return 0;
  }
}

export async function getRunById(id: string): Promise<RunWithMetrics | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("runs")
      .select("*, run_metrics(*)")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) return null;

    return data as RunWithMetrics;
  } catch (err) {
    console.error("getRunById exception:", err);
    return null;
  }
}

const EQUITY_CURVE_PAGE_SIZE = 5000;

export async function fetchAllEquityCurve(runId: string): Promise<EquityCurveRow[]> {
  const supabase = await createClient();
  const all: EquityCurveRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("equity_curve")
      .select("run_id,date,portfolio,benchmark") // id column intentionally excluded — not used by any consumer
      .eq("run_id", runId)
      .order("date", { ascending: true })
      .range(offset, offset + EQUITY_CURVE_PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to load equity curve: ${error.message}`);
    }

    const page = (data ?? []) as EquityCurveRow[];
    if (page.length === 0) break;

    all.push(...page);
    if (page.length < EQUITY_CURVE_PAGE_SIZE) break;
    offset += EQUITY_CURVE_PAGE_SIZE;
  }

  return all;
}

export async function getEquityCurve(runId: string): Promise<EquityCurveRow[]> {
  try {
    return await fetchAllEquityCurve(runId);
  } catch (err) {
    console.error("getEquityCurve exception:", err);
    return [];
  }
}

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

export async function getMostRecentCompletedRun(): Promise<RunWithMetrics | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("runs")
      .select("*, run_metrics(*)")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    return data as RunWithMetrics;
  } catch (err) {
    console.error("getMostRecentCompletedRun exception:", err);
    return null;
  }
}

export async function getModelMetadataByRunId(runId: string): Promise<ModelMetadataRow | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("model_metadata")
      .select("*")
      .eq("run_id", runId)
      .maybeSingle();

    if (error || !data) return null;
    return data as ModelMetadataRow;
  } catch (err) {
    console.error("getModelMetadataByRunId exception:", err);
    return null;
  }
}

export async function getModelPredictionsByRunId(runId: string): Promise<ModelPredictionRow[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("model_predictions")
      .select("*")
      .eq("run_id", runId)
      .order("as_of_date", { ascending: false })
      .order("rank", { ascending: true })
      .limit(500);

    if (error) {
      console.error("getModelPredictionsByRunId error:", error.message);
      return [];
    }
    return (data ?? []) as ModelPredictionRow[];
  } catch (err) {
    console.error("getModelPredictionsByRunId exception:", err);
    return [];
  }
}

export async function getStrategyComparisonRuns(): Promise<RunWithMetrics[]> {
  const empty: RunWithMetrics[] = [];
  try {
    const supabase = await createClient();
    const strategies = [
      "equal_weight",
      "momentum_12_1",
      "low_vol",
      "trend_filter",
      "ml_ridge",
      "ml_lightgbm",
    ];

    // Single query: fetch recent completed runs across all strategies, then pick latest per strategy in JS.
    // limit(30) gives ~5 per strategy on average which is more than enough.
    const { data, error } = await supabase
      .from("runs")
      .select("*, run_metrics(*)")
      .in("strategy_id", strategies)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(30);

    if (error || !data) return empty;

    const seen = new Set<string>();
    const results: RunWithMetrics[] = [];
    for (const row of data as RunWithMetrics[]) {
      if (!seen.has(row.strategy_id)) {
        seen.add(row.strategy_id);
        results.push(row);
      }
    }
    return results;
  } catch (err) {
    console.error("getStrategyComparisonRuns exception:", err);
    return empty;
  }
}

export async function getCompareRunBundles(limit = 30): Promise<CompareRunBundle[]> {
  try {
    const supabase = await createClient();
    const { data: runsData, error: runsError } = await supabase
      .from("runs")
      .select("*, run_metrics(*)")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (runsError || !runsData || runsData.length === 0) {
      if (runsError) {
        console.error("getCompareRunBundles runs error:", runsError.message);
      }
      return [];
    }

    const runs = runsData as RunWithMetrics[];
    const runIds = runs.map((r) => r.id);
    const { data: equityRows, error: eqError } = await supabase
      .from("equity_curve")
      .select("*")
      .in("run_id", runIds)
      .order("date", { ascending: true });

    if (eqError) {
      console.error("getCompareRunBundles equity error:", eqError.message);
      return [];
    }

    const grouped = new Map<string, EquityCurveRow[]>();
    for (const row of (equityRows ?? []) as EquityCurveRow[]) {
      const arr = grouped.get(row.run_id) ?? [];
      arr.push(row);
      grouped.set(row.run_id, arr);
    }

    const bundles: CompareRunBundle[] = [];
    for (const run of runs) {
      const metrics = Array.isArray(run.run_metrics) ? run.run_metrics[0] : run.run_metrics;
      const equity = grouped.get(run.id) ?? [];
      if (!metrics || equity.length === 0) continue;
      bundles.push({
        run: run as RunRow,
        metrics,
        equity,
      });
    }
    return bundles;
  } catch (err) {
    console.error("getCompareRunBundles exception:", err);
    return [];
  }
}

export type DataCoverage = {
  minDate: string | null;
  maxDate: string | null;
  lastUpdatedAt?: string | null;
};

export async function getDataState(): Promise<DataStateSummary> {
  try {
    const supabase = await createClient();
    const { data, error } = (await supabase
      .from("data_state")
      .select("data_cutoff_date, last_update_at, update_mode, updated_by, last_noop_check_at")
      .eq("id", DATA_STATE_SINGLETON_ID)
      .maybeSingle()) as {
      data: Pick<
        DataStateRow,
        "data_cutoff_date" | "last_update_at" | "update_mode" | "updated_by" | "last_noop_check_at"
      > | null;
      error: { message: string } | null;
    };

    if (!error && data) {
      return {
        dataCutoffDate: data.data_cutoff_date,
        lastUpdateAt: data.last_update_at,
        updateMode: data.update_mode,
        updatedBy: data.updated_by,
        nextMonthlyRefresh: getNextMonthStartUtc(),
        dailyUpdatesEnabled: isDailyUpdatesEnabled(),
        lastNoopCheckAt: data.last_noop_check_at ?? null,
      };
    }

    const safeCutoff = getLastCompleteTradingDayUtc();
    const { data: maxRow } = await supabase
      .from("prices")
      .select("date")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const fallbackMaxDate = (maxRow as { date?: string } | null)?.date ?? null;
    const fallbackCutoff =
      fallbackMaxDate && fallbackMaxDate < safeCutoff ? fallbackMaxDate : safeCutoff;

    return {
      dataCutoffDate: fallbackCutoff,
      lastUpdateAt: null,
      updateMode: null,
      updatedBy: null,
      nextMonthlyRefresh: getNextMonthStartUtc(),
      dailyUpdatesEnabled: isDailyUpdatesEnabled(),
      lastNoopCheckAt: null,
    };
  } catch {
    return {
      dataCutoffDate: getLastCompleteTradingDayUtc(),
      lastUpdateAt: null,
      updateMode: null,
      updatedBy: null,
      nextMonthlyRefresh: getNextMonthStartUtc(),
      dailyUpdatesEnabled: isDailyUpdatesEnabled(),
      lastNoopCheckAt: null,
    };
  }
}

export async function getDataCoverage(): Promise<DataCoverage> {
  try {
    const supabase = await createClient();
    const [dataState, firstStatsRes] = await Promise.all([
      getDataState(),
      supabase
        .from("ticker_stats")
        .select("first_date")
        .order("first_date", { ascending: true })
        .limit(1) as unknown as Promise<{
        data: Array<{ first_date: string }> | null;
        error: { message: string } | null;
      }>,
    ]);

    let minDate = firstStatsRes.data?.[0]?.first_date ?? null;
    if (!minDate && dataState.dataCutoffDate) {
      const { data: minRow } = await supabase
        .from("prices")
        .select("date")
        .lte("date", dataState.dataCutoffDate)
        .order("date", { ascending: true })
        .limit(1)
        .maybeSingle();
      minDate = (minRow as { date?: string } | null)?.date ?? null;
    }

    return {
      minDate,
      maxDate: dataState.dataCutoffDate,
      lastUpdatedAt: dataState.lastUpdateAt,
    };
  } catch {
    return { minDate: null, maxDate: null, lastUpdatedAt: null };
  }
}

export async function getActiveScheduledRefreshActivity(): Promise<ScheduledRefreshActivity> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("data_ingest_jobs")
      .select("request_mode, status, next_retry_at, batch_id")
      .in("request_mode", ["monthly", "daily"])
      .not("batch_id", "is", null)
      .in("status", ["queued", "running"]);

    if (error) {
      return {
        monthlyActiveJobs: 0,
        dailyActiveJobs: 0,
      };
    }

    let monthlyActiveJobs = 0;
    let dailyActiveJobs = 0;

    for (const row of (data ?? []) as Array<{
      request_mode?: string | null;
      status?: string | null;
      next_retry_at?: string | null;
    }>) {
      if (!isActiveDataIngestStatus(row.status, row.next_retry_at ?? null)) continue;
      if (row.request_mode === "monthly") monthlyActiveJobs += 1;
      if (row.request_mode === "daily") dailyActiveJobs += 1;
    }

    return { monthlyActiveJobs, dailyActiveJobs };
  } catch {
    return {
      monthlyActiveJobs: 0,
      dailyActiveJobs: 0,
    };
  }
}

export async function getRecentDataIngestJobHistory(
  limit = 15
): Promise<DataIngestJobHistoryEntry[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let { data, error } = await (supabase as any)
      .from("data_ingest_jobs")
      .select(
        "id, symbol, status, stage, request_mode, requested_by, created_at, started_at, finished_at, next_retry_at, attempt_count, rows_inserted, target_cutoff_date, error"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error && isMissingDataIngestExtendedColumnError(error.message)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const legacyFallback = await (supabase as any)
        .from("data_ingest_jobs")
        .select(
          "id, symbol, status, stage, created_at, started_at, finished_at, next_retry_at, attempt_count, target_cutoff_date, error"
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      data = legacyFallback.data;
      error = legacyFallback.error;
    }

    if (error) {
      console.warn("getRecentDataIngestJobHistory:", error.message);
      return [];
    }

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      symbol: String(row.symbol ?? ""),
      status: normalizeDataIngestStatus(String(row.status ?? "queued")),
      stage: typeof row.stage === "string" ? row.stage : null,
      requestMode: typeof row.request_mode === "string" ? row.request_mode : null,
      requestedBy: typeof row.requested_by === "string" ? row.requested_by : null,
      triggerLabel: getDataIngestTriggerLabel(
        typeof row.request_mode === "string" ? row.request_mode : null,
        typeof row.requested_by === "string" ? row.requested_by : null
      ),
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
      startedAt: typeof row.started_at === "string" ? row.started_at : null,
      finishedAt: typeof row.finished_at === "string" ? row.finished_at : null,
      nextRetryAt: typeof row.next_retry_at === "string" ? row.next_retry_at : null,
      attemptCount:
        typeof row.attempt_count === "number" ? row.attempt_count : Number(row.attempt_count ?? 0),
      rowsInserted:
        typeof row.rows_inserted === "number" ? row.rows_inserted : Number(row.rows_inserted ?? 0),
      targetCutoffDate: typeof row.target_cutoff_date === "string" ? row.target_cutoff_date : null,
      error: typeof row.error === "string" ? row.error : null,
    }));
  } catch (err) {
    console.error("getRecentDataIngestJobHistory exception:", err);
    return [];
  }
}

export async function getRequiredTickerResearchSummary(
  dataCutoffDate: string | null,
  prefetchedRanges?: TickerDateRange[]
): Promise<RequiredTickerResearchSummary> {
  const empty: RequiredTickerResearchSummary = {
    rows: [],
    requiredTickers: getRequiredTickers(),
    notIngestedTickers: [],
    ingestedTickers: 0,
    completeness: null,
    totalExpected: 0,
    totalActual: 0,
    totalTrueMissing: 0,
    trueMissingRate: 0,
    marketCalendarDays: 0,
  };

  const researchEnd = dataCutoffDate ?? getLastCompleteTradingDayUtc();
  const requiredTickers = getRequiredTickers();
  const ranges = prefetchedRanges ?? (await getAllTickerStats());
  const researchStarts = buildRequiredTickerResearchStarts(ranges);
  const minResearchStart = [...researchStarts.values()].sort()[0] ?? COVERAGE_WINDOW_START;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("prices")
      .select("ticker, date")
      .in("ticker", requiredTickers)
      .gte("date", minResearchStart)
      .lte("date", researchEnd)
      .order("date", { ascending: true });

    if (error) {
      console.error("getRequiredTickerResearchSummary error:", error.message);
      return empty;
    }

    const observedByTicker = new Map<string, string[]>();
    const marketCalendarSet = new Set<string>();

    for (const ticker of requiredTickers) {
      observedByTicker.set(ticker, []);
    }

    for (const row of data ?? []) {
      const ticker = String(row.ticker ?? "").toUpperCase();
      const date = String(row.date ?? "");
      const researchStart = researchStarts.get(ticker) ?? COVERAGE_WINDOW_START;

      if (date < researchStart || date > researchEnd) continue;

      marketCalendarSet.add(date);
      const bucket = observedByTicker.get(ticker);
      if (bucket) {
        bucket.push(date);
      } else {
        observedByTicker.set(ticker, [date]);
      }
    }

    let marketCalendar = [...marketCalendarSet].sort();
    if (marketCalendar.length === 0) {
      const weekdayCalendar: string[] = [];
      const cursor = new Date(`${minResearchStart}T00:00:00Z`);
      const end = new Date(`${researchEnd}T00:00:00Z`);
      while (cursor <= end) {
        const day = cursor.getUTCDay();
        if (day !== 0 && day !== 6) {
          weekdayCalendar.push(cursor.toISOString().slice(0, 10));
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      marketCalendar = weekdayCalendar;
    }

    const rows = requiredTickers.map((ticker) =>
      summarizeTickerAgainstCalendar({
        ticker,
        researchStart: researchStarts.get(ticker) ?? COVERAGE_WINDOW_START,
        researchEnd,
        marketCalendar,
        observedDates: observedByTicker.get(ticker) ?? [],
      })
    );

    const totalExpected = rows.reduce((sum, row) => sum + row.expectedDays, 0);
    const totalActual = rows.reduce((sum, row) => sum + row.actualDays, 0);
    const totalTrueMissing = rows.reduce((sum, row) => sum + row.trueMissingDays, 0);
    const notIngestedTickers = rows
      .filter((row) => !row.isIngested)
      .map((row) => row.ticker)
      .sort();

    return {
      rows,
      requiredTickers,
      notIngestedTickers,
      ingestedTickers: rows.filter((row) => row.isIngested).length,
      completeness: totalExpected > 0 ? Math.min((totalActual / totalExpected) * 100, 100) : null,
      totalExpected,
      totalActual,
      totalTrueMissing,
      trueMissingRate: totalExpected > 0 ? totalTrueMissing / totalExpected : 0,
      marketCalendarDays: marketCalendar.length,
    };
  } catch (err) {
    console.error("getRequiredTickerResearchSummary exception:", err);
    return empty;
  }
}

export async function getMonitoredBenchmarkCoverage(
  dataCutoffDate: string | null,
  prefetchedRanges?: TickerDateRange[]
): Promise<BenchmarkCoverage[] | null> {
  const researchEnd = dataCutoffDate ?? getLastCompleteTradingDayUtc();
  const ranges = prefetchedRanges ?? (await getAllTickerStats());
  const researchStarts = buildRequiredTickerResearchStarts(ranges);
  const benchmarkStarts = new Map<string, string>();

  for (const ticker of BENCHMARK_OPTIONS) {
    benchmarkStarts.set(ticker, researchStarts.get(ticker) ?? COVERAGE_WINDOW_START);
  }

  const minResearchStart = [...benchmarkStarts.values()].sort()[0] ?? COVERAGE_WINDOW_START;
  const rangeByTicker = new Map<string, TickerDateRange>(
    ranges.map((row) => [row.ticker.toUpperCase(), row])
  );

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("prices")
      .select("ticker, date")
      .in("ticker", [...BENCHMARK_OPTIONS])
      .gte("date", minResearchStart)
      .lte("date", researchEnd)
      .order("date", { ascending: true });

    if (error) {
      console.error("getMonitoredBenchmarkCoverage error:", error.message);
      return null;
    }

    const observedByTicker = new Map<string, string[]>();
    for (const ticker of BENCHMARK_OPTIONS) {
      observedByTicker.set(ticker, []);
    }

    for (const row of data ?? []) {
      const ticker = String(row.ticker ?? "").toUpperCase();
      const date = String(row.date ?? "");
      const bucket = observedByTicker.get(ticker);
      if (!bucket || !date) continue;
      if (bucket.at(-1) !== date) {
        bucket.push(date);
      }
    }

    return BENCHMARK_OPTIONS.map((ticker) => {
      const range = rangeByTicker.get(ticker) ?? null;
      const stats: CoverageStatsSnapshot | undefined = range
        ? {
            firstDate: range.firstDate,
            lastDate: range.lastDate,
          }
        : undefined;
      const benchmarkCoverage = computeBenchmarkCoverage({
        benchmarkTicker: ticker,
        windowStart: benchmarkStarts.get(ticker) ?? COVERAGE_WINDOW_START,
        windowEnd: researchEnd,
        cutoffDate: researchEnd,
        stats,
        benchmarkDates: observedByTicker.get(ticker) ?? [],
      });
      const inceptionDate = TICKER_INCEPTION_DATES[ticker] ?? null;
      const coveragePercent =
        benchmarkCoverage.expectedDays > 0
          ? Math.min((benchmarkCoverage.actualDays / benchmarkCoverage.expectedDays) * 100, 100)
          : 0;
      const status: BenchmarkCoverage["status"] =
        benchmarkCoverage.status === "good"
          ? "ok"
          : benchmarkCoverage.actualDays === 0
            ? "not_ingested"
            : benchmarkCoverage.status === "warning"
              ? "partial"
              : "missing";

      return {
        ticker,
        actualDays: benchmarkCoverage.actualDays,
        expectedDays: benchmarkCoverage.expectedDays,
        missingDays: benchmarkCoverage.missingDays,
        coveragePercent,
        trueMissingRate: benchmarkCoverage.trueMissingRate,
        windowStart: benchmarkCoverage.windowStartUsed,
        windowEnd: benchmarkCoverage.windowEndUsed,
        latestDate: range?.lastDate ?? null,
        earliestDate: range?.firstDate ?? null,
        needsHistoricalBackfill:
          range?.firstDate != null && inceptionDate != null
            ? range.firstDate > inceptionDate
            : false,
        status,
      };
    });
  } catch (err) {
    console.error("getMonitoredBenchmarkCoverage exception:", err);
    return null;
  }
}

/** Count Mon–Fri business days between two inclusive YYYY-MM-DD date strings. */
function countBusinessDays(startStr: string, endStr: string): number {
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

function maxIsoDateNullable(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function buildRequiredTickerResearchStarts(ranges: TickerDateRange[]): Map<string, string> {
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

function summarizeTickerAgainstCalendar(params: {
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

export async function getDataHealthSummary(
  prefetchedRanges?: TickerDateRange[],
  prefetchedDataState?: DataStateSummary
): Promise<DataHealthSummary> {
  const empty: DataHealthSummary = {
    tickersCount: 0,
    dateStart: null,
    dateEnd: null,
    businessDaysInWindow: 0,
    expectedTickerDays: 0,
    actualTickerDays: 0,
    missingTickerDays: 0,
    completenessPercent: null,
    lastUpdatedAt: null,
  };

  try {
    const supabase = await createClient();

    let tickersCount = 0;
    let dateStart: string | null = null;
    let actualTickerDays = 0;

    // If caller provides cached ranges, compute directly without a DB round-trip.
    if (prefetchedRanges && prefetchedRanges.length > 0) {
      tickersCount = prefetchedRanges.length;
      dateStart = prefetchedRanges.reduce<string | null>(
        (min, r) => (!min || r.firstDate < min ? r.firstDate : min),
        null
      );
      actualTickerDays = prefetchedRanges.reduce((sum, r) => sum + (r.actualDays ?? 0), 0);
    }

    const dataState = prefetchedDataState ?? (await getDataState());
    const dateEnd = dataState.dataCutoffDate;

    if (tickersCount === 0) {
      type StatsRow = {
        symbol: string;
        first_date: string;
        distinct_days: string | number;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statsRes = (await (supabase as any)
        .from("ticker_stats")
        .select("symbol, first_date, distinct_days")) as {
        data: StatsRow[] | null;
        error: { message: string } | null;
      };

      if (!statsRes.error && statsRes.data) {
        tickersCount = statsRes.data.length;
        dateStart = statsRes.data.reduce<string | null>(
          (min, row) => (!min || row.first_date < min ? row.first_date : min),
          null
        );
        actualTickerDays = statsRes.data.reduce(
          (sum, row) => sum + Number(row.distinct_days ?? 0),
          0
        );
      } else if (dateEnd) {
        type AggRow = {
          ticker_count: number;
          min_date: string | null;
          max_date: string | null;
          actual_rows: number;
        };
        const { data: aggData } = (await supabase.rpc("get_data_health_agg")) as unknown as {
          data: AggRow | null;
          error: { message: string } | null;
        };
        tickersCount = aggData?.ticker_count ?? 0;
        dateStart = aggData?.min_date ?? null;
        actualTickerDays = aggData?.actual_rows ?? 0;
      }
    }

    let businessDaysInWindow = 0;
    let expectedTickerDays = 0;
    let missingTickerDays = 0;
    let completenessPercent: number | null = null;

    if (tickersCount > 0 && dateStart && dateEnd) {
      businessDaysInWindow = countBusinessDays(dateStart, dateEnd);
      expectedTickerDays = businessDaysInWindow * tickersCount;
      missingTickerDays = Math.max(expectedTickerDays - actualTickerDays, 0);
      completenessPercent =
        expectedTickerDays > 0
          ? Math.min((actualTickerDays / expectedTickerDays) * 100, 100)
          : null;
    }

    return {
      tickersCount,
      dateStart,
      dateEnd,
      businessDaysInWindow,
      expectedTickerDays,
      actualTickerDays,
      missingTickerDays,
      completenessPercent,
      lastUpdatedAt: dataState.lastUpdateAt,
    };
  } catch (err) {
    console.error("getDataHealthSummary exception:", err);
    return empty;
  }
}

export async function getTopMissingTickers(
  limit: number,
  businessDaysInWindow: number
): Promise<TickerMissingness[]> {
  if (businessDaysInWindow === 0) return [];

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("get_ticker_day_counts");

    if (error) {
      // Silently skip if the RPC function doesn't exist yet (migration pending)
      if (!error.message.includes("Could not find the function")) {
        console.error("getTopMissingTickers error:", error.message);
      }
      return [];
    }

    const rows = (data ?? []) as { ticker: string; actual_days: number }[];
    return rows
      .map(({ ticker, actual_days }) => {
        const actualDays = Number(actual_days);
        const missingDays = Math.max(businessDaysInWindow - actualDays, 0);
        const coveragePercent = Math.min((actualDays / businessDaysInWindow) * 100, 100);
        return { ticker, actualDays, missingDays, coveragePercent };
      })
      .filter((r) => r.missingDays > 0)
      .sort((a, b) => b.missingDays - a.missingDays)
      .slice(0, limit);
  } catch (err) {
    console.error("getTopMissingTickers exception:", err);
    return [];
  }
}

export async function getBenchmarkCoverage(
  ticker: string,
  dateStart: string | null,
  dateEnd: string | null,
  businessDaysInWindow: number
): Promise<BenchmarkCoverage | null> {
  if (!dateStart || !dateEnd || businessDaysInWindow === 0) return null;

  // Normalize: yfinance stores tickers as uppercase, user input may differ
  const normalizedTicker = ticker.trim().toUpperCase();

  try {
    const supabase = createAdminClient();
    const { count, error } = await supabase
      .from("prices")
      .select("*", { count: "exact", head: true })
      .eq("ticker", normalizedTicker)
      .gte("date", dateStart)
      .lte("date", dateEnd);

    if (error) {
      console.error("getBenchmarkCoverage error:", error.message);
      return null;
    }

    const actualDays = count ?? 0;

    // When 0 rows found: run a diagnostic to detect symbol mismatches or missing ingestion
    let debugSimilarTickers: string[] | undefined;
    let latestDate: string | null = null;
    let earliestDate: string | null = null;
    if (actualDays === 0) {
      const prefix = normalizedTicker.slice(0, 3);
      const { data: similarRows } = await supabase
        .from("prices")
        .select("ticker")
        .ilike("ticker", `%${prefix}%`)
        .limit(30);
      const similar = [...new Set((similarRows ?? []).map((r) => r.ticker as string))].slice(0, 10);
      console.warn(
        `[getBenchmarkCoverage] 0 rows for "${normalizedTicker}" in prices [${dateStart}–${dateEnd}]. ` +
          `Similar tickers found: ${similar.join(", ") || "(none)"}. ` +
          `If empty, "${normalizedTicker}" is not in the prices table — ingest it or check the benchmark setting.`
      );
      if (process.env.NODE_ENV !== "production") {
        debugSimilarTickers = similar;
      }
    } else {
      // Fetch the earliest and latest dates for this ticker (may differ from global window)
      const [latestRow, earliestRow] = await Promise.all([
        supabase
          .from("prices")
          .select("date")
          .eq("ticker", normalizedTicker)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("prices")
          .select("date")
          .eq("ticker", normalizedTicker)
          .order("date", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);
      latestDate = latestRow.data?.date ?? null;
      earliestDate = earliestRow.data?.date ?? null;
    }

    const expectedDays = businessDaysInWindow;
    const missingDays = Math.max(expectedDays - actualDays, 0);
    const coveragePercent = expectedDays > 0 ? Math.min((actualDays / expectedDays) * 100, 100) : 0;

    const status: BenchmarkCoverage["status"] =
      actualDays === 0
        ? "not_ingested"
        : coveragePercent < 50
          ? "missing"
          : coveragePercent < 99
            ? "partial"
            : "ok";

    const needsHistoricalBackfill = earliestDate !== null && earliestDate > COVERAGE_WINDOW_START;

    return {
      ticker: normalizedTicker,
      actualDays,
      expectedDays,
      missingDays,
      coveragePercent,
      latestDate,
      earliestDate,
      needsHistoricalBackfill,
      status,
      debugSimilarTickers,
    };
  } catch (err) {
    console.error("getBenchmarkCoverage exception:", err);
    return null;
  }
}

export async function getLatestDataIngestJob(ticker: string): Promise<DataIngestJobStatus | null> {
  const normalizedTicker = ticker.trim().toUpperCase();
  try {
    const supabase = createAdminClient();
    // Fetch the 20 most-recent data_ingest jobs and filter by ticker client-side
    // (JSONB @> filtering may not be available in all environments)
    const { data, error } = await supabase
      .from("jobs")
      .select(
        "id, status, stage, progress, error_message, created_at, started_at, updated_at, next_retry_at, attempt_count, payload, job_type"
      )
      .eq("job_type", "data_ingest")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      // Column likely doesn't exist yet — migration not applied, silently skip
      if (error.message.includes("job_type") || error.message.includes("does not exist"))
        return null;
      console.error("getLatestDataIngestJob error:", error.message);
      return null;
    }

    const match = (data ?? []).find((j) => {
      const p = j.payload as { ticker?: string } | null;
      return p?.ticker?.toUpperCase() === normalizedTicker;
    });
    if (!match) return null;

    return {
      id: match.id,
      status: match.status,
      stage: match.stage,
      progress: match.progress,
      error_message: match.error_message,
      created_at: match.created_at ?? null,
      started_at: match.started_at ?? null,
      updated_at: match.updated_at ?? null,
      next_retry_at: match.next_retry_at ?? null,
      attempt_count: match.attempt_count ?? null,
    };
  } catch (err) {
    console.error("getLatestDataIngestJob exception:", err);
    return null;
  }
}

/**
 * Fetch coverage for all BENCHMARK_OPTIONS using a server-side GROUP BY RPC.
 * Returns null on error so callers can distinguish "query failed" from "not ingested".
 */
export async function getAllBenchmarkCoverage(
  dateStart: string | null,
  dateEnd: string | null,
  businessDaysInWindow: number
): Promise<BenchmarkCoverage[] | null> {
  const tickers = [...BENCHMARK_OPTIONS];
  try {
    const supabase = createAdminClient();

    // Fast path: read coverage_window_days from ticker_stats cache.
    // coverage_window_days = COUNT(*) WHERE date >= '2015-01-02' (COVERAGE_WINDOW_START).
    // This avoids a GROUP BY on prices entirely (migration 20260316).
    // Falls back to the get_benchmark_coverage_agg RPC if the column is missing
    // (pre-migration environment), and then to row-level fetch as a last resort.
    type StatsRow = {
      symbol: string;
      first_date: string;
      last_date: string;
      coverage_window_days: string | number | null;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: statsData, error: statsError } = (await (supabase as any)
      .from("ticker_stats")
      .select("symbol, first_date, last_date, coverage_window_days")
      .in("symbol", tickers)) as { data: StatsRow[] | null; error: { message: string } | null };

    // Fast path is usable when: no error, rows returned, and at least one row
    // has coverage_window_days populated (i.e. migration 20260316 was applied).
    const fastPathOk =
      !statsError &&
      statsData !== null &&
      statsData.length > 0 &&
      statsData.some((r) => r.coverage_window_days !== null);
    const useTickerStatsFastPath = fastPathOk && dateStart === COVERAGE_WINDOW_START;

    let agg: Map<string, { actualDays: number; earliest: string | null; latest: string | null }>;

    if (useTickerStatsFastPath) {
      // Build from ticker_stats — zero prices queries.
      agg = new Map();
      for (const row of statsData!) {
        agg.set(row.symbol, {
          actualDays: Number(row.coverage_window_days ?? 0),
          earliest: row.first_date ?? null,
          latest: row.last_date ?? null,
        });
      }
    } else {
      // Fallback: DB-side GROUP BY RPC (returns 1 row per ticker, not ~25k rows to JS).
      if (statsError) {
        console.warn(
          "getAllBenchmarkCoverage: ticker_stats unavailable, using RPC fallback:",
          statsError.message
        );
      }
      type AggRow = {
        ticker: string;
        actual_days: string | number;
        earliest_date: string | null;
        latest_date: string | null;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rpcData, error: rpcError } = (await (supabase as any).rpc(
        "get_benchmark_coverage_agg",
        {
          p_tickers: tickers,
          p_start: dateStart ?? "1900-01-01",
          p_end: dateEnd ?? "9999-12-31",
        }
      )) as { data: AggRow[] | null; error: { message: string } | null };

      if (rpcError) {
        if (rpcError.message.includes("Could not find the function")) {
          // RPC not deployed yet — fall back to row-level fetch
          const { data: rowData, error: rowError } = await supabase
            .from("prices")
            .select("ticker, date")
            .in("ticker", tickers)
            .gte("date", dateStart ?? "1900-01-01")
            .lte("date", dateEnd ?? "9999-12-31");

          if (rowError) {
            console.error("getAllBenchmarkCoverage fallback error:", rowError.message);
            return null;
          }

          agg = new Map();
          for (const row of rowData ?? []) {
            const t = row.ticker as string;
            const d = row.date as string;
            const existing = agg.get(t);
            if (!existing) {
              agg.set(t, { actualDays: 1, earliest: d, latest: d });
            } else {
              existing.actualDays += 1;
              if (d < (existing.earliest ?? d)) existing.earliest = d;
              if (d > (existing.latest ?? d)) existing.latest = d;
            }
          }
        } else {
          console.error("getAllBenchmarkCoverage RPC error:", rpcError.message);
          return null;
        }
      } else {
        agg = new Map();
        for (const row of rpcData ?? []) {
          agg.set(row.ticker, {
            actualDays: Number(row.actual_days),
            earliest: row.earliest_date,
            latest: row.latest_date,
          });
        }
      }
    }

    return tickers.map((ticker) => {
      const stats = agg.get(ticker);
      const actualDays = stats?.actualDays ?? 0;
      const earliestDate = stats?.earliest ?? null;
      const latestDate = stats?.latest ?? null;
      const expectedDays = businessDaysInWindow;
      const missingDays = Math.max(expectedDays - actualDays, 0);
      const coveragePercent =
        expectedDays > 0 ? Math.min((actualDays / expectedDays) * 100, 100) : 0;
      const status: BenchmarkCoverage["status"] =
        actualDays === 0
          ? "not_ingested"
          : coveragePercent < 50
            ? "missing"
            : coveragePercent < 99
              ? "partial"
              : "ok";
      const inceptionDate = TICKER_INCEPTION_DATES[ticker] ?? null;
      const needsHistoricalBackfill =
        earliestDate !== null && inceptionDate !== null && earliestDate > inceptionDate;
      return {
        ticker,
        actualDays,
        expectedDays,
        missingDays,
        coveragePercent,
        latestDate,
        earliestDate,
        needsHistoricalBackfill,
        status,
      };
    });
  } catch (err) {
    console.error("getAllBenchmarkCoverage exception:", err);
    return null;
  }
}

/**
 * Fetch the latest data_ingest_job for each ticker using the DB-side RPC
 * `get_latest_data_ingest_jobs`. Falls back to a direct table scan if the
 * RPC is not yet deployed. Never limited to 50 rows — uses DISTINCT ON per symbol.
 */
export async function getLatestDataIngestJobs(
  tickers: readonly string[]
): Promise<Record<string, DataIngestJobStatus | null>> {
  const normalized = tickers.map((t) => t.toUpperCase());
  const result: Record<string, DataIngestJobStatus | null> = {};
  for (const t of normalized) result[t] = null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;

    // Try RPC first (returns 1 row per symbol, no LIMIT needed)
    const { data: rpcData, error: rpcError } = await supabase.rpc("get_latest_data_ingest_jobs", {
      p_symbols: normalized,
    });

    if (!rpcError && Array.isArray(rpcData)) {
      for (const j of rpcData) {
        const t = String(j.symbol ?? "").toUpperCase();
        if (!normalized.includes(t)) continue;
        result[t] = {
          id: j.id,
          status: normalizeDataIngestStatus(j.status),
          stage: j.stage ?? null,
          progress: j.progress ?? 0,
          symbol: j.symbol ?? null,
          start_date: j.start_date ?? null,
          end_date: j.end_date ?? null,
          request_mode: j.request_mode ?? null,
          batch_id: j.batch_id ?? null,
          target_cutoff_date: j.target_cutoff_date ?? null,
          requested_by: j.requested_by ?? null,
          error: j.error ?? null,
          error_message: j.error ?? null,
          created_at: j.created_at ?? null,
          started_at: j.started_at ?? null,
          updated_at: j.updated_at ?? null,
          finished_at: j.finished_at ?? null,
          last_heartbeat_at: j.last_heartbeat_at ?? null,
          rows_inserted: j.rows_inserted ?? null,
          next_retry_at: j.next_retry_at ?? null,
          attempt_count: j.attempt_count ?? null,
        };
      }
      return result;
    }

    // Fallback: direct scan of data_ingest_jobs (all rows per symbol, pick latest in JS)
    let { data, error } = await supabase
      .from("data_ingest_jobs")
      .select(
        "id, symbol, status, stage, progress, error, created_at, started_at, updated_at, finished_at, next_retry_at, attempt_count, start_date, end_date, request_mode, batch_id, target_cutoff_date, requested_by, last_heartbeat_at, rows_inserted"
      )
      .in("symbol", normalized)
      .order("created_at", { ascending: false });

    if (error && isMissingDataIngestExtendedColumnError(error.message)) {
      const legacyFallback = await supabase
        .from("data_ingest_jobs")
        .select(
          "id, symbol, status, stage, progress, error, created_at, started_at, updated_at, next_retry_at, attempt_count, start_date, end_date"
        )
        .in("symbol", normalized)
        .order("created_at", { ascending: false });
      data = legacyFallback.data;
      error = legacyFallback.error;
    }

    if (error) {
      console.error("getLatestDataIngestJobs fallback error:", error.message);
      return result;
    }

    for (const j of data ?? []) {
      const t = String(j.symbol ?? "").toUpperCase();
      if (!normalized.includes(t)) continue;
      if (result[t] !== null) continue; // already have a newer row
      result[t] = {
        id: j.id,
        status: normalizeDataIngestStatus(j.status),
        stage: j.stage ?? null,
        progress: j.progress ?? 0,
        symbol: j.symbol ?? null,
        start_date: j.start_date ?? null,
        end_date: j.end_date ?? null,
        request_mode: j.request_mode ?? null,
        batch_id: j.batch_id ?? null,
        target_cutoff_date: j.target_cutoff_date ?? null,
        requested_by: j.requested_by ?? null,
        error: j.error ?? null,
        error_message: j.error ?? null,
        created_at: j.created_at ?? null,
        started_at: j.started_at ?? null,
        updated_at: j.updated_at ?? null,
        finished_at: j.finished_at ?? null,
        last_heartbeat_at: j.last_heartbeat_at ?? null,
        rows_inserted: j.rows_inserted ?? null,
        next_retry_at: j.next_retry_at ?? null,
        attempt_count: j.attempt_count ?? null,
      };
    }
  } catch (err) {
    console.error("getLatestDataIngestJobs exception:", err);
  }

  return result;
}

export async function getRecentIngestionHistory(limit = 5): Promise<IngestionLogEntry[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("data_ingestion_log")
      .select("*")
      .order("ingested_at", { ascending: false })
      .limit(limit);

    if (error) {
      // Table may not exist yet if migration hasn't been applied
      console.warn("getRecentIngestionHistory:", error.message);
      return [];
    }

    return (data ?? []) as IngestionLogEntry[];
  } catch (err) {
    console.error("getRecentIngestionHistory exception:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Auto-queue benchmark ingestions
// ---------------------------------------------------------------------------

/**
 * Server-side: enqueue data_ingest_jobs for benchmark tickers that need action:
 *   - not_ingested (no price data at all)
 *   - needsHistoricalBackfill (earliestDate > inception date)
 *   - behind the current data cutoff (latestDate < data_cutoff_date)
 *
 * Skips tickers that already have an active (queued/running/retrying) job.
 * Inserts into data_ingest_jobs (explicit-schema table).
 * Deprecated for page-load use; retained for server-side repair flows.
 */
export async function autoQueueBenchmarkIngestions(
  coverages: BenchmarkCoverage[],
  tickerStats?: TickerDateRange[]
): Promise<void> {
  try {
    const dataState = await getDataState();
    const cutoffDate = dataState.dataCutoffDate ?? getLastCompleteTradingDayUtc();

    // Build a map of ticker → lastDate from ticker_stats for staleness check
    const lastDateMap = new Map<string, string>();
    for (const r of tickerStats ?? []) {
      if (r.lastDate) lastDateMap.set(r.ticker.toUpperCase(), r.lastDate);
    }

    // Determine which tickers need action (including staleness)
    const needsAction = coverages.filter((c) => {
      if (c.status === "not_ingested") return true;
      if (c.needsHistoricalBackfill) return true;
      const lastDate = lastDateMap.get(c.ticker.toUpperCase()) ?? c.latestDate;
      if (lastDate && lastDate < cutoffDate) return true;
      return false;
    });
    if (needsAction.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Fetch active jobs from data_ingest_jobs to avoid duplicates
    const { data: activeJobs } = await admin
      .from("data_ingest_jobs")
      .select("symbol, status, start_date, end_date, id")
      .in(
        "symbol",
        needsAction.map((c) => c.ticker)
      )
      .in("status", ["queued", "running", "retrying"]);

    const activeBySymbol = new Map<
      string,
      { id: string; status: string; start_date: string; end_date: string }
    >();
    for (const j of activeJobs ?? []) {
      if (!activeBySymbol.has(j.symbol)) activeBySymbol.set(j.symbol, j);
    }

    const toInsert: {
      symbol: string;
      start_date: string;
      end_date: string;
      status: string;
      stage: string;
      progress: number;
      request_mode: string;
      target_cutoff_date: string;
      requested_by: string;
    }[] = [];
    const toWiden: { id: string; start_date: string; end_date: string }[] = [];

    for (const c of needsAction) {
      const inceptionDate = TICKER_INCEPTION_DATES[c.ticker] ?? "1993-01-01";
      const lastDate = lastDateMap.get(c.ticker.toUpperCase()) ?? c.latestDate;
      const existing = activeBySymbol.get(c.ticker);

      // Determine desired start date
      let desiredStart: string;
      if (c.status === "not_ingested" || c.needsHistoricalBackfill) {
        desiredStart = inceptionDate;
      } else {
        // Incremental only
        if (!lastDate) {
          desiredStart = inceptionDate;
        } else {
          const next = new Date(lastDate);
          next.setDate(next.getDate() + 1);
          desiredStart = next.toISOString().slice(0, 10);
          if (desiredStart > cutoffDate) continue; // Already current through the cutoff
        }
      }

      if (existing) {
        if (existing.status === "queued") {
          // Widen range if needed
          const newStart = desiredStart < existing.start_date ? desiredStart : existing.start_date;
          const newEnd = cutoffDate > existing.end_date ? cutoffDate : existing.end_date;
          if (newStart !== existing.start_date || newEnd !== existing.end_date) {
            toWiden.push({ id: existing.id, start_date: newStart, end_date: newEnd });
          }
        }
        // running — leave it alone
        continue;
      }

      toInsert.push({
        symbol: c.ticker,
        start_date: desiredStart,
        end_date: cutoffDate,
        status: "queued",
        stage: "download",
        progress: 0,
        request_mode: "manual",
        target_cutoff_date: cutoffDate,
        requested_by: "auto-queue:benchmark",
      });
    }

    if (toInsert.length > 0) {
      await admin.from("data_ingest_jobs").insert(toInsert);
      console.log(
        `[auto-ingest] queued ${toInsert.length} benchmark job(s):`,
        toInsert.map((j) => j.symbol).join(", ")
      );
    }
    for (const w of toWiden) {
      await admin
        .from("data_ingest_jobs")
        .update({ start_date: w.start_date, end_date: w.end_date })
        .eq("id", w.id);
    }
    if (toWiden.length > 0) {
      console.log(`[auto-ingest] widened ${toWiden.length} queued job(s)`);
    }
  } catch (err) {
    // Non-fatal — page still renders; user can trigger manually
    console.error("[auto-ingest] autoQueueBenchmarkIngestions error:", err);
  }
}

// ---------------------------------------------------------------------------
// Auto-queue universe ticker ingestions
// ---------------------------------------------------------------------------

/**
 * Idempotently queues data_ingest_jobs for all universe preset tickers that are
 * not yet ingested or are behind the current data cutoff. Deprecated for
 * page-load use; duplicates are widened or skipped, not created.
 */
export async function autoQueueUniverseIngestions(
  tickerRanges: TickerDateRange[]
): Promise<{ queued: string[]; widened: string[]; skipped: string[] }> {
  const result = { queued: [] as string[], widened: [] as string[], skipped: [] as string[] };
  try {
    const dataState = await getDataState();
    const cutoffDate = dataState.dataCutoffDate ?? getLastCompleteTradingDayUtc();

    // All unique tickers from every universe preset
    const allUniverseTickers = [...new Set(Object.values(UNIVERSE_PRESETS).flat())];

    // Build map from existing ticker stats
    const statsMap = new Map<string, TickerDateRange>();
    for (const r of tickerRanges) {
      statsMap.set(r.ticker.toUpperCase(), r);
    }

    // Determine which tickers need action
    const needsAction: { ticker: string; needsFullIngest: boolean; desiredStart: string }[] = [];
    for (const ticker of allUniverseTickers) {
      const stats = statsMap.get(ticker.toUpperCase());
      const inceptionDate = TICKER_INCEPTION_DATES[ticker] ?? "2003-01-01";

      if (!stats || stats.actualDays === 0) {
        needsAction.push({ ticker, needsFullIngest: true, desiredStart: inceptionDate });
      } else if (stats.lastDate && stats.lastDate < cutoffDate) {
        const next = new Date(stats.lastDate);
        next.setDate(next.getDate() + 1);
        const nextStr = next.toISOString().slice(0, 10);
        if (nextStr <= cutoffDate) {
          needsAction.push({ ticker, needsFullIngest: false, desiredStart: nextStr });
        } else {
          result.skipped.push(ticker);
        }
      } else {
        result.skipped.push(ticker);
      }
    }

    if (needsAction.length === 0) return result;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Fetch active (queued/running) jobs to avoid duplicates
    const { data: activeJobs } = await admin
      .from("data_ingest_jobs")
      .select("symbol, status, start_date, end_date, id")
      .in(
        "symbol",
        needsAction.map((n) => n.ticker)
      )
      .in("status", ["queued", "running", "retrying"]);

    const activeBySymbol = new Map<
      string,
      { id: string; status: string; start_date: string; end_date: string }
    >();
    for (const j of activeJobs ?? []) {
      if (!activeBySymbol.has(j.symbol)) activeBySymbol.set(j.symbol, j);
    }

    const toInsert: {
      symbol: string;
      start_date: string;
      end_date: string;
      status: string;
      stage: string;
      progress: number;
      request_mode: string;
      target_cutoff_date: string;
      requested_by: string;
    }[] = [];

    for (const { ticker, desiredStart } of needsAction) {
      const existing = activeBySymbol.get(ticker);
      if (existing) {
        if (existing.status === "queued") {
          const newStart = desiredStart < existing.start_date ? desiredStart : existing.start_date;
          const newEnd = cutoffDate > existing.end_date ? cutoffDate : existing.end_date;
          if (newStart !== existing.start_date || newEnd !== existing.end_date) {
            await admin
              .from("data_ingest_jobs")
              .update({ start_date: newStart, end_date: newEnd })
              .eq("id", existing.id);
            result.widened.push(ticker);
          } else {
            result.skipped.push(ticker);
          }
        } else {
          // running — leave alone
          result.skipped.push(ticker);
        }
        continue;
      }

      toInsert.push({
        symbol: ticker,
        start_date: desiredStart,
        end_date: cutoffDate,
        status: "queued",
        stage: "download",
        progress: 0,
        request_mode: "manual",
        target_cutoff_date: cutoffDate,
        requested_by: "auto-queue:universe",
      });
    }

    if (toInsert.length > 0) {
      await admin.from("data_ingest_jobs").insert(toInsert);
      result.queued.push(...toInsert.map((j) => j.symbol));
      console.log(
        `[auto-ingest] queued ${toInsert.length} universe job(s):`,
        result.queued.join(", ")
      );
    }
  } catch (err) {
    // Non-fatal — page still renders
    console.error("[auto-ingest] autoQueueUniverseIngestions error:", err);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Backtest window verification
// ---------------------------------------------------------------------------

export const BACKTEST_MIN_SPAN_DAYS = 730;
export const BACKTEST_MIN_DATA_POINTS = 500;
export const BACKTEST_END_DATE_TOLERANCE_TRADING_DAYS = 5;

export type BacktestAuditOutcome = "pass" | "fail" | "skip";

export type BacktestWindowSummaryRow = {
  run_id: string;
  name: string;
  strategy_id: string;
  status: RunStatus;
  start_date: string;
  end_date: string;
  span_days: number;
  requested_span_days: number;
  equity_start_date: string | null;
  equity_end_date: string | null;
  equity_span_days: number | null;
  end_gap_trading_days: number | null;
  data_points: number;
  meets_min_span: boolean;
  meets_min_points: boolean;
  meets_end_tolerance: boolean;
  audit_outcome: BacktestAuditOutcome;
};

type BacktestAuditRunRow = {
  id: string;
  name: string;
  strategy_id: string;
  status: RunStatus;
  start_date: string;
  end_date: string;
};

type EquityCurveAuditStats = {
  data_points: number;
  equity_start_date: string | null;
  equity_end_date: string | null;
};

function getCalendarDaySpan(startDate: string, endDate: string): number {
  if (!startDate || !endDate || endDate < startDate) return 0;
  const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
  const endMs = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.floor((endMs - startMs) / (1000 * 60 * 60 * 24));
}

function getTradingDayGap(dateA: string | null, dateB: string | null): number | null {
  if (!dateA || !dateB) return null;
  if (dateA === dateB) return 0;
  const startDate = dateA <= dateB ? dateA : dateB;
  const endDate = dateA <= dateB ? dateB : dateA;
  return Math.max(countBusinessDays(startDate, endDate) - 1, 0);
}

/**
 * Fetches equity_curve audit stats for multiple runs in a single DB round-trip.
 * Returns a Map keyed by run_id. Missing run_ids get { data_points: 0, ... }.
 */
async function getEquityCurveAuditStatsBatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  runIds: string[]
): Promise<Map<string, EquityCurveAuditStats>> {
  const result = new Map<string, EquityCurveAuditStats>();
  for (const id of runIds) {
    result.set(id, { data_points: 0, equity_start_date: null, equity_end_date: null });
  }
  if (runIds.length === 0) return result;

  const { data, error } = await admin
    .from("equity_curve")
    .select("run_id, date")
    .in("run_id", runIds);

  if (error) {
    throw new Error(`equity_curve batch query failed: ${error.message}`);
  }

  for (const row of data ?? []) {
    const id = String(row.run_id);
    const date = String(row.date);
    const existing = result.get(id);
    if (!existing) {
      result.set(id, { data_points: 1, equity_start_date: date, equity_end_date: date });
    } else {
      const startDate =
        existing.equity_start_date === null || date < existing.equity_start_date
          ? date
          : existing.equity_start_date;
      const endDate =
        existing.equity_end_date === null || date > existing.equity_end_date
          ? date
          : existing.equity_end_date;
      result.set(id, {
        data_points: existing.data_points + 1,
        equity_start_date: startDate,
        equity_end_date: endDate,
      });
    }
  }

  return result;
}

/**
 * Returns a per-run backtest-window summary for visible runs.
 * Row counts and coverage dates come directly from equity_curve using the
 * service-role client so the audit cannot silently truncate at 1000 rows or
 * collapse to zero under RLS.
 */
export async function getRunsBacktestWindowSummary(): Promise<BacktestWindowSummaryRow[]> {
  try {
    const supabase = await createClient();

    const { data: runs, error: runsError } = await supabase
      .from("runs")
      .select("id, name, strategy_id, status, start_date, end_date")
      .order("created_at", { ascending: false });

    if (runsError) {
      console.error("getRunsBacktestWindowSummary runs error:", runsError.message);
      return [];
    }
    if (!runs?.length) return [];

    const admin = createAdminClient();
    const runIds = (runs as BacktestAuditRunRow[]).map((r) => r.id);
    const statsMap = await getEquityCurveAuditStatsBatch(admin, runIds);
    const summary: BacktestWindowSummaryRow[] = (runs as BacktestAuditRunRow[]).map((run) => {
      const stats = statsMap.get(run.id) ?? {
        data_points: 0,
        equity_start_date: null,
        equity_end_date: null,
      };
      const requestedSpanDays = getCalendarDaySpan(run.start_date, run.end_date);
      const equitySpanDays =
        stats.equity_start_date && stats.equity_end_date
          ? getCalendarDaySpan(stats.equity_start_date, stats.equity_end_date)
          : null;
      const spanDays = Math.max(requestedSpanDays, equitySpanDays ?? 0);
      const endGapTradingDays = getTradingDayGap(stats.equity_end_date, run.end_date);
      const meetsMinPoints = stats.data_points >= BACKTEST_MIN_DATA_POINTS;
      const meetsMinSpan = spanDays >= BACKTEST_MIN_SPAN_DAYS;
      const meetsEndTolerance =
        endGapTradingDays != null && endGapTradingDays <= BACKTEST_END_DATE_TOLERANCE_TRADING_DAYS;

      let auditOutcome: BacktestAuditOutcome = "skip";
      if (run.status === "completed") {
        auditOutcome =
          stats.data_points > 0 && meetsMinPoints && meetsMinSpan && meetsEndTolerance
            ? "pass"
            : "fail";
      }

      return {
        run_id: run.id,
        name: run.name,
        strategy_id: run.strategy_id,
        status: run.status,
        start_date: run.start_date,
        end_date: run.end_date,
        span_days: spanDays,
        requested_span_days: requestedSpanDays,
        equity_start_date: stats.equity_start_date,
        equity_end_date: stats.equity_end_date,
        equity_span_days: equitySpanDays,
        end_gap_trading_days: endGapTradingDays,
        data_points: stats.data_points,
        meets_min_span: meetsMinSpan,
        meets_min_points: meetsMinPoints,
        meets_end_tolerance: meetsEndTolerance,
        audit_outcome: auditOutcome,
      };
    });

    // Console-log summary for server-side audit visibility.
    console.log(
      "[backtest-audit]",
      JSON.stringify(
        summary.map(
          ({
            run_id,
            name,
            status,
            span_days,
            data_points,
            equity_start_date,
            equity_end_date,
            end_gap_trading_days,
            audit_outcome,
          }) => ({
            run_id,
            name,
            status,
            span_days,
            data_points,
            equity_start_date,
            equity_end_date,
            end_gap_trading_days,
            audit_outcome,
          })
        )
      )
    );

    return summary;
  } catch (err) {
    console.error("getRunsBacktestWindowSummary exception:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Active scheduled-refresh job count (for data-page banner)
// ---------------------------------------------------------------------------

/**
 * Returns the number of scheduled-refresh data_ingest_jobs currently queued,
 * running, or retrying. Manual/preflight jobs are excluded so the banner only
 * reflects cutoff-advancing refresh batches.
 * Returns 0 on error (non-fatal).
 */
export async function getActiveIngestJobCount(): Promise<number> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error } = await (supabase as any)
      .from("data_ingest_jobs")
      .select("*", { count: "exact", head: true })
      .in("status", ["queued", "running", "retrying"])
      .not("batch_id", "is", null);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function getPositionsByRunId(runId: string): Promise<PositionRow[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("positions")
      .select("*")
      .eq("run_id", runId)
      .order("date", { ascending: false })
      .order("symbol", { ascending: true })
      .limit(2000);

    if (error) {
      if (isMissingPositionsTableError(error.message)) {
        return [];
      }
      console.error("getPositionsByRunId error:", error.message);
      return [];
    }
    return (data ?? []) as PositionRow[];
  } catch (err) {
    console.error("getPositionsByRunId exception:", err);
    return [];
  }
}

export async function getUserSettings(): Promise<UserSettings | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("user_settings").select("*").maybeSingle();

    if (error || !data) return null;
    return data as UserSettings;
  } catch (err) {
    console.error("getUserSettings exception:", err);
    return null;
  }
}

export async function upsertUserSettings(
  settings: Partial<Omit<UserSettings, "user_id" | "updated_at">>
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: user.id,
      ...settings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw new Error(error.message);
}

export async function getBenchmarkOverlapStateForRun(
  run: RunBenchmarkContext
): Promise<BenchmarkOverlapState> {
  const benchmark = getRunBenchmark(run);
  const fallbackPossible = inferPossibleOverlapFromUniverse({
    benchmark,
    strategyId: run.strategy_id,
    universeSymbols: run.universe_symbols,
  });

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("positions")
      .select("date, symbol, weight")
      .eq("run_id", run.id)
      .order("date", { ascending: false })
      .order("symbol", { ascending: true })
      .limit(50);

    if (error) {
      return { confirmed: false, possible: fallbackPossible };
    }

    const positions = (data ?? []) as Pick<PositionRow, "date" | "symbol" | "weight">[];
    if (positions.length === 0) {
      return { confirmed: false, possible: fallbackPossible };
    }

    return {
      confirmed: isBenchmarkHeldAtLatestRebalance(positions, benchmark),
      possible: false,
    };
  } catch {
    return { confirmed: false, possible: fallbackPossible };
  }
}

// ---------------------------------------------------------------------------
// Inception-aware data health
// ---------------------------------------------------------------------------

/**
 * Reads per-ticker stats from the ticker_stats cache table (one row per ticker).
 * Fast: no GROUP BY over prices. Maintained by Python worker after each data_ingest job.
 * Falls back to getTickerDateRanges() if the table doesn't exist yet.
 */
type TickerStatsRow = {
  symbol: string;
  first_date: string;
  last_date: string;
  distinct_days: string | number;
  max_gap_days_window: string | number | null;
  updated_at: string | null;
};

/**
 * Cross-request cache for ticker_stats using the admin (service-role) client
 * which doesn't require user cookies. TTL: 2 minutes.
 * ticker_stats is global (not user-scoped), so sharing the cache is safe.
 */
const _getCachedTickerStats = unstable_cache(
  async (): Promise<TickerDateRange[]> => {
    const supabase = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = (await (supabase as any)
      .from("ticker_stats")
      .select("symbol, first_date, last_date, distinct_days, max_gap_days_window, updated_at")) as {
      data: TickerStatsRow[] | null;
      error: { message: string } | null;
    };
    if (error || !data || data.length === 0) return [];
    return data.map((r) => ({
      ticker: r.symbol,
      firstDate: r.first_date,
      lastDate: r.last_date,
      actualDays: Number(r.distinct_days),
      maxGapDays: r.max_gap_days_window != null ? Number(r.max_gap_days_window) : undefined,
      updatedAt: r.updated_at ?? undefined,
    }));
  },
  ["ticker-stats"],
  { revalidate: 120, tags: ["ticker-stats"] }
);

export async function getAllTickerStats(): Promise<TickerDateRange[]> {
  try {
    // Try the cross-request cache first (admin client, no cookies).
    // Falls back to the per-request client path if admin key is unavailable.
    const cached = await _getCachedTickerStats();
    if (cached.length > 0) return cached;
  } catch {
    // Admin key missing or cache unavailable — fall through to live query.
  }

  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = (await (supabase as any)
      .from("ticker_stats")
      .select("symbol, first_date, last_date, distinct_days, max_gap_days_window, updated_at")) as {
      data: TickerStatsRow[] | null;
      error: { message: string } | null;
    };
    if (error) {
      if (
        error.message.includes("does not exist") ||
        error.message.includes("relation") ||
        error.message.includes("schema cache")
      ) {
        // Migration not yet applied — fall back to legacy full-table RPC
        return getTickerDateRanges();
      }
      console.error("getAllTickerStats error:", error.message);
      return [];
    }
    // Table exists but hasn't been populated yet (migration applied before worker ran).
    // Fall back to live query so existing prices are still discovered.
    if ((data ?? []).length === 0) {
      return getTickerDateRanges();
    }
    return (data ?? []).map((r) => ({
      ticker: r.symbol,
      firstDate: r.first_date,
      lastDate: r.last_date,
      actualDays: Number(r.distinct_days),
      maxGapDays: r.max_gap_days_window != null ? Number(r.max_gap_days_window) : undefined,
      updatedAt: r.updated_at ?? undefined,
    }));
  } catch (err) {
    console.error("getAllTickerStats exception:", err);
    return [];
  }
}

/**
 * Fetches first_date, last_date, and actual_days per ticker from the DB.
 * Requires migration 20260309_ticker_date_ranges.sql to be applied.
 * Returns an empty array gracefully if the RPC doesn't exist yet.
 * @deprecated Use getAllTickerStats() which reads from the fast ticker_stats cache.
 */
export async function getTickerDateRanges(): Promise<TickerDateRange[]> {
  try {
    const supabase = await createClient();
    type RawRow = {
      ticker: string;
      first_date: string;
      last_date: string;
      actual_days: string | number;
    };
    const { data, error } = (await supabase.rpc("get_ticker_date_ranges")) as unknown as {
      data: RawRow[] | null;
      error: { message: string } | null;
    };
    if (error) {
      if (!error.message.includes("Could not find the function")) {
        console.error("getTickerDateRanges error:", error.message);
      }
      return [];
    }
    return (data ?? []).map((r) => ({
      ticker: r.ticker,
      firstDate: r.first_date,
      lastDate: r.last_date,
      actualDays: Number(r.actual_days),
    }));
  } catch (err) {
    console.error("getTickerDateRanges exception:", err);
    return [];
  }
}

// computeUniverseValidFrom is a pure function defined in lib/universe-config.ts
// and re-exported from there so client components and tests can import it
// without hitting the server-only constraint.
export { computeUniverseValidFrom } from "@/lib/universe-config";

export async function getUniverseConstraintsSnapshot(
  universe: UniverseId,
  prefetchedRanges?: TickerDateRange[]
): Promise<UniverseConstraintsSnapshot> {
  const [ranges, dataState] = await Promise.all([
    prefetchedRanges ? Promise.resolve(prefetchedRanges) : getAllTickerStats(),
    getDataState(),
  ]);

  const summary = summarizeUniverseConstraints(universe, ranges);
  return {
    universe,
    universeEarliestStart: summary.earliestStart,
    universeValidFrom: summary.validFrom,
    missingTickers: summary.missingTickers,
    ingestedCount: summary.ingestedCount,
    totalCount: summary.totalCount,
    ready: summary.ready,
    dataCutoffDate: dataState.dataCutoffDate,
  };
}

/**
 * Returns inception-aware missingness for each ticker that has data.
 * "True missing" = gaps within the ticker's own [firstDate, lastDate] window.
 * "Pre-inception" = business days in [globalStart, firstDate) — not an error.
 * Pass prefetchedRanges to avoid an extra DB round-trip when caller already has stats.
 */
export async function getTopMissingTickersV2(
  limit: number,
  globalStart: string | null,
  globalEnd: string | null,
  prefetchedRanges?: TickerDateRange[]
): Promise<TickerMissingnessV2[]> {
  const ranges = prefetchedRanges ?? (await getAllTickerStats());
  if (!ranges.length) return [];

  const effectiveGlobalStart =
    globalStart ??
    ranges.reduce(
      (min, r) => (!min || r.firstDate < min ? r.firstDate : min),
      null as string | null
    ) ??
    "";

  const rows: TickerMissingnessV2[] = ranges.map((r) => {
    const expectedDays = countBusinessDays(r.firstDate, r.lastDate);
    const trueMissingDays = Math.max(expectedDays - r.actualDays, 0);
    // Business days from globalStart up to (but not including) firstDate
    const dayBeforeFirst = (() => {
      const d = new Date(`${r.firstDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const preInceptionDays =
      effectiveGlobalStart < r.firstDate
        ? countBusinessDays(effectiveGlobalStart, dayBeforeFirst)
        : 0;
    const coveragePercent =
      expectedDays > 0 ? Math.min((r.actualDays / expectedDays) * 100, 100) : 100;

    return {
      ticker: r.ticker,
      firstDate: r.firstDate,
      lastDate: r.lastDate,
      actualDays: r.actualDays,
      expectedDays,
      trueMissingDays,
      preInceptionDays,
      coveragePercent,
    };
  });

  // Filter to window if globalEnd provided
  const filtered = globalEnd ? rows.filter((r) => r.firstDate <= globalEnd) : rows;

  return filtered
    .filter((r) => r.trueMissingDays > 0)
    .sort((a, b) => b.trueMissingDays - a.trueMissingDays)
    .slice(0, limit);
}

/**
 * Returns tickers from all universe presets that have zero rows in the prices table.
 * Pass prefetchedRanges to avoid an extra DB round-trip when caller already has stats.
 */
export async function getNotIngestedUniverseTickers(
  prefetchedRanges?: TickerDateRange[]
): Promise<string[]> {
  const ranges = prefetchedRanges ?? (await getAllTickerStats());
  const ingested = new Set(ranges.map((r) => r.ticker));
  const allTickers = new Set<string>();
  for (const tickers of Object.values(UNIVERSE_PRESETS)) {
    for (const t of tickers) allTickers.add(t);
  }
  return [...allTickers].filter((t) => !ingested.has(t)).sort();
}

function getEffectiveIngestProgress(status: string, progress: number | null | undefined): number {
  const normalized = normalizeDataIngestStatus(status);
  if (normalized === "succeeded") return 100;
  if (normalized === "retrying") return Math.min(progress ?? 0, 95);
  return progress ?? 0;
}

// ---------------------------------------------------------------------------
// Ingest progress for waiting_for_data runs
// ---------------------------------------------------------------------------

export type IngestProgress = {
  /** Total data_ingest_jobs linked to this run via requested_by_run_id. */
  totalJobs: number;
  /** Jobs with status = 'succeeded'. */
  completedJobs: number;
  /**
   * Weighted average of progress (0–100) across all ingest jobs.
   * Succeeded jobs contribute 100. Used for the aggregated progress bar.
   */
  avgProgress: number;
  /**
   * Earliest started_at across all ingest jobs, for ETA computation.
   * Null until at least one job has started.
   */
  minStartedAt: string | null;
  /** Per-symbol detail for tooltip / diagnostics. */
  symbols: Array<{ symbol: string; status: string; progress: number }>;
};

/**
 * Returns aggregated ingest progress for a waiting_for_data run.
 * Queries data_ingest_jobs WHERE requested_by_run_id = runId.
 * Returns null if there are no ingest jobs (e.g. run was already READY).
 */
export async function getIngestProgressForRun(runId: string): Promise<IngestProgress | null> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("data_ingest_jobs")
    .select("symbol, status, progress, started_at")
    .eq("requested_by_run_id", runId);

  if (error) {
    console.error("[getIngestProgressForRun] query error:", error.message);
    return null;
  }
  if (!data || data.length === 0) return null;

  type Row = { symbol: string; status: string; progress: number; started_at: string | null };
  const rows = data as Row[];
  const totalJobs = rows.length;
  const completedJobs = rows.filter(
    (r) => normalizeDataIngestStatus(r.status) === "succeeded"
  ).length;

  // Succeeded jobs contribute 100 to the average even if they stored 100 already.
  const totalProgress = rows.reduce(
    (sum, r) => sum + getEffectiveIngestProgress(r.status, r.progress),
    0
  );
  const avgProgress = Math.round(totalProgress / totalJobs);

  const startedAts = rows.map((r) => r.started_at).filter(Boolean) as string[];
  const minStartedAt = startedAts.length > 0 ? startedAts.reduce((a, b) => (a < b ? a : b)) : null;

  return {
    totalJobs,
    completedJobs,
    avgProgress,
    minStartedAt,
    symbols: rows.map((r) => ({ symbol: r.symbol, status: r.status, progress: r.progress ?? 0 })),
  };
}

export async function getUniverseBatchStatus(
  batchId: string
): Promise<UniverseBatchStatusSummary | null> {
  if (!batchId) return null;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("data_ingest_jobs")
    .select("symbol, status, progress, next_retry_at")
    .eq("batch_id", batchId);

  if (error) {
    console.error("[getUniverseBatchStatus] query error:", error.message);
    return null;
  }

  type Row = {
    symbol: string;
    status: string;
    progress: number | null;
    next_retry_at: string | null;
  };

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return null;

  const totalJobs = rows.length;
  const { status, completedJobs, avgProgress } = classifyUniverseBatchStatus(rows);

  return {
    batchId,
    status,
    totalJobs,
    completedJobs,
    avgProgress,
    symbols: rows.map((row) => ({
      symbol: row.symbol,
      status: normalizeDataIngestStatus(row.status),
      progress: row.progress ?? 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// Active-runs progress: lightweight batch query for the runs list
// ---------------------------------------------------------------------------

export type RunProgressMap = Map<string, number>; // runId → progress 0-100

/**
 * Returns a progress percentage (0-100) for each provided run ID that is
 * currently active (running or waiting_for_data).
 *
 * For 'running' runs: uses the latest backtest job's progress from the jobs table.
 * For 'waiting_for_data' runs: uses averaged ingest progress from data_ingest_jobs.
 *
 * Designed for the runs list page — one call instead of N per-run queries.
 */
export async function getActiveRunsProgress(runIds: string[]): Promise<RunProgressMap> {
  if (runIds.length === 0) return new Map();
  const supabase = await createClient();

  const [jobsResult, ingestResult] = await Promise.all([
    // Backtest jobs: latest job per run_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("jobs")
      .select("run_id, progress")
      .in("run_id", runIds)
      .in("status", ["running", "queued"])
      .order("created_at", { ascending: false }),
    // Ingest jobs: all linked jobs so we can average per run
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("data_ingest_jobs")
      .select("requested_by_run_id, status, progress")
      .in("requested_by_run_id", runIds),
  ]);

  const result: RunProgressMap = new Map();

  // Build backtest progress map (first row per run_id = latest job)
  const seenBacktest = new Set<string>();
  for (const row of (jobsResult.data ?? []) as Array<{ run_id: string; progress: number }>) {
    if (!seenBacktest.has(row.run_id)) {
      seenBacktest.add(row.run_id);
      result.set(row.run_id, row.progress ?? 0);
    }
  }

  // Build ingest progress map (avg per requested_by_run_id)
  const ingestByRun = new Map<string, number[]>();
  for (const row of (ingestResult.data ?? []) as Array<{
    requested_by_run_id: string;
    status: string;
    progress: number;
  }>) {
    const rid = row.requested_by_run_id;
    if (!rid) continue;
    if (!ingestByRun.has(rid)) ingestByRun.set(rid, []);
    ingestByRun.get(rid)!.push(getEffectiveIngestProgress(row.status, row.progress));
  }
  for (const [rid, progresses] of ingestByRun) {
    if (!result.has(rid)) {
      const avg = Math.round(progresses.reduce((a, b) => a + b, 0) / progresses.length);
      result.set(rid, avg);
    }
  }

  return result;
}
