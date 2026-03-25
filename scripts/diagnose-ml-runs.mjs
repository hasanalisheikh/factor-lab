#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, key);

function digest(rows, keys) {
  const normalized = (rows ?? []).map((r) => {
    const out = {};
    for (const k of keys) out[k] = r[k];
    return out;
  });
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

async function latestRun(strategyId) {
  const { data, error } = await supabase
    .from("runs")
    .select("id,name,strategy_id,status,created_at,run_metadata")
    .eq("strategy_id", strategyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchBundle(runId) {
  const [metrics, positions, equity] = await Promise.all([
    supabase
      .from("run_metrics")
      .select("cagr,sharpe,max_drawdown")
      .eq("run_id", runId)
      .maybeSingle(),
    supabase
      .from("positions")
      .select("date,symbol,weight")
      .eq("run_id", runId)
      .order("date", { ascending: true }),
    supabase
      .from("equity_curve")
      .select("date,portfolio,benchmark")
      .eq("run_id", runId)
      .order("date", { ascending: true }),
  ]);
  if (metrics.error) throw metrics.error;
  if (positions.error) throw positions.error;
  if (equity.error) throw equity.error;
  return {
    metrics: metrics.data,
    positions: positions.data ?? [],
    equity: equity.data ?? [],
  };
}

async function main() {
  const ridge = await latestRun("ml_ridge");
  const lgbm = await latestRun("ml_lightgbm");

  if (!ridge || !lgbm) {
    console.log("Need at least one completed run for both ml_ridge and ml_lightgbm.");
    process.exit(0);
  }

  const [ridgeData, lgbmData] = await Promise.all([fetchBundle(ridge.id), fetchBundle(lgbm.id)]);

  const ridgePosDigest = digest(ridgeData.positions, ["date", "symbol", "weight"]);
  const lgbmPosDigest = digest(lgbmData.positions, ["date", "symbol", "weight"]);
  const ridgeEqDigest = digest(ridgeData.equity, ["date", "portfolio", "benchmark"]);
  const lgbmEqDigest = digest(lgbmData.equity, ["date", "portfolio", "benchmark"]);

  console.log(
    "Ridge run:",
    ridge.id,
    ridge.strategy_id,
    ridgeData.metrics,
    ridge.run_metadata ?? {}
  );
  console.log(
    "LightGBM run:",
    lgbm.id,
    lgbm.strategy_id,
    lgbmData.metrics,
    lgbm.run_metadata ?? {}
  );
  console.log("positions_digest_equal:", ridgePosDigest === lgbmPosDigest);
  console.log("equity_digest_equal:", ridgeEqDigest === lgbmEqDigest);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(2);
});
