import "server-only";

import { createClient } from "../../server";
import type { CompareRunBundle, EquityCurveRow, RunRow, RunWithMetrics } from "../../types";

const EQUITY_CURVE_PAGE_SIZE = 1000;

const COMPARE_RUN_SELECT = `
  id,
  name,
  strategy_id,
  status,
  benchmark,
  benchmark_ticker,
  universe,
  universe_symbols,
  costs_bps,
  top_n,
  run_params,
  run_metadata,
  start_date,
  end_date,
  executed_start_date,
  executed_end_date,
  created_at,
  user_id,
  executed_with_missing_data,
  run_metrics(id, run_id, cagr, sharpe, max_drawdown, turnover, volatility, win_rate, profit_factor, calmar)
`;

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
      .select(COMPARE_RUN_SELECT)
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
