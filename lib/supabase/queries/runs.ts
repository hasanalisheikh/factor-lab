import "server-only";

import {
  getRunBenchmark,
  inferPossibleOverlapFromUniverse,
  isBenchmarkHeldAtLatestRebalance,
  type BenchmarkOverlapState,
} from "@/lib/benchmark";
import { createAdminClient } from "../admin";
import { createClient } from "../server";
import type {
  CompareRunBundle,
  EquityCurveRow,
  ModelMetadataRow,
  ModelPredictionRow,
  PositionRow,
  RunRow,
  RunWithMetrics,
} from "../types";
import {
  isMissingBenchmarkColumnError,
  isMissingPositionsTableError,
  logQueryError,
  logQueryException,
  type GetRunsOptions,
  type RunBenchmarkContext,
} from "./shared";

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
        executed_start_date,
        executed_end_date,
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
          executed_start_date,
          executed_end_date,
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

export type RunsListResult = {
  runs: RunWithMetrics[];
  total: number;
};

const RUNS_LIST_SELECT = `
  id,
  name,
  strategy_id,
  status,
  universe,
  benchmark,
  benchmark_ticker,
  start_date,
  end_date,
  executed_start_date,
  executed_end_date,
  created_at,
  run_metrics(run_id, cagr, sharpe, max_drawdown, turnover)
`;

const RUNS_LIST_LEGACY_SELECT = `
  id,
  name,
  strategy_id,
  status,
  universe,
  benchmark_ticker,
  start_date,
  end_date,
  executed_start_date,
  executed_end_date,
  created_at,
  run_metrics(run_id, cagr, sharpe, max_drawdown, turnover)
`;

function clampRunsLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.max(1, Math.min(Math.trunc(limit ?? 100), 100));
}

function applyRunsFilters<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  options: Omit<GetRunsOptions, "limit">
): T {
  let filtered = query;
  if (options.search) {
    filtered = (filtered as T & { ilike: (column: string, value: string) => T }).ilike(
      "name",
      `%${options.search}%`
    );
  }
  if (options.status) {
    filtered = filtered.eq("status", options.status);
  }
  if (options.strategy) {
    filtered = filtered.eq("strategy_id", options.strategy);
  }
  if (options.universe) {
    filtered = filtered.eq("universe", options.universe);
  }
  return filtered;
}

export async function getRunsList(options: GetRunsOptions = {}): Promise<RunsListResult> {
  const { limit, search, status, strategy, universe } = options;
  const boundedLimit = clampRunsLimit(limit);
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { runs: [], total: 0 };
    }

    const filters = { search, status, strategy, universe };
    let queryWithBenchmark = supabase
      .from("runs")
      .select(RUNS_LIST_SELECT, { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    queryWithBenchmark = applyRunsFilters(queryWithBenchmark, filters);

    let { data, count, error } = await queryWithBenchmark.limit(boundedLimit);
    if (error && isMissingBenchmarkColumnError(error.message)) {
      let queryLegacy = supabase
        .from("runs")
        .select(RUNS_LIST_LEGACY_SELECT, { count: "exact" })
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      queryLegacy = applyRunsFilters(queryLegacy, filters);

      const fallback = await queryLegacy.limit(boundedLimit);
      data = fallback.data;
      count = fallback.count;
      error = fallback.error;
    }

    if (error) {
      logQueryError("getRunsList", error);
      return { runs: [], total: 0 };
    }

    return {
      runs: (data ?? []) as RunWithMetrics[],
      total: count ?? (data ?? []).length,
    };
  } catch (err) {
    logQueryException("getRunsList", err);
    return { runs: [], total: 0 };
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

const EQUITY_CURVE_PAGE_SIZE = 1000;
const POSITIONS_PAGE_SIZE = 1000;

export async function fetchAllEquityCurve(runId: string): Promise<EquityCurveRow[]> {
  const supabase = createAdminClient();
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

export async function fetchAllPositionsByRunId(runId: string): Promise<PositionRow[]> {
  const supabase = await createClient();
  const all: PositionRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("positions")
      .select("*")
      .eq("run_id", runId)
      .order("date", { ascending: true })
      .order("symbol", { ascending: true })
      .range(offset, offset + POSITIONS_PAGE_SIZE - 1);

    if (error) {
      if (isMissingPositionsTableError(error.message)) {
        return [];
      }
      throw new Error(`Failed to load positions: ${error.message}`);
    }

    const page = (data ?? []) as PositionRow[];
    if (page.length === 0) break;

    all.push(...page);
    if (page.length < POSITIONS_PAGE_SIZE) break;
    offset += POSITIONS_PAGE_SIZE;
  }

  return all;
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

async function fetchCompareEquityCurveRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  runIds: string[]
): Promise<EquityCurveRow[]> {
  if (runIds.length === 0) return [];

  const all: EquityCurveRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("equity_curve")
      .select("run_id,date,portfolio,benchmark")
      .in("run_id", runIds)
      .order("run_id", { ascending: true })
      .order("date", { ascending: true })
      .range(offset, offset + EQUITY_CURVE_PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    const page = (data ?? []) as EquityCurveRow[];
    if (page.length === 0) break;

    all.push(...page);
    if (page.length < EQUITY_CURVE_PAGE_SIZE) break;
    offset += EQUITY_CURVE_PAGE_SIZE;
  }

  return all;
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
    let equityRows: EquityCurveRow[];
    try {
      equityRows = await fetchCompareEquityCurveRows(supabase, runIds);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("getCompareRunBundles equity error:", message);
      return [];
    }

    const grouped = new Map<string, EquityCurveRow[]>();
    for (const row of equityRows) {
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

export async function getPositionsByRunId(runId: string): Promise<PositionRow[]> {
  try {
    return await fetchAllPositionsByRunId(runId);
  } catch (err) {
    console.error("getPositionsByRunId exception:", err);
    return [];
  }
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
