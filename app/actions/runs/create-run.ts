"use server";

import { z } from "zod";

import { getLastCompleteTradingDayUtc } from "@/lib/data-cutoff";
import { buildJobNotification } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import { UNIVERSE_PRESETS, type UniverseId } from "@/lib/universe-config";
import { triggerWorker } from "@/lib/worker-trigger";
import { getAuthenticatedUserId } from "./auth";
import { resolveUniverseSymbols } from "./data-readiness";
import { createRunSchema } from "./schema";
import { isMissingBenchmarkColumnError } from "./shared";
import { buildPersistedPreflightSnapshot, preflightRunInternal } from "./preflight-result";
import type { CloneRunResult, CreateRunResult } from "./types";

export async function createRun(input: z.input<typeof createRunSchema>): Promise<CreateRunResult> {
  const parsed = createRunSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { ok: false, error: "Authentication required. Please sign in." };
  }

  const {
    name,
    strategy_id,
    start_date,
    end_date,
    benchmark,
    universe,
    costs_bps,
    top_n: topNRaw,
    initial_capital,
    apply_costs,
    slippage_bps,
    acknowledge_warnings,
  } = parsed.data;
  const universeId = universe as UniverseId;

  const preflight = await preflightRunInternal(
    {
      name,
      strategy_id,
      start_date,
      end_date,
      benchmark,
      universe: universeId,
      costs_bps,
      top_n: topNRaw,
      initial_capital,
      apply_costs,
      slippage_bps,
    },
    userId
  );

  const REPAIR_ISSUE_CODES = new Set([
    "universe_missing_data_repair_started",
    "universe_stale_data_repair_started",
    "benchmark_repair_started",
    "trend_defensive_repair_started",
  ]);
  const hardBlocks = preflight.issues.filter(
    (issue) => issue.severity === "blocked" && !REPAIR_ISSUE_CODES.has(issue.code)
  );
  if (hardBlocks.length > 0) {
    return {
      ok: false,
      error: hardBlocks.map((i) => i.reason).join(" "),
      preflight,
    };
  }

  if (preflight.status === "warn" && !acknowledge_warnings) {
    return {
      ok: false,
      error: "Please acknowledge the warning before queueing this backtest.",
      preflight,
    };
  }

  const effectiveCostsBps = apply_costs ? costs_bps : 0;
  const universeSize = (UNIVERSE_PRESETS[universeId] ?? []).length;
  const top_n = Math.min(topNRaw, Math.max(1, universeSize));
  const universeSymbols = resolveUniverseSymbols(universeId);
  const runParams = {
    universe: universeId,
    benchmark,
    benchmark_ticker: benchmark,
    costs_bps: effectiveCostsBps,
    top_n,
    initial_capital,
    slippage_bps,
    apply_costs,
    created_via: "runs/new",
    preflight: buildPersistedPreflightSnapshot(preflight, acknowledge_warnings),
  };

  const basePayload = {
    name,
    strategy_id,
    start_date,
    end_date,
    benchmark_ticker: benchmark,
    universe: universeId,
    universe_symbols: universeSymbols.length > 0 ? universeSymbols : null,
    costs_bps: effectiveCostsBps,
    top_n,
    user_id: userId,
    executed_with_missing_data: preflight.status === "warn" && acknowledge_warnings,
    run_params: runParams,
  };

  const serverClient = await createClient();

  let { data: run, error: runError } = await serverClient
    .from("runs")
    .insert({ ...basePayload, status: "queued", benchmark })
    .select("id")
    .single();

  if (runError && isMissingBenchmarkColumnError(runError.message)) {
    const fallback = await serverClient
      .from("runs")
      .insert({ ...basePayload, status: "queued" })
      .select("id")
      .single();
    run = fallback.data;
    runError = fallback.error;
  }

  if (runError || !run) {
    console.error("createRun insert error:", runError?.message);
    return {
      ok: false,
      error: "Failed to create run. Check server env + database config.",
      preflight,
    };
  }

  const { data: job, error: jobError } = await serverClient
    .from("jobs")
    .insert({
      run_id: run.id,
      name,
      status: "queued",
      stage: "ingest",
      progress: 0,
    })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("createRun job insert error:", jobError?.message ?? "missing job row");
    await serverClient.from("runs").delete().eq("id", run.id);
    return { ok: false, error: "Failed to queue run for processing. Please try again.", preflight };
  }

  const { error: notificationError } = await serverClient.from("notifications").insert({
    user_id: userId,
    run_id: run.id,
    job_id: job.id,
    read_at: null,
    ...buildJobNotification({
      status: "queued",
      name,
    }),
  });
  if (notificationError) {
    console.warn("createRun notification insert warning:", notificationError.message);
  }

  await triggerWorker("runs.createRunAction");
  return { ok: true, runId: run.id, preflight };
}

export async function cloneRunAction(sourceRunId: string): Promise<CloneRunResult> {
  const parsedRunId = z.string().uuid().safeParse(sourceRunId);
  if (!parsedRunId.success) {
    return { ok: false, error: "Invalid run ID." };
  }

  const serverClient = await createClient();
  const {
    data: { user },
    error: userError,
  } = await serverClient.auth.getUser();
  if (userError || !user) {
    return { ok: false, error: "Authentication required. Please sign in." };
  }

  const { data: source, error: sourceError } = await serverClient
    .from("runs")
    .select(
      "id, name, strategy_id, start_date, end_date, executed_end_date, benchmark_ticker, universe, costs_bps, top_n, user_id"
    )
    .eq("id", parsedRunId.data)
    .maybeSingle();

  if (sourceError || !source) {
    return { ok: false, error: "Source run not found." };
  }
  if (source.user_id !== user.id) {
    return { ok: false, error: "You can only clone your own runs." };
  }

  const newEndDate = getLastCompleteTradingDayUtc();

  // If the run already covers through the current cutoff, there is nothing to update.
  const effectiveEndDate = source.executed_end_date ?? source.end_date ?? "";
  if (effectiveEndDate >= newEndDate) {
    return {
      ok: false,
      error: `This run is already up to date — data runs through ${newEndDate}.`,
      alreadyCurrent: true,
    };
  }

  const result = await createRun({
    name: `${source.name} (updated)`,
    strategy_id: source.strategy_id as z.input<typeof createRunSchema>["strategy_id"],
    start_date: source.start_date ?? "",
    end_date: newEndDate,
    benchmark: (source.benchmark_ticker ?? "SPY") as z.input<typeof createRunSchema>["benchmark"],
    universe: (source.universe ?? "ETF8") as z.input<typeof createRunSchema>["universe"],
    costs_bps: source.costs_bps ?? 10,
    top_n: source.top_n ?? 10,
    initial_capital: 100000,
    apply_costs: (source.costs_bps ?? 10) > 0,
    slippage_bps: 0,
    acknowledge_warnings: false,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, newRunId: result.runId };
}
