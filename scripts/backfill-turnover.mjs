#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile() {
  const candidates = [".env.local", ".env"];
  for (const rel of candidates) {
    const file = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const splitAt = trimmed.indexOf("=");
      if (splitAt === -1) continue;
      const key = trimmed.slice(0, splitAt);
      if (process.env[key]) continue;
      let value = trimmed.slice(splitAt + 1);
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const options = {
    runId: null,
    dryRun: false,
    keepReports: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--keep-reports") {
      options.keepReports = true;
      continue;
    }
    if (arg === "--run-id" && argv[i + 1]) {
      options.runId = argv[i + 1];
      i += 1;
    }
  }

  return options;
}

function getTurnoverPeriodsPerYear(strategyId) {
  return strategyId === "ml_ridge" || strategyId === "ml_lightgbm" ? 252 : 12;
}

function buildTurnoverSummaryFromPositions(positions, periodsPerYear) {
  if (!positions.length) return null;

  const rowsByDate = new Map();
  for (const row of positions) {
    const rows = rowsByDate.get(row.date) ?? [];
    rows.push(row);
    rowsByDate.set(row.date, rows);
  }

  const dates = [...rowsByDate.keys()].sort((a, b) => a.localeCompare(b));
  let prevWeights = new Map();
  const turnovers = [];

  for (const date of dates) {
    const currWeights = new Map(
      (rowsByDate.get(date) ?? [])
        .filter((row) => Number(row.weight) > 0)
        .map((row) => [row.symbol, Number(row.weight)])
    );
    const tickers = new Set([...prevWeights.keys(), ...currWeights.keys()]);
    let deltaSum = 0;
    for (const ticker of tickers) {
      deltaSum += Math.abs((currWeights.get(ticker) ?? 0) - (prevWeights.get(ticker) ?? 0));
    }
    turnovers.push(deltaSum / 2);
    prevWeights = currWeights;
  }

  const annualizable = turnovers.slice(1);
  const averageTurnover =
    annualizable.length > 0
      ? annualizable.reduce((sum, value) => sum + value, 0) / annualizable.length
      : 0;

  return {
    averageTurnover,
    annualizedTurnover: averageTurnover * periodsPerYear,
    rebalanceCount: dates.length,
  };
}

async function fetchAllPositions(supabase, runId) {
  const all = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("positions")
      .select("date,symbol,weight")
      .eq("run_id", runId)
      .order("date", { ascending: true })
      .order("symbol", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`positions ${runId}: ${error.message}`);
    const page = data ?? [];
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

async function fetchRuns(supabase, runId) {
  let query = supabase
    .from("runs")
    .select("id,name,strategy_id,status")
    .eq("status", "completed")
    .order("created_at", { ascending: false });

  if (runId) {
    query = query.eq("id", runId);
  }

  const { data, error } = await query.limit(runId ? 1 : 1000);
  if (error) throw new Error(`runs: ${error.message}`);
  return data ?? [];
}

async function main() {
  loadEnvFile();
  const { runId, dryRun, keepReports } = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const runs = await fetchRuns(supabase, runId);

  if (runs.length === 0) {
    console.log(runId ? `No completed run found for ${runId}` : "No completed runs found.");
    return;
  }

  let updated = 0;
  let invalidatedReports = 0;

  for (const run of runs) {
    const positions = await fetchAllPositions(supabase, run.id);
    if (positions.length === 0) {
      console.log(`[skip] ${run.id} ${run.name}: no positions history`);
      continue;
    }

    const summary = buildTurnoverSummaryFromPositions(
      positions,
      getTurnoverPeriodsPerYear(run.strategy_id)
    );
    if (!summary) {
      console.log(`[skip] ${run.id} ${run.name}: could not compute turnover`);
      continue;
    }

    console.log(
      `[turnover] ${run.id} ${run.name}: annualized=${(summary.annualizedTurnover * 100).toFixed(1)}% ` +
        `avg/rebalance=${(summary.averageTurnover * 100).toFixed(2)}% rebalances=${summary.rebalanceCount}`
    );

    if (!dryRun) {
      const { error: metricsError } = await supabase
        .from("run_metrics")
        .update({ turnover: summary.annualizedTurnover })
        .eq("run_id", run.id);
      if (metricsError) {
        throw new Error(`run_metrics ${run.id}: ${metricsError.message}`);
      }
      updated += 1;

      if (!keepReports) {
        const { error: reportError } = await supabase.from("reports").delete().eq("run_id", run.id);
        if (reportError) {
          throw new Error(`reports ${run.id}: ${reportError.message}`);
        }
        invalidatedReports += 1;
      }
    }
  }

  console.log(
    dryRun
      ? `[done] dry run complete for ${runs.length} run(s)`
      : `[done] updated=${updated} invalidated_reports=${keepReports ? 0 : invalidatedReports}`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
