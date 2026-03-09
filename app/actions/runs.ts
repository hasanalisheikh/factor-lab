"use server"

import { redirect } from "next/navigation"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { BENCHMARK_OPTIONS } from "@/lib/benchmark"
import { getDataCoverage } from "@/lib/supabase/queries"
import { UNIVERSE_PRESETS } from "@/lib/universe-config"
import {
  runPreflightCoverageCheck,
  getActiveIngestTickers,
} from "@/lib/coverage-check"

function triggerWorker(): void {
  const url = process.env.WORKER_TRIGGER_URL
  if (!url) return
  const secret = process.env.WORKER_TRIGGER_SECRET

  const isGitHub = url.includes("api.github.com")
  fetch(isGitHub ? url : `${url}/trigger`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secret}`,
      "Content-Type": "application/json",
      ...(isGitHub ? {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      } : {}),
    },
    body: isGitHub ? JSON.stringify({ event_type: "run-worker" }) : undefined,
    signal: AbortSignal.timeout(8000),
  }).catch(() => {/* fire-and-forget — worker will still poll as fallback */})
}

const schema = z
  .object({
    name: z.string().min(1, "Name is required").max(120, "Name too long"),
    strategy_id: z.enum(
      ["equal_weight", "momentum_12_1", "ml_ridge", "ml_lightgbm", "low_vol", "trend_filter"],
      { message: "Select a valid strategy" }
    ),
    start_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid start date"),
    end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid end date"),
    benchmark: z.enum(BENCHMARK_OPTIONS),
    universe: z.enum(["ETF8", "SP100", "NASDAQ100"]).default("ETF8"),
    costs_bps: z.coerce
      .number({ invalid_type_error: "Costs must be a number" })
      .min(0, "Costs must be >= 0 bps")
      .max(500, "Costs too high"),
    top_n: z.coerce
      .number({ invalid_type_error: "Top N must be a number" })
      .int("Top N must be an integer")
      .min(1, "Top N must be at least 1")
      .max(100, "Top N too high"),
    initial_capital: z.coerce
      .number({ invalid_type_error: "Initial capital must be a number" })
      .positive("Initial capital must be positive")
      .max(1e10, "Initial capital too large")
      .default(100000),
    apply_costs: z.string().optional(),
    slippage_bps: z.coerce
      .number()
      .min(0)
      .max(500)
      .default(0)
      .catch(0),
  })
  .refine((d) => d.end_date > d.start_date, {
    message: "End date must be after start date",
    path: ["end_date"],
  })
  .refine(
    (d) => {
      const start = new Date(d.start_date + "T00:00:00Z")
      const end = new Date(d.end_date + "T00:00:00Z")
      const spanDays = Math.floor(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
      )
      return spanDays >= 730
    },
    {
      message:
        "Date range must span at least 2 years (730 days) for a robust backtest. We recommend 3+ years.",
      path: ["start_date"],
    }
  )

export type CreateRunState = { error: string } | null

function isMissingBenchmarkColumnError(message?: string): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return m.includes("benchmark") && m.includes("does not exist")
}

export async function createRun(
  _prev: CreateRunState,
  formData: FormData
): Promise<CreateRunState> {
  const raw = Object.fromEntries(formData)
  const parsed = schema.safeParse(raw)

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const {
    name,
    strategy_id,
    start_date,
    end_date,
    benchmark,
    universe,
    costs_bps,
    top_n: top_n_raw,
    initial_capital,
    apply_costs,
    slippage_bps,
  } = parsed.data

  const applyCostsFlag = apply_costs === "on"
  const effectiveCostsBps = applyCostsFlag ? costs_bps : 0

  // Clamp top_n to the universe size so the ML engine never tries to select
  // more positions than there are investable assets in the chosen universe.
  const universeSize = (UNIVERSE_PRESETS[universe] ?? []).length
  const top_n = Math.min(top_n_raw, Math.max(1, universeSize))

  // Verify authentication and get the current user's ID
  const serverClient = await createClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) {
    return { error: "Authentication required. Please sign in." }
  }

  // Validate dates against available data coverage
  const coverage = await getDataCoverage()
  if (coverage.minDate && coverage.maxDate) {
    if (start_date < coverage.minDate || end_date > coverage.maxDate) {
      return {
        error: `Date range outside available data coverage (${coverage.minDate} → ${coverage.maxDate}).`,
      }
    }
  }

  // Snapshot the universe symbols at creation time.
  const universeSymbols = UNIVERSE_PRESETS[universe] ? [...UNIVERSE_PRESETS[universe]] : []

  // ── Preflight coverage check ────────────────────────────────────────────────
  // For each universe symbol + benchmark, verify sufficient price history exists
  // for the backtest window (including strategy warmup). If any symbol is
  // missing or below its coverage threshold, set the run to waiting_for_data
  // and enqueue data_ingest jobs. The worker chains to the backtest automatically
  // once all ingestion succeeds.
  const preflight = await runPreflightCoverageCheck({
    strategyId: strategy_id,
    startDate: start_date,
    endDate: end_date,
    universeSymbols,
    benchmark,
  })

  const supabase = createAdminClient()

  const basePayload = {
    name,
    strategy_id,
    start_date,
    end_date,
    benchmark_ticker: benchmark,
    universe,
    universe_symbols: universeSymbols.length > 0 ? universeSymbols : null,
    costs_bps: effectiveCostsBps,
    top_n,
    user_id: user.id,
    run_params: {
      universe,
      benchmark,
      benchmark_ticker: benchmark,
      costs_bps: effectiveCostsBps,
      top_n,
      initial_capital,
      slippage_bps,
      apply_costs: applyCostsFlag,
      created_via: "runs/new",
    },
  }

  if (preflight.allHealthy) {
    // ── Fast path: all coverage healthy — enqueue backtest immediately ────────
    let { data: run, error: runError } = await supabase
      .from("runs")
      .insert({ ...basePayload, status: "queued", benchmark })
      .select("id")
      .single()

    if (runError && isMissingBenchmarkColumnError(runError.message)) {
      const fallback = await supabase
        .from("runs")
        .insert({ ...basePayload, status: "queued" })
        .select("id")
        .single()
      run = fallback.data
      runError = fallback.error
    }

    if (runError || !run) {
      console.error("createRun insert error:", runError?.message)
      return { error: "Failed to create run. Check server env + database config." }
    }

    const { error: jobError } = await supabase.from("jobs").insert({
      run_id: run.id,
      name,
      status: "queued",
      stage: "ingest",
      progress: 0,
    })

    if (jobError) {
      console.error("createRun job insert error:", jobError.message)
      await supabase.from("runs").delete().eq("id", run.id)
      return { error: "Failed to queue run for processing. Please try again." }
    }

    triggerWorker()
    redirect(`/runs/${run.id}`)
  }

  // ── Waiting path: some symbols lack coverage — preflight ingest first ───────
  let { data: run, error: runError } = await supabase
    .from("runs")
    .insert({ ...basePayload, status: "waiting_for_data", benchmark })
    .select("id")
    .single()

  if (runError && isMissingBenchmarkColumnError(runError.message)) {
    const fallback = await supabase
      .from("runs")
      .insert({ ...basePayload, status: "waiting_for_data" })
      .select("id")
      .single()
    run = fallback.data
    runError = fallback.error
  }

  if (runError || !run) {
    console.error("createRun (waiting) insert error:", runError?.message)
    return { error: "Failed to create run. Check server env + database config." }
  }

  // Deduplicate: skip tickers already being actively ingested by another job.
  const activeTickers = await getActiveIngestTickers()
  const today = new Date().toISOString().slice(0, 10)

  const ingestJobs = preflight.unhealthy
    .filter((c) => !activeTickers.has(c.symbol.toUpperCase()))
    .map((c) => ({
      name: `Ingest ${c.symbol} (preflight)`,
      status: "queued",
      stage: "download",
      progress: 0,
      job_type: "data_ingest",
      preflight_run_id: run!.id,
      payload: {
        ticker: c.symbol,
        start_date: preflight.requiredStart,
        end_date: today,
      },
    }))

  if (ingestJobs.length > 0) {
    const { error: ingestError } = await supabase.from("jobs").insert(ingestJobs)
    if (ingestError) {
      console.error("createRun preflight ingest insert error:", ingestError.message)
      // Clean up the run so it doesn't sit stuck in waiting_for_data with no jobs
      await supabase.from("runs").delete().eq("id", run.id)
      return { error: "Failed to queue data ingestion. Please try again." }
    }
  } else {
    // All unhealthy symbols already have active ingest jobs. The worker's
    // try_chain_preflight_backtest won't fire because those jobs lack
    // preflight_run_id. Re-evaluate once they finish by immediately checking
    // coverage again — for simplicity, fail fast with a helpful message.
    // Users can retry run creation once the active ingest jobs complete.
    await supabase.from("runs").delete().eq("id", run.id)
    const symbols = preflight.unhealthy.map((c) => c.symbol).join(", ")
    return {
      error: `Data for ${symbols} is already being ingested. Please wait a few minutes and try again — coverage will be complete shortly.`,
    }
  }

  triggerWorker()
  redirect(`/runs/${run.id}`)
}
