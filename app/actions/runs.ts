"use server"

import { redirect } from "next/navigation"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  isActiveDataIngestStatus,
  isMissingDataIngestExtendedColumnError,
  normalizeDataIngestStatus,
  stripExtendedDataIngestFields,
} from "@/lib/data-ingest-jobs"
import { createClient } from "@/lib/supabase/server"
import { BENCHMARK_OPTIONS } from "@/lib/benchmark"
import { getDataCoverage } from "@/lib/supabase/queries"
import { UNIVERSE_PRESETS } from "@/lib/universe-config"
import { runPreflightCoverageCheck } from "@/lib/coverage-check"

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

type ActiveIngestJobRow = {
  id: string
  symbol: string
  status: string
  next_retry_at?: string | null
  requested_by_run_id?: string | null
}

async function getActiveIngestJobsForSymbols(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  symbols: string[],
): Promise<ActiveIngestJobRow[]> {
  if (symbols.length === 0) return []

  const { data, error } = await supabase
    .from("data_ingest_jobs")
    .select("id, symbol, status, next_retry_at, requested_by_run_id")
    .in("symbol", symbols)
    .in("status", ["queued", "running", "retrying", "failed"])

  if (error) {
    console.error("createRun active-ingest query error:", error.message)
    return []
  }

  return ((data ?? []) as ActiveIngestJobRow[]).filter((job) =>
    isActiveDataIngestStatus(job.status, job.next_retry_at ?? null)
  )
}

async function adoptExistingActiveIngestJobs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  runId: string,
  symbols: string[],
): Promise<Set<string>> {
  const activeJobs = await getActiveIngestJobsForSymbols(supabase, symbols)
  if (activeJobs.length === 0) return new Set()

  const inProgressJobs = activeJobs.filter((job) => {
    const status = normalizeDataIngestStatus(job.status)
    return status === "queued" || status === "running"
  })

  const linkedSymbols = new Set<string>()
  const adoptableIds = inProgressJobs
    .filter((job) => !job.requested_by_run_id)
    .map((job) => {
      linkedSymbols.add(job.symbol.toUpperCase())
      return job.id
    })

  for (const job of inProgressJobs) {
    if (job.requested_by_run_id === runId) {
      linkedSymbols.add(job.symbol.toUpperCase())
    }
  }

  if (adoptableIds.length === 0) return linkedSymbols

  let { error } = await supabase
    .from("data_ingest_jobs")
    .update({
      requested_by_run_id: runId,
      requested_by: `run-preflight:${runId}`,
    })
    .in("id", adoptableIds)
    .is("requested_by_run_id", null)

  if (error && isMissingDataIngestExtendedColumnError(error.message)) {
    error = (
      await supabase
        .from("data_ingest_jobs")
        .update({ requested_by_run_id: runId })
        .in("id", adoptableIds)
        .is("requested_by_run_id", null)
    ).error
  }

  if (error) {
    console.error("createRun active-ingest adopt error:", error.message)
    return new Set()
  }

  return linkedSymbols
}

async function insertPreflightIngestJobs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  rows: Array<Record<string, unknown>>,
): Promise<string | null> {
  if (rows.length === 0) return null

  let { error } = await supabase.from("data_ingest_jobs").insert(rows)

  if (error && isMissingDataIngestExtendedColumnError(error.message)) {
    error = (
      await supabase
        .from("data_ingest_jobs")
        .insert(rows.map((row) => stripExtendedDataIngestFields(row)))
    ).error
  }

  return error?.message ?? null
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
        error: `Date range outside the current dataset cutoff (${coverage.minDate} → ${coverage.maxDate}). Backtests are based on data current through ${coverage.maxDate}.`,
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
    dataCutoffDate: coverage.maxDate,
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

  // ── Preflight status gate ────────────────────────────────────────────────────
  // USER_ACTION_REQUIRED: coverage is permanently unachievable (e.g. ticker
  // started after requiredStart). Return a plain-English error — no run created.
  if (preflight.status === "USER_ACTION_REQUIRED") {
    return { error: preflight.reasons.join(" ") }
  }

  if (preflight.status === "READY") {
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

  const cutoffDate = coverage.maxDate ?? preflight.requiredEnd

  // Link any already-active ingest jobs to this run when possible so the
  // waiting run shows progress instead of failing with a retry-later message.
  const linkedSymbols = await adoptExistingActiveIngestJobs(
    supabase,
    run.id,
    preflight.unhealthy.map((c) => c.symbol.toUpperCase()),
  )

  // Insert preflight ingest jobs only for symbols not already linked to this run.
  const toIngest = preflight.unhealthy.filter((c) => !linkedSymbols.has(c.symbol.toUpperCase()))
  const ingestRows = toIngest.map((c) => ({
    symbol: c.symbol,
    start_date: preflight.requiredStart,
    end_date: cutoffDate,
    status: "queued",
    stage: "download",
    progress: 0,
    request_mode: "preflight",
    target_cutoff_date: cutoffDate,
    requested_by: `run-preflight:${run!.id}`,
    requested_by_run_id: run!.id,
  }))

  if (ingestRows.length > 0) {
    const ingestError = await insertPreflightIngestJobs(supabase, ingestRows)
    if (ingestError) {
      console.error("createRun preflight ingest insert error:", ingestError)
      // Clean up the run so it doesn't sit stuck in waiting_for_data with no jobs
      await supabase.from("runs").delete().eq("id", run.id)
      return { error: "Failed to queue data ingestion. Please try again." }
    }
  }

  triggerWorker()
  redirect(`/runs/${run.id}`)
}
