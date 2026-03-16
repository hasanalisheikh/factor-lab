"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  isActiveDataIngestStatus,
  isMissingDataIngestExtendedColumnError,
  stripExtendedDataIngestFields,
} from "@/lib/data-ingest-jobs"
import { getLastCompleteTradingDayUtc } from "@/lib/data-cutoff"
import { createClient } from "@/lib/supabase/server"
import {
  getUniverseBatchStatus,
  getUniverseConstraintsSnapshot,
  type UniverseBatchStatusSummary,
  type UniverseConstraintsSnapshot,
} from "@/lib/supabase/queries"
import { BENCHMARK_OPTIONS } from "@/lib/benchmark"
import {
  buildUniverseCoverageStatus,
  evaluateRunPreflightSnapshot,
  finalizeRunPreflightResult,
  type RunPreflightIssue,
  type RunPreflightResult,
  type RunPreflightSnapshot,
} from "@/lib/coverage-check"
import { UNIVERSE_PRESETS, type UniverseId } from "@/lib/universe-config"
import { TICKER_INCEPTION_DATES } from "@/lib/supabase/types"
import type { StrategyId } from "@/lib/types"
import { resolveReportsBucketName } from "@/lib/storage"

export type { RunPreflightResult } from "@/lib/coverage-check"
export type { UniverseBatchStatusSummary } from "@/lib/supabase/queries"

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

const baseRunConfigSchema = z.object({
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
    apply_costs: z.boolean().default(true),
    slippage_bps: z.coerce
      .number()
      .min(0)
      .max(500)
      .default(0)
      .catch(0),
  })

const runConfigSchema = baseRunConfigSchema
  .refine((d) => d.end_date > d.start_date, {
    message: "End date must be after start date",
    path: ["end_date"],
  })
  .refine(
    (d) => {
      const start = new Date(`${d.start_date}T00:00:00Z`)
      const end = new Date(`${d.end_date}T00:00:00Z`)
      const spanDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
      return spanDays >= 730
    },
    {
      message:
        "Date range must span at least 2 years (730 days) for a robust backtest. We recommend 3+ years.",
      path: ["start_date"],
    }
  )

const createRunSchema = baseRunConfigSchema.extend({
  acknowledge_warnings: z.boolean().default(false),
})
  .refine((d) => d.end_date > d.start_date, {
    message: "End date must be after start date",
    path: ["end_date"],
  })
  .refine(
    (d) => {
      const start = new Date(`${d.start_date}T00:00:00Z`)
      const end = new Date(`${d.end_date}T00:00:00Z`)
      const spanDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
      return spanDays >= 730
    },
    {
      message:
        "Date range must span at least 2 years (730 days) for a robust backtest. We recommend 3+ years.",
      path: ["start_date"],
    }
  )

export type RunConfigInput = z.input<typeof runConfigSchema>

export type EnsureUniverseDataReadyResult = {
  ready: boolean
  batchId: string | null
  queuedSymbols: string[]
  widenedSymbols: string[]
  activeSymbols: string[]
  failedSymbols: string[]
  constraints: UniverseConstraintsSnapshot
}

type EnsureUniverseOptions = {
  createBatch?: boolean
}

type RepairBatchResult = {
  batchId: string | null
  queuedSymbols: string[]
  widenedSymbols: string[]
  activeSymbols: string[]
  failedSymbols: string[]
}

export type CreateRunResult =
  | { ok: true; runId: string; preflight: RunPreflightResult }
  | { ok: false; error: string; preflight?: RunPreflightResult | null }

export type RetryPreflightRepairsResult =
  | ({ ok: true } & RepairBatchResult)
  | { ok: false; error: string }

export type DeleteRunActionResult = { error: string }

type ActiveIngestJobRow = {
  id: string
  symbol: string
  status: string
  next_retry_at: string | null
  start_date: string | null
  end_date: string | null
  batch_id: string | null
  request_mode: string | null
}

type SymbolRepairPlan = {
  symbol: string
  desiredStart: string
  desiredEnd: string
}

type TickerStatsSnapshot = {
  symbol: string
  firstDate: string | null
  lastDate: string | null
}

const ML_STRATEGIES = new Set<StrategyId>(["ml_ridge", "ml_lightgbm"])
const RANKING_STRATEGIES = new Set<StrategyId>([
  "momentum_12_1",
  "low_vol",
  "trend_filter",
  "ml_ridge",
  "ml_lightgbm",
])
const TREND_DEFENSIVE_PRIMARY = "TLT"
const TREND_DEFENSIVE_FALLBACK = "BIL"
const RUN_DELETE_BLOCKED_STATUSES = new Set(["queued", "running", "waiting_for_data"])

function isMissingBenchmarkColumnError(message?: string): boolean {
  if (!message) return false
  const lower = message.toLowerCase()
  return lower.includes("benchmark") && lower.includes("does not exist")
}

function defaultIngestStartDate(symbol: string): string {
  return TICKER_INCEPTION_DATES[symbol] ?? "1993-01-01"
}

function formatSymbolList(symbols: string[]): string {
  if (symbols.length === 0) return ""
  if (symbols.length === 1) return symbols[0]
  if (symbols.length === 2) return `${symbols[0]} and ${symbols[1]}`
  return `${symbols.slice(0, -1).join(", ")}, and ${symbols.at(-1)}`
}

function addCalendarDays(dateStr: string, days: number): string {
  const next = new Date(`${dateStr}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function subtractCalendarDays(dateStr: string, days: number): string {
  return addCalendarDays(dateStr, -days)
}

function nextDate(dateStr: string): string {
  return addCalendarDays(dateStr, 1)
}

function normalizeDate(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function pickLaterDate(current: string | null, candidate: string | null): string | null {
  if (!current) return candidate
  if (!candidate) return current
  return current > candidate ? current : candidate
}

function getMinTrainDays(): number {
  return Number(process.env.ML_MIN_TRAIN_DAYS ?? "252")
}

function getTrainWindowDays(): number {
  return Number(process.env.ML_TRAIN_WINDOW_DAYS ?? "504")
}

function getTrainWindowCalendarDays(): number {
  return Math.ceil((getTrainWindowDays() * 365) / 252)
}

function dayBefore(dateStr: string): string {
  const previous = new Date(`${dateStr}T00:00:00Z`)
  previous.setUTCDate(previous.getUTCDate() - 1)
  return previous.toISOString().slice(0, 10)
}

function countBusinessDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (end < start) return 0
  let count = 0
  const cursor = new Date(start)
  while (cursor <= end) {
    const dow = cursor.getUTCDay()
    if (dow !== 0 && dow !== 6) count += 1
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return count
}

function buildErrorPreflightResult(
  message: string,
  constraints: UniverseConstraintsSnapshot,
): RunPreflightResult {
  const maxEndDate = constraints.dataCutoffDate ?? getLastCompleteTradingDayUtc()
  return finalizeRunPreflightResult({
    constraints: {
      dataCutoffDate: maxEndDate,
      universeEarliestStart: constraints.universeEarliestStart,
      universeValidFrom: constraints.universeValidFrom,
      minStartDate:
        constraints.universeEarliestStart && constraints.universeValidFrom
          ? (constraints.universeEarliestStart > constraints.universeValidFrom
            ? constraints.universeEarliestStart
            : constraints.universeValidFrom)
          : (constraints.universeEarliestStart ?? constraints.universeValidFrom ?? null),
      maxEndDate,
      missingTickers: constraints.missingTickers,
      warmupStart: "",
      requiredStart: "",
      requiredEnd: maxEndDate,
    },
    coverage: {
      benchmark: {
        status: "blocked",
        reason: message,
        metricSourceUsed: "db_wide",
        trueMissingRate: 1,
        symbol: "",
        windowStartUsed: "",
        windowEndUsed: maxEndDate,
        expectedDays: 0,
        actualDays: 0,
        missingDays: 0,
      },
      universe: {
        status: "blocked",
        reason: message,
        over2Percent: [],
        over10Percent: [],
        affectedShare: 0,
      },
      symbols: [],
      benchmarkCandidates: [],
    },
    warmupStart: "",
    requiredStart: "",
    requiredEnd: maxEndDate,
    issues: [{
      severity: "blocked",
      code: "config_error",
      reason: message,
      fix: "Update the run settings, then try again.",
      action: null,
    }],
  })
}

async function getAuthenticatedUserId(): Promise<string | null> {
  const serverClient = await createClient()
  const { data: { user } } = await serverClient.auth.getUser()
  return user?.id ?? null
}

async function getActiveIngestJobsForSymbols(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  symbols: string[],
): Promise<ActiveIngestJobRow[]> {
  if (symbols.length === 0) return []

  const { data, error } = await supabase
    .from("data_ingest_jobs")
    .select("id, symbol, status, next_retry_at, start_date, end_date, batch_id, request_mode")
    .in("symbol", symbols)
    .in("status", ["queued", "running", "retrying", "failed"])
    .order("created_at", { ascending: false })

  if (error) {
    console.error("ensureUniverseDataReady active-ingest query error:", error.message)
    return []
  }

  const latestBySymbol = new Map<string, ActiveIngestJobRow>()
  for (const row of (data ?? []) as ActiveIngestJobRow[]) {
    const symbol = row.symbol.toUpperCase()
    if (latestBySymbol.has(symbol)) continue
    if (!isActiveDataIngestStatus(row.status, row.next_retry_at ?? null)) continue
    latestBySymbol.set(symbol, row)
  }

  return [...latestBySymbol.values()]
}

async function insertDataIngestJobsCompat(
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

async function updateDataIngestJobCompat(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  jobId: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  let { error } = await supabase
    .from("data_ingest_jobs")
    .update(payload)
    .eq("id", jobId)

  if (error && isMissingDataIngestExtendedColumnError(error.message)) {
    error = (
      await supabase
        .from("data_ingest_jobs")
        .update(stripExtendedDataIngestFields(payload))
        .eq("id", jobId)
    ).error
  }

  return error?.message ?? null
}

function resolveUniverseSymbols(universe: UniverseId): string[] {
  return UNIVERSE_PRESETS[universe] ? [...UNIVERSE_PRESETS[universe]] : []
}

function canAdoptIntoReadinessBatch(job: ActiveIngestJobRow): boolean {
  const mode = (job.request_mode ?? "").toLowerCase()
  return mode !== "monthly" && mode !== "daily"
}

function findReusableBatchId(
  symbols: string[],
  activeJobs: ActiveIngestJobRow[]
): string | null {
  if (symbols.length === 0) return null

  const bySymbol = new Map(activeJobs.map((job) => [job.symbol.toUpperCase(), job]))
  if (symbols.some((symbol) => !bySymbol.has(symbol.toUpperCase()))) {
    return null
  }

  const batchIds = new Set(
    symbols
      .map((symbol) => bySymbol.get(symbol.toUpperCase())?.batch_id ?? null)
      .filter((batchId): batchId is string => Boolean(batchId))
  )

  return batchIds.size === 1 ? [...batchIds][0] : null
}

async function ensureSymbolRepairsInternal(params: {
  plans: SymbolRepairPlan[]
  userId: string
  requestedBy: string
  createBatch?: boolean
}): Promise<RepairBatchResult> {
  const { plans, userId, requestedBy, createBatch = true } = params
  const normalizedPlans = plans.map((plan) => ({
    symbol: plan.symbol.toUpperCase(),
    desiredStart: plan.desiredStart,
    desiredEnd: plan.desiredEnd,
  }))

  if (normalizedPlans.length === 0) {
    return {
      batchId: null,
      queuedSymbols: [],
      widenedSymbols: [],
      activeSymbols: [],
      failedSymbols: [],
    }
  }

  const admin = createAdminClient()
  const symbols = normalizedPlans.map((plan) => plan.symbol)
  const activeJobs = await getActiveIngestJobsForSymbols(admin, symbols)
  const reusableBatchId = findReusableBatchId(symbols, activeJobs)

  if (reusableBatchId) {
    return {
      batchId: reusableBatchId,
      queuedSymbols: [],
      widenedSymbols: [],
      activeSymbols: symbols,
      failedSymbols: [],
    }
  }

  if (!createBatch) {
    return {
      batchId: null,
      queuedSymbols: [],
      widenedSymbols: [],
      activeSymbols: symbols,
      failedSymbols: [],
    }
  }

  const batchId = crypto.randomUUID()
  const activeBySymbol = new Map(activeJobs.map((job) => [job.symbol.toUpperCase(), job]))
  const queuedSymbols: string[] = []
  const widenedSymbols: string[] = []
  const activeSymbols: string[] = []
  const failedSymbols: string[] = []
  const rowsToInsert: Array<Record<string, unknown>> = []

  for (const plan of normalizedPlans) {
    const existing = activeBySymbol.get(plan.symbol)
    if (!existing) {
      rowsToInsert.push({
        symbol: plan.symbol,
        start_date: plan.desiredStart,
        end_date: plan.desiredEnd,
        status: "queued",
        stage: "download",
        progress: 0,
        request_mode: "manual",
        batch_id: batchId,
        target_cutoff_date: plan.desiredEnd,
        requested_by: requestedBy,
        requested_by_user_id: userId,
      })
      queuedSymbols.push(plan.symbol)
      continue
    }

    activeSymbols.push(plan.symbol)

    if (!canAdoptIntoReadinessBatch(existing)) {
      continue
    }

    const updatePayload: Record<string, unknown> = {
      batch_id: batchId,
      request_mode: "manual",
      target_cutoff_date: plan.desiredEnd,
      requested_by: requestedBy,
      requested_by_user_id: userId,
    }
    const currentStart = existing.start_date ?? plan.desiredStart
    const currentEnd = existing.end_date ?? plan.desiredEnd
    if (existing.status === "queued") {
      const nextStart = plan.desiredStart < currentStart ? plan.desiredStart : currentStart
      const nextEnd = plan.desiredEnd > currentEnd ? plan.desiredEnd : currentEnd
      updatePayload.start_date = nextStart
      updatePayload.end_date = nextEnd
      if (nextStart !== currentStart || nextEnd !== currentEnd || existing.batch_id !== batchId) {
        widenedSymbols.push(plan.symbol)
      }
    }

    const updateError = await updateDataIngestJobCompat(admin, existing.id, updatePayload)
    if (updateError) {
      console.error("ensureSymbolRepairsInternal adopt error:", updateError)
      failedSymbols.push(plan.symbol)
    }
  }

  const insertError = await insertDataIngestJobsCompat(admin, rowsToInsert)
  if (insertError) {
    console.error("ensureSymbolRepairsInternal insert error:", insertError)
    for (const plan of normalizedPlans) {
      if (queuedSymbols.includes(plan.symbol)) {
        failedSymbols.push(plan.symbol)
      }
    }
  }

  if ((rowsToInsert.length > 0 || widenedSymbols.length > 0) && failedSymbols.length === 0) {
    triggerWorker()
  }

  return {
    batchId,
    queuedSymbols,
    widenedSymbols,
    activeSymbols,
    failedSymbols: [...new Set(failedSymbols)],
  }
}

async function ensureUniverseDataReadyInternal(
  universe: UniverseId,
  userId: string,
  options: EnsureUniverseOptions = {}
): Promise<EnsureUniverseDataReadyResult> {
  const { createBatch = true } = options
  const constraints = await getUniverseConstraintsSnapshot(universe)
  if (constraints.ready) {
    return {
      ready: true,
      batchId: null,
      queuedSymbols: [],
      widenedSymbols: [],
      activeSymbols: [],
      failedSymbols: [],
      constraints,
    }
  }

  const cutoffDate = constraints.dataCutoffDate ?? getLastCompleteTradingDayUtc()
  const missingTickers = constraints.missingTickers.map((symbol) => symbol.toUpperCase())
  const repairBatch = await ensureSymbolRepairsInternal({
    plans: missingTickers.map((symbol) => ({
      symbol,
      desiredStart: defaultIngestStartDate(symbol),
      desiredEnd: cutoffDate,
    })),
    userId,
    requestedBy: `run-readiness:${userId}:${universe}`,
    createBatch,
  })

  return {
    ready: false,
    batchId: repairBatch.batchId,
    queuedSymbols: repairBatch.queuedSymbols,
    widenedSymbols: repairBatch.widenedSymbols,
    activeSymbols: repairBatch.activeSymbols,
    failedSymbols: repairBatch.failedSymbols,
    constraints,
  }
}

async function getTickerStatsSnapshot(symbols: string[]): Promise<Map<string, TickerStatsSnapshot>> {
  const uniqueSymbols = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))]
  const result = new Map<string, TickerStatsSnapshot>()
  if (uniqueSymbols.length === 0) return result

  type StatsRow = { symbol: string; first_date: string | null; last_date: string | null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from("ticker_stats")
    .select("symbol, first_date, last_date")
    .in("symbol", uniqueSymbols) as { data: StatsRow[] | null; error: { message: string } | null }

  if (error) {
    console.error("getTickerStatsSnapshot error:", error.message)
    return result
  }

  for (const row of data ?? []) {
    result.set(row.symbol.toUpperCase(), {
      symbol: row.symbol.toUpperCase(),
      firstDate: normalizeDate(row.first_date),
      lastDate: normalizeDate(row.last_date),
    })
  }

  return result
}

function buildRepairIssue(params: {
  code: string
  symbols: string[]
  failedSymbols: string[]
  reasonPrefix: string
  waitingFix: string
  retryLabel: string
}): RunPreflightIssue {
  const { code, symbols, failedSymbols, reasonPrefix, waitingFix, retryLabel } = params
  const names = formatSymbolList(symbols)
  if (failedSymbols.length > 0) {
    return {
      severity: "blocked",
      code,
      reason: `${reasonPrefix} for ${formatSymbolList(failedSymbols)}. We couldn't start that repair automatically.`,
      fix: retryLabel,
      action: {
        kind: "retry_repairs",
        value: failedSymbols,
        label: "Retry repair",
      },
    }
  }

  return {
    severity: "blocked",
    code,
    reason: `${reasonPrefix} for ${names}. We're downloading it now—this run will be available to start when data is ready.`,
    fix: waitingFix,
    action: null,
  }
}

function buildDateIssues(snapshot: RunPreflightSnapshot, input: z.infer<typeof runConfigSchema>): RunPreflightIssue[] {
  const issues: RunPreflightIssue[] = []
  if (snapshot.constraints.minStartDate && input.start_date < snapshot.constraints.minStartDate) {
    const limitingUniverseRow = snapshot.coverage.symbols
      .filter((row) => !row.isBenchmark && row.firstDate === snapshot.constraints.minStartDate)
      .sort((left, right) => left.symbol.localeCompare(right.symbol))[0]
    issues.push({
      severity: "blocked",
      code: "start_before_universe_min",
      reason: limitingUniverseRow
        ? `This universe can't start before ${snapshot.constraints.minStartDate} because ${limitingUniverseRow.symbol} did not exist yet.`
        : `This universe can't start before ${snapshot.constraints.minStartDate}.`,
      fix: `Choose ${snapshot.constraints.minStartDate} or a later start date.`,
      action: {
        kind: "clamp_start_date",
        value: snapshot.constraints.minStartDate,
        label: "Use earliest start",
      },
    })
  }
  if (input.end_date > snapshot.constraints.maxEndDate) {
    issues.push({
      severity: "blocked",
      code: "end_after_cutoff",
      reason: `Your end date is after the current dataset cutoff (${snapshot.constraints.maxEndDate}).`,
      fix: `Choose ${snapshot.constraints.maxEndDate} or an earlier end date.`,
      action: {
        kind: "clamp_end_date",
        value: snapshot.constraints.maxEndDate,
        label: "Use cutoff end date",
      },
    })
  }
  return issues
}

function buildTopNIssues(params: {
  input: z.infer<typeof runConfigSchema>
  universeSize: number
}): RunPreflightIssue[] {
  const { input, universeSize } = params
  if (!RANKING_STRATEGIES.has(input.strategy_id)) return []
  if (input.top_n <= universeSize) return []
  return [{
    severity: "blocked",
    code: "top_n_above_universe_size",
    reason: `Top N is ${input.top_n}, but ${input.universe} only has ${universeSize} assets available for this strategy.`,
    fix: `Reduce Top N to ${universeSize} or lower.`,
    action: {
      kind: "reduce_top_n",
      value: universeSize,
      label: `Reduce Top N to ${universeSize}`,
    },
  }]
}

function buildMlIssues(params: {
  input: z.infer<typeof runConfigSchema>
  snapshot: RunPreflightSnapshot
}): RunPreflightIssue[] {
  const { input, snapshot } = params
  if (!ML_STRATEGIES.has(input.strategy_id)) return []

  const benchmarkRow = snapshot.coverage.symbols.find((row) => row.isBenchmark)
  const universeRows = snapshot.coverage.symbols.filter((row) => !row.isBenchmark)
  const benchmarkFirstDate = benchmarkRow?.firstDate
  if (!benchmarkFirstDate) return []

  const minTrainDays = getMinTrainDays()
  const trainWindowDays = getTrainWindowDays()
  const trainWindowCalendarDays = getTrainWindowCalendarDays()
  const featureLookbackDays = 252
  const benchmarkFeatureLookbackDays = 60
  const lastTrainDate = dayBefore(input.start_date)
  if (lastTrainDate < benchmarkFirstDate) {
    return [{
      severity: "blocked",
      code: "ml_insufficient_training_history",
      reason: "This ML strategy needs more training history before the selected start date.",
      fix: "Pick a later start date, a smaller Top N, or a universe with longer history.",
      action: null,
    }]
  }

  const trainWindowStart = subtractCalendarDays(lastTrainDate, trainWindowCalendarDays)
  const benchmarkReadyDate = pickLaterDate(
    trainWindowStart,
    addCalendarDays(benchmarkFirstDate, benchmarkFeatureLookbackDays),
  )
  const trainDays = benchmarkReadyDate && benchmarkReadyDate <= lastTrainDate
    ? countBusinessDays(benchmarkReadyDate, lastTrainDate)
    : 0

  let trainRows = 0
  let investableCount = 0
  for (const row of universeRows) {
    if (!row.firstDate) continue
    const rowReadyDate = pickLaterDate(
      addCalendarDays(row.firstDate, featureLookbackDays),
      benchmarkReadyDate,
    )
    if (!rowReadyDate || rowReadyDate > lastTrainDate) continue
    trainRows += countBusinessDays(rowReadyDate, lastTrainDate)
    investableCount += 1
  }

  const avgSymbolsPerDay = trainDays > 0 ? trainRows / trainDays : 0
  const requiredRows = minTrainDays * input.top_n
  const issues: RunPreflightIssue[] = []

  if (investableCount < input.top_n && investableCount > 0) {
    issues.push({
      severity: "blocked",
      code: "top_n_above_investable_count",
      reason: `Top N is ${input.top_n}, but only ${investableCount} symbols have enough ML training history on this start date.`,
      fix: `Reduce Top N to ${investableCount} or choose a later start date.`,
      action: {
        kind: "reduce_top_n",
        value: investableCount,
        label: `Reduce Top N to ${investableCount}`,
      },
    })
  }

  if (investableCount === 0 || trainDays < minTrainDays || trainRows < requiredRows || avgSymbolsPerDay < Math.max(input.top_n, 2)) {
    issues.push({
      severity: "blocked",
      code: "ml_insufficient_training_history",
      reason: `This ML strategy needs more training history. We found ${trainDays} train days, ${trainRows} train rows, and ${avgSymbolsPerDay.toFixed(1)} symbols per day.`,
      fix: `Pick a later start date or reduce Top N. Current requirements are at least ${minTrainDays} train days, ${requiredRows} train rows, and ${Math.max(input.top_n, 2)} symbols per day.`,
      action: investableCount > 0 && investableCount < input.top_n
        ? {
          kind: "reduce_top_n",
          value: investableCount,
          label: `Reduce Top N to ${investableCount}`,
        }
        : null,
    })
  }

  if (trainWindowDays > 0 && trainDays < trainWindowDays) {
    issues.push({
      severity: "warning",
      code: "ml_training_window_short",
      reason: `This ML run has ${trainDays} pre-start train days, which is shorter than the configured ${trainWindowDays}-day rolling window.`,
      fix: "You can continue, but the model will begin with a smaller-than-configured training window.",
      action: null,
    })
  }

  return issues
}

async function buildRepairIssues(params: {
  input: z.infer<typeof runConfigSchema>
  userId: string
  snapshot: RunPreflightSnapshot
}): Promise<RunPreflightIssue[]> {
  const { input, userId, snapshot } = params
  const issues: RunPreflightIssue[] = []
  const requiredEnd = snapshot.requiredEnd
  const universeId = input.universe as UniverseId

  if (snapshot.constraints.missingTickers.length > 0) {
    const universeRepair = await ensureUniverseDataReadyInternal(universeId, userId, { createBatch: true })
    issues.push(buildRepairIssue({
      code: "universe_missing_data_repair_started",
      symbols: snapshot.constraints.missingTickers,
      failedSymbols: universeRepair.failedSymbols,
      reasonPrefix: "We're missing price history",
      waitingFix: "Wait for the repair batch to finish, then queue the run again.",
      retryLabel: "Retry the universe data repair.",
    }))
  }

  const benchmarkRow = snapshot.coverage.symbols.find((row) => row.isBenchmark)
  const universeRows = snapshot.coverage.symbols.filter((row) => !row.isBenchmark)

  const staleUniversePlans = universeRows
    .filter((row) => row.symbol !== input.benchmark)
    .filter((row) => row.firstDate && row.lastDate && row.lastDate < requiredEnd)
    .map((row) => ({
      symbol: row.symbol,
      desiredStart: nextDate(row.lastDate as string),
      desiredEnd: requiredEnd,
    }))

  if (staleUniversePlans.length > 0) {
    const universeRepair = await ensureSymbolRepairsInternal({
      plans: staleUniversePlans,
      userId,
      requestedBy: `run-preflight:${userId}:${input.universe}:universe`,
    })
    issues.push(buildRepairIssue({
      code: "universe_stale_data_repair_started",
      symbols: staleUniversePlans.map((plan) => plan.symbol),
      failedSymbols: universeRepair.failedSymbols,
      reasonPrefix: "Some universe prices are behind the selected end date",
      waitingFix: "Wait for the universe repair to finish, then queue the run again.",
      retryLabel: "Retry the universe repair.",
    }))
  }

  const benchmarkNeedsRepair = benchmarkRow && (
    benchmarkRow.firstDate === null ||
    (benchmarkRow.lastDate !== null && benchmarkRow.lastDate < requiredEnd)
  )
  if (benchmarkNeedsRepair && benchmarkRow) {
    const benchmarkRepair = await ensureSymbolRepairsInternal({
      plans: [{
        symbol: benchmarkRow.symbol,
        desiredStart: benchmarkRow.lastDate ? nextDate(benchmarkRow.lastDate) : defaultIngestStartDate(benchmarkRow.symbol),
        desiredEnd: requiredEnd,
      }],
      userId,
      requestedBy: `run-preflight:${userId}:${input.universe}:benchmark`,
    })
    issues.push(buildRepairIssue({
      code: "benchmark_repair_started",
      symbols: [benchmarkRow.symbol],
      failedSymbols: benchmarkRepair.failedSymbols,
      reasonPrefix: "The benchmark is missing required price history",
      waitingFix: "Wait for the benchmark repair to finish, then queue the run again.",
      retryLabel: "Retry the benchmark repair.",
    }))
  }

  if (input.strategy_id === "trend_filter") {
    const stats = await getTickerStatsSnapshot([TREND_DEFENSIVE_PRIMARY, TREND_DEFENSIVE_FALLBACK])
    const primary = stats.get(TREND_DEFENSIVE_PRIMARY) ?? { symbol: TREND_DEFENSIVE_PRIMARY, firstDate: null, lastDate: null }
    const fallback = stats.get(TREND_DEFENSIVE_FALLBACK) ?? { symbol: TREND_DEFENSIVE_FALLBACK, firstDate: null, lastDate: null }
    const primaryReady = Boolean(primary.firstDate && primary.lastDate && primary.lastDate >= requiredEnd)
    const fallbackReady = Boolean(fallback.firstDate && fallback.lastDate && fallback.lastDate >= requiredEnd)
    if (!primaryReady && !fallbackReady) {
      const repairTarget = primary.lastDate && primary.lastDate < requiredEnd
        ? primary
        : primary.firstDate
          ? fallback
          : primary
      const repairResult = await ensureSymbolRepairsInternal({
        plans: [{
          symbol: repairTarget.symbol,
          desiredStart: repairTarget.lastDate ? nextDate(repairTarget.lastDate) : defaultIngestStartDate(repairTarget.symbol),
          desiredEnd: requiredEnd,
        }],
        userId,
        requestedBy: `run-preflight:${userId}:${input.universe}:defensive`,
      })
      issues.push(buildRepairIssue({
        code: "trend_defensive_repair_started",
        symbols: [repairTarget.symbol],
        failedSymbols: repairResult.failedSymbols,
        reasonPrefix: "Trend Filter needs a defensive risk-off asset",
        waitingFix: "Wait for the defensive asset repair to finish, then queue the run again.",
        retryLabel: "Retry the defensive asset repair.",
      }))
    }
  }

  return issues
}

function getRepairableUniverseSymbols(snapshot: RunPreflightSnapshot): Set<string> {
  return new Set(
    snapshot.coverage.symbols
      .filter((row) => !row.isBenchmark)
      .filter((row) => row.firstDate && row.lastDate && row.lastDate < snapshot.requiredEnd)
      .map((row) => row.symbol)
  )
}

function getRepairableBenchmarkSymbol(snapshot: RunPreflightSnapshot): string | null {
  const benchmarkRow = snapshot.coverage.symbols.find((row) => row.isBenchmark)
  if (!benchmarkRow) return null
  if (benchmarkRow.firstDate === null) return benchmarkRow.symbol
  if (benchmarkRow.lastDate !== null && benchmarkRow.lastDate < snapshot.requiredEnd) {
    return benchmarkRow.symbol
  }
  return null
}

function getStatusRank(status: "ok" | "warn" | "block"): number {
  if (status === "ok") return 0
  if (status === "warn") return 1
  return 2
}

function pickBenchmarkSuggestion(params: {
  snapshot: RunPreflightSnapshot
  currentBenchmark: string
  currentStatus: "ok" | "warn" | "block"
}): string | null {
  const { snapshot, currentBenchmark, currentStatus } = params
  const currentRank = getStatusRank(currentStatus)
  const suggestion = snapshot.coverage.benchmarkCandidates.find((candidate) =>
    candidate.symbol !== currentBenchmark && getStatusRank(candidate.status) < currentRank
  )
  return suggestion?.symbol ?? null
}

function buildCoverageIssues(params: {
  input: z.infer<typeof runConfigSchema>
  snapshot: RunPreflightSnapshot
}): RunPreflightIssue[] {
  const { input, snapshot } = params
  const issues: RunPreflightIssue[] = []
  const repairableUniverseSymbols = getRepairableUniverseSymbols(snapshot)
  const repairableBenchmarkSymbol = getRepairableBenchmarkSymbol(snapshot)
  const benchmarkRow = snapshot.coverage.symbols.find((row) => row.isBenchmark)
  const universeRows = snapshot.coverage.symbols.filter(
    (row) => !row.isBenchmark && !repairableUniverseSymbols.has(row.symbol)
  )
  const benchmarkCoverage = repairableBenchmarkSymbol
    ? {
      status: "good",
      reason: null,
      metricSourceUsed: snapshot.coverage.benchmark.metricSourceUsed,
      trueMissingRate: 0,
      symbol: input.benchmark,
      windowStartUsed: benchmarkRow?.windowStart ?? snapshot.coverage.benchmark.windowStartUsed,
      windowEndUsed: snapshot.coverage.benchmark.windowEndUsed,
      expectedDays: benchmarkRow?.expectedDays ?? 0,
      actualDays: benchmarkRow?.actualDays ?? 0,
      missingDays: benchmarkRow?.trueMissingDays ?? 0,
    }
    : snapshot.coverage.benchmark
  const universeCoverage = buildUniverseCoverageStatus({
    strategyId: input.strategy_id,
    universeRows,
  })
  const combinedStatus: "ok" | "warn" | "block" =
    benchmarkCoverage.status === "blocked" || universeCoverage.status === "blocked"
      ? "block"
      : benchmarkCoverage.status === "warning" || universeCoverage.status === "warning"
        ? "warn"
        : "ok"
  const benchmarkSuggestion = pickBenchmarkSuggestion({
    snapshot,
    currentBenchmark: input.benchmark,
    currentStatus: combinedStatus,
  })

  if (benchmarkCoverage.status === "blocked" && benchmarkCoverage.reason) {
    issues.push({
      severity: "blocked",
      code: "benchmark_missingness_blocked",
      reason: benchmarkCoverage.reason,
      fix: benchmarkSuggestion
        ? `Choose ${benchmarkSuggestion} instead of ${input.benchmark}, or pick an earlier end date.`
        : `Pick an earlier end date or choose another benchmark instead of ${input.benchmark}.`,
      action: benchmarkSuggestion
        ? {
          kind: "change_benchmark",
          value: benchmarkSuggestion,
          label: `Use ${benchmarkSuggestion}`,
        }
        : null,
    })
  } else if (benchmarkCoverage.status === "warning" && benchmarkCoverage.reason) {
    issues.push({
      severity: "warning",
      code: "benchmark_missingness_warning",
      reason: benchmarkCoverage.reason,
      fix: benchmarkSuggestion
        ? `You can continue, but comparisons versus ${input.benchmark} may be noisy. ${benchmarkSuggestion} is a cleaner alternative for this window.`
        : `You can continue, but comparisons versus ${input.benchmark} may be noisy.`,
      action: null,
    })
  }

  if (universeCoverage.status === "blocked" && universeCoverage.reason) {
    issues.push({
      severity: "blocked",
      code: universeCoverage.over10Percent.length > 0
        ? "universe_missingness_per_ticker_blocked"
        : "universe_missingness_share_blocked",
      reason: universeCoverage.reason,
      fix: benchmarkSuggestion
        ? `Choose ${benchmarkSuggestion}, a later start date, an earlier end date, or a different universe.`
        : "Choose a later start date, an earlier end date, or a different universe.",
      action: benchmarkSuggestion
        ? {
          kind: "change_benchmark",
          value: benchmarkSuggestion,
          label: `Use ${benchmarkSuggestion}`,
        }
        : null,
    })
  } else if (universeCoverage.status === "warning" && universeCoverage.reason) {
    issues.push({
      severity: "warning",
      code: "universe_missingness_warning",
      reason: universeCoverage.reason,
      fix: "You can continue, but this missingness may affect rankings and risk estimates.",
      action: null,
    })
  }

  return issues
}

function buildPersistedPreflightSnapshot(preflight: RunPreflightResult, acknowledged: boolean) {
  return {
    data_cutoff_date: preflight.constraints.dataCutoffDate,
    universe_earliest_start: preflight.constraints.universeEarliestStart,
    universe_valid_from: preflight.constraints.universeValidFrom,
    min_start_date: preflight.constraints.minStartDate,
    max_end_date: preflight.constraints.maxEndDate,
    missing_tickers: preflight.constraints.missingTickers,
    warmup_start: preflight.warmupStart,
    required_start: preflight.requiredStart,
    required_end: preflight.requiredEnd,
    benchmark_coverage_health: preflight.coverage.benchmark,
    universe_missingness_summary: preflight.coverage.universe,
    benchmark_candidates: preflight.coverage.benchmarkCandidates,
    issues: preflight.issues,
    reasons: preflight.reasons,
    warnings_acknowledged: acknowledged,
    status: preflight.status,
  }
}

function dedupeIssues(issues: RunPreflightIssue[]): RunPreflightIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = JSON.stringify(issue)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function preflightRunInternal(
  input: RunConfigInput,
  userId: string,
): Promise<RunPreflightResult> {
  const parsed = runConfigSchema.safeParse(input)
  const universe = (parsed.success ? parsed.data.universe : "ETF8") as UniverseId
  const constraints = await getUniverseConstraintsSnapshot(universe)

  if (!parsed.success) {
    return buildErrorPreflightResult(parsed.error.issues[0].message, constraints)
  }

  const cutoffDate = constraints.dataCutoffDate ?? getLastCompleteTradingDayUtc()
  const snapshot = await evaluateRunPreflightSnapshot({
    strategyId: parsed.data.strategy_id,
    startDate: parsed.data.start_date,
    endDate: parsed.data.end_date,
    universeSymbols: resolveUniverseSymbols(parsed.data.universe),
    benchmark: parsed.data.benchmark,
    dataCutoffDate: cutoffDate,
    universeEarliestStart: constraints.universeEarliestStart,
    universeValidFrom: constraints.universeValidFrom,
    missingTickers: constraints.missingTickers,
  })

  const issues = dedupeIssues([
    ...buildDateIssues(snapshot, parsed.data),
    ...(await buildRepairIssues({
      input: parsed.data,
      userId,
      snapshot,
    })),
    ...buildCoverageIssues({
      input: parsed.data,
      snapshot,
    }),
    ...buildTopNIssues({
      input: parsed.data,
      universeSize: resolveUniverseSymbols(parsed.data.universe as UniverseId).length,
    }),
    ...buildMlIssues({
      input: parsed.data,
      snapshot,
    }),
  ])

  return finalizeRunPreflightResult({
    constraints: snapshot.constraints,
    coverage: snapshot.coverage,
    warmupStart: snapshot.warmupStart,
    requiredStart: snapshot.requiredStart,
    requiredEnd: snapshot.requiredEnd,
    issues,
  })
}

export async function ensureUniverseDataReady(
  universe: UniverseId,
  options: EnsureUniverseOptions = {}
): Promise<EnsureUniverseDataReadyResult> {
  const userId = await getAuthenticatedUserId()
  const constraints = await getUniverseConstraintsSnapshot(universe)

  if (!userId) {
    return {
      ready: false,
      batchId: null,
      queuedSymbols: [],
      widenedSymbols: [],
      activeSymbols: [],
      failedSymbols: [],
      constraints,
    }
  }

  return ensureUniverseDataReadyInternal(universe, userId, options)
}

export async function getUniverseBatchStatusAction(
  batchId: string
): Promise<UniverseBatchStatusSummary | null> {
  const userId = await getAuthenticatedUserId()
  if (!userId) return null
  return getUniverseBatchStatus(batchId)
}

export async function retryPreflightRepairs(params: {
  symbols: string[]
  required_end: string
}): Promise<RetryPreflightRepairsResult> {
  const userId = await getAuthenticatedUserId()
  if (!userId) {
    return { ok: false, error: "Authentication required. Please sign in." }
  }

  const requiredEnd = normalizeDate(params.required_end)
  if (!requiredEnd) {
    return { ok: false, error: "A valid repair end date is required." }
  }

  const stats = await getTickerStatsSnapshot(params.symbols)
  const plans = params.symbols.map((rawSymbol) => {
    const symbol = rawSymbol.toUpperCase()
    const snapshot = stats.get(symbol)
    return {
      symbol,
      desiredStart:
        snapshot?.lastDate && snapshot.lastDate < requiredEnd
          ? nextDate(snapshot.lastDate)
          : defaultIngestStartDate(symbol),
      desiredEnd: requiredEnd,
    }
  })

  const repairBatch = await ensureSymbolRepairsInternal({
    plans,
    userId,
    requestedBy: `run-preflight-retry:${userId}`,
  })

  return {
    ok: true,
    ...repairBatch,
  }
}

export async function preflightRun(
  input: RunConfigInput
): Promise<RunPreflightResult> {
  const userId = await getAuthenticatedUserId()
  const universe = (input.universe ?? "ETF8") as UniverseId
  const constraints = await getUniverseConstraintsSnapshot(universe)

  if (!userId) {
    return buildErrorPreflightResult("Authentication required. Please sign in.", constraints)
  }

  return preflightRunInternal(input, userId)
}

export async function createRun(
  input: z.input<typeof createRunSchema>
): Promise<CreateRunResult> {
  const parsed = createRunSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message }
  }

  const userId = await getAuthenticatedUserId()
  if (!userId) {
    return { ok: false, error: "Authentication required. Please sign in." }
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
  } = parsed.data
  const universeId = universe as UniverseId

  const preflight = await preflightRunInternal({
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
  }, userId)

  if (preflight.status === "block") {
    return {
      ok: false,
      error: preflight.reasons.join(" "),
      preflight,
    }
  }

  if (preflight.status === "warn" && !acknowledge_warnings) {
    return {
      ok: false,
      error: "Please acknowledge the warning before queueing this backtest.",
      preflight,
    }
  }

  const effectiveCostsBps = apply_costs ? costs_bps : 0
  const universeSize = (UNIVERSE_PRESETS[universeId] ?? []).length
  const top_n = Math.min(topNRaw, Math.max(1, universeSize))
  const universeSymbols = resolveUniverseSymbols(universeId)
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
  }

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
  }

  const serverClient = await createClient()

  let { data: run, error: runError } = await serverClient
    .from("runs")
    .insert({ ...basePayload, status: "queued", benchmark })
    .select("id")
    .single()

  if (runError && isMissingBenchmarkColumnError(runError.message)) {
    const fallback = await serverClient
      .from("runs")
      .insert({ ...basePayload, status: "queued" })
      .select("id")
      .single()
    run = fallback.data
    runError = fallback.error
  }

  if (runError || !run) {
    console.error("createRun insert error:", runError?.message)
    return { ok: false, error: "Failed to create run. Check server env + database config.", preflight }
  }

  const { error: jobError } = await serverClient.from("jobs").insert({
    run_id: run.id,
    name,
    status: "queued",
    stage: "ingest",
    progress: 0,
  })

  if (jobError) {
    console.error("createRun job insert error:", jobError.message)
    await serverClient.from("runs").delete().eq("id", run.id)
    return { ok: false, error: "Failed to queue run for processing. Please try again.", preflight }
  }

  triggerWorker()
  return { ok: true, runId: run.id, preflight }
}

export async function deleteRunAction(runId: string): Promise<DeleteRunActionResult | never> {
  const parsedRunId = z.string().uuid().safeParse(runId)
  if (!parsedRunId.success) {
    return { error: "Invalid run ID." }
  }

  const serverClient = await createClient()
  const { data: { user }, error: userError } = await serverClient.auth.getUser()
  if (userError || !user) {
    return { error: "Authentication required. Please sign in." }
  }

  const { data: run, error: runError } = await serverClient
    .from("runs")
    .select("id, status, user_id")
    .eq("id", parsedRunId.data)
    .maybeSingle()

  if (runError) {
    console.error("deleteRunAction run lookup error:", runError.message)
    return { error: "Unable to load this run right now." }
  }

  if (!run || run.user_id !== user.id) {
    return { error: "You can only delete your own runs." }
  }

  if (RUN_DELETE_BLOCKED_STATUSES.has(run.status)) {
    return { error: "Delete is disabled while this run is queued, running, or waiting for data." }
  }

  const admin = createAdminClient()
  const { data: reportRow, error: reportError } = await admin
    .from("reports")
    .select("storage_path")
    .eq("run_id", parsedRunId.data)
    .maybeSingle()

  if (reportError) {
    console.error("deleteRunAction report lookup error:", reportError.message)
    return { error: "Unable to clean up this run's report." }
  }

  if (reportRow?.storage_path) {
    const reportsBucket = resolveReportsBucketName(process.env.SUPABASE_REPORTS_BUCKET)
    const { error: storageError } = await admin.storage
      .from(reportsBucket)
      .remove([reportRow.storage_path])

    if (storageError) {
      const message = storageError.message.toLowerCase()
      const isMissingObject = message.includes("not found") || message.includes("does not exist")
      if (!isMissingObject) {
        console.error("deleteRunAction storage cleanup error:", storageError.message)
        return { error: "Unable to delete the stored report for this run." }
      }
    }
  }

  // data_ingest_jobs links use ON DELETE SET NULL, so delete them explicitly
  // before removing the run to avoid leaving orphaned preflight jobs behind.
  const { error: ingestDeleteError } = await admin
    .from("data_ingest_jobs")
    .delete()
    .eq("requested_by_run_id", parsedRunId.data)

  if (ingestDeleteError && !ingestDeleteError.message.toLowerCase().includes("could not find the table")) {
    console.error("deleteRunAction data_ingest_jobs cleanup error:", ingestDeleteError.message)
    return { error: "Unable to delete linked ingest jobs for this run." }
  }

  const { error: deleteError } = await serverClient
    .from("runs")
    .delete()
    .eq("id", parsedRunId.data)

  if (deleteError) {
    console.error("deleteRunAction run delete error:", deleteError.message)
    return { error: "Unable to delete this run right now." }
  }

  revalidatePath("/runs")
  revalidatePath("/dashboard")
  redirect("/runs?deleted=1")
}
