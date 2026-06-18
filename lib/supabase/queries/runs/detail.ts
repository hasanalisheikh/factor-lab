import "server-only";

import { createClient } from "../../server";
import type { ModelMetadataRow, ModelPredictionRow, RunWithMetrics } from "../../types";

const RUN_DETAIL_SELECT = `
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

const MODEL_METADATA_SELECT = `
  id,
  run_id,
  model_name,
  train_start,
  train_end,
  train_rows,
  prediction_rows,
  rebalance_count,
  top_n,
  cost_bps,
  feature_columns,
  feature_importance,
  model_params,
  created_at
`;

const MODEL_PREDICTIONS_SELECT = `
  id,
  run_id,
  model_name,
  as_of_date,
  target_date,
  ticker,
  predicted_return,
  realized_return,
  rank,
  selected,
  weight,
  created_at
`;

const MODEL_PREDICTIONS_LIMIT = 500;

export async function getRunById(id: string): Promise<RunWithMetrics | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("runs")
      .select(RUN_DETAIL_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (error || !data) return null;

    return data as RunWithMetrics;
  } catch (err) {
    console.error("getRunById exception:", err);
    return null;
  }
}

export async function getMostRecentCompletedRun(): Promise<RunWithMetrics | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("runs")
      .select(RUN_DETAIL_SELECT)
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
      .select(MODEL_METADATA_SELECT)
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
      .select(MODEL_PREDICTIONS_SELECT)
      .eq("run_id", runId)
      .order("as_of_date", { ascending: false })
      .order("rank", { ascending: true })
      .limit(MODEL_PREDICTIONS_LIMIT);

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
