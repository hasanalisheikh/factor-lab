import "server-only";

import { createClient } from "../../server";
import type { RunWithMetrics } from "../../types";
import {
  isMissingBenchmarkColumnError,
  logQueryError,
  logQueryException,
  type GetRunsOptions,
} from "../shared";

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
    let query = supabase.from("runs").select("id", { count: "exact", head: true });

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
