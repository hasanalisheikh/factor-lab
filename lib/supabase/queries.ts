import "server-only"
import { createClient } from "./server"
import { createAdminClient } from "./admin"
import {
  BENCHMARK_OPTIONS,
  getRunBenchmark,
  inferPossibleOverlapFromUniverse,
  isBenchmarkHeldAtLatestRebalance,
  type BenchmarkOverlapState,
} from "@/lib/benchmark"
import type {
  RunRow,
  RunMetricsRow,
  EquityCurveRow,
  ReportRow,
  JobRow,
  PriceRow,
  DataLastUpdatedRow,
  ModelMetadataRow,
  ModelPredictionRow,
  PositionRow,
  UserSettings,
  RunWithMetrics,
  CompareRunBundle,
  TickerMissingness,
  BenchmarkCoverage,
  DataIngestJobStatus,
} from "./types"
import { COVERAGE_WINDOW_START } from "./types"

// Re-export for server-side consumers that import types from this module
export type {
  RunRow,
  RunMetricsRow,
  EquityCurveRow,
  ReportRow,
  JobRow,
  PriceRow,
  DataLastUpdatedRow,
  ModelMetadataRow,
  ModelPredictionRow,
  PositionRow,
  UserSettings,
  RunWithMetrics,
  CompareRunBundle,
  TickerMissingness,
  BenchmarkCoverage,
  DataIngestJobStatus,
}
export { COVERAGE_WINDOW_START }

export type DataHealthSummary = {
  tickersCount: number
  dateStart: string | null
  dateEnd: string | null
  businessDaysInWindow: number
  expectedTickerDays: number
  actualTickerDays: number
  missingTickerDays: number
  completenessPercent: number | null
  lastUpdatedAt: string | null
}


export type IngestionLogEntry = {
  id: string
  ingested_at: string
  status: string
  tickers_updated: number
  rows_upserted: number
  note: string | null
  source: string
}

type RunBenchmarkContext = Pick<
  RunRow,
  "id" | "benchmark" | "benchmark_ticker" | "strategy_id" | "universe_symbols"
>

type GetRunsOptions = {
  limit?: number
  search?: string
  status?: string
  strategy?: string
  universe?: string
}

function isMissingBenchmarkColumnError(message?: string): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return m.includes("benchmark") && m.includes("does not exist")
}

function isMissingPositionsTableError(message?: string): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return m.includes("public.positions") && m.includes("could not find the table")
}

export async function getRuns(options: GetRunsOptions = {}): Promise<RunWithMetrics[]> {
  const { limit = 100, search, status, strategy, universe } = options
  try {
    const supabase = await createClient()
    let queryWithBenchmark = supabase
      .from("runs")
      .select(`
        id,
        name,
        strategy_id,
        status,
        benchmark,
        benchmark_ticker,
        start_date,
        end_date,
        created_at,
        run_metrics(run_id, cagr, sharpe, max_drawdown, turnover)
      `)
      .order("created_at", { ascending: false })

    if (search) {
      queryWithBenchmark = queryWithBenchmark.ilike("name", `%${search}%`)
    }
    if (status) {
      queryWithBenchmark = queryWithBenchmark.eq("status", status)
    }
    if (strategy) {
      queryWithBenchmark = queryWithBenchmark.eq("strategy_id", strategy)
    }
    if (universe) {
      queryWithBenchmark = queryWithBenchmark.eq("universe", universe)
    }
    if (limit > 0) {
      queryWithBenchmark = queryWithBenchmark.limit(limit)
    }

    let { data, error } = await queryWithBenchmark
    if (error && isMissingBenchmarkColumnError(error.message)) {
      let queryLegacy = supabase
        .from("runs")
        .select(`
          id,
          name,
          strategy_id,
          status,
          benchmark_ticker,
          start_date,
          end_date,
          created_at,
          run_metrics(run_id, cagr, sharpe, max_drawdown, turnover)
        `)
        .order("created_at", { ascending: false })

      if (search) {
        queryLegacy = queryLegacy.ilike("name", `%${search}%`)
      }
      if (status) {
        queryLegacy = queryLegacy.eq("status", status)
      }
      if (strategy) {
        queryLegacy = queryLegacy.eq("strategy_id", strategy)
      }
      if (universe) {
        queryLegacy = queryLegacy.eq("universe", universe)
      }
      if (limit > 0) {
        queryLegacy = queryLegacy.limit(limit)
      }
      const fallback = await queryLegacy
      data = fallback.data
      error = fallback.error
    }

    if (error) {
      console.error("getRuns error:", error.message)
      return []
    }

    return (data ?? []) as RunWithMetrics[]
  } catch (err) {
    console.error("getRuns exception:", err)
    return []
  }
}

export async function getRunsCount(options: Omit<GetRunsOptions, "limit"> = {}): Promise<number> {
  const { search, status, strategy, universe } = options
  try {
    const supabase = await createClient()
    let query = supabase.from("runs").select("*", { count: "exact", head: true })

    if (search) {
      query = query.ilike("name", `%${search}%`)
    }
    if (status) {
      query = query.eq("status", status)
    }
    if (strategy) {
      query = query.eq("strategy_id", strategy)
    }
    if (universe) {
      query = query.eq("universe", universe)
    }

    const { count, error } = await query

    if (error) {
      console.error("getRunsCount error:", error.message)
      return 0
    }
    return count ?? 0
  } catch (err) {
    console.error("getRunsCount exception:", err)
    return 0
  }
}

export async function getRunById(id: string): Promise<RunWithMetrics | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("runs")
      .select("*, run_metrics(*)")
      .eq("id", id)
      .maybeSingle()

    if (error || !data) return null

    return data as RunWithMetrics
  } catch (err) {
    console.error("getRunById exception:", err)
    return null
  }
}

export async function getEquityCurve(runId: string): Promise<EquityCurveRow[]> {
  try {
    const supabase = await createClient()
    // PostgREST hard-caps responses at 1000 rows. A 5-year daily run has ~1255
    // rows, so we must paginate to avoid silently truncating the series.
    const PAGE = 1000
    const all: EquityCurveRow[] = []
    let offset = 0
    while (true) {
      const { data, error } = await supabase
        .from("equity_curve")
        .select("*")
        .eq("run_id", runId)
        .order("date", { ascending: true })
        .range(offset, offset + PAGE - 1)

      if (error) {
        console.error("getEquityCurve error:", error.message)
        return []
      }
      const page = (data ?? []) as EquityCurveRow[]
      all.push(...page)
      if (page.length < PAGE) break
      offset += PAGE
    }
    return all
  } catch (err) {
    console.error("getEquityCurve exception:", err)
    return []
  }
}

export async function getJobs(): Promise<JobRow[]> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("getJobs error:", error.message)
      return []
    }

    return (data ?? []) as JobRow[]
  } catch (err) {
    console.error("getJobs exception:", err)
    return []
  }
}

export async function getReportByRunId(runId: string): Promise<ReportRow | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return null

    return data as ReportRow
  } catch (err) {
    console.error("getReportByRunId exception:", err)
    return null
  }
}

export async function getJobByRunId(runId: string): Promise<JobRow | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return null

    return data as JobRow
  } catch (err) {
    console.error("getJobByRunId exception:", err)
    return null
  }
}

export async function getMostRecentCompletedRun(): Promise<RunWithMetrics | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("runs")
      .select("*, run_metrics(*)")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return null

    return data as RunWithMetrics
  } catch (err) {
    console.error("getMostRecentCompletedRun exception:", err)
    return null
  }
}

export async function getModelMetadataByRunId(runId: string): Promise<ModelMetadataRow | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("model_metadata")
      .select("*")
      .eq("run_id", runId)
      .maybeSingle()

    if (error || !data) return null
    return data as ModelMetadataRow
  } catch (err) {
    console.error("getModelMetadataByRunId exception:", err)
    return null
  }
}

export async function getModelPredictionsByRunId(runId: string): Promise<ModelPredictionRow[]> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("model_predictions")
      .select("*")
      .eq("run_id", runId)
      .order("as_of_date", { ascending: false })
      .order("rank", { ascending: true })
      .limit(500)

    if (error) {
      console.error("getModelPredictionsByRunId error:", error.message)
      return []
    }
    return (data ?? []) as ModelPredictionRow[]
  } catch (err) {
    console.error("getModelPredictionsByRunId exception:", err)
    return []
  }
}

export async function getStrategyComparisonRuns(): Promise<RunWithMetrics[]> {
  const empty: RunWithMetrics[] = []
  try {
    const supabase = await createClient()
    const strategies = ["equal_weight", "momentum_12_1", "low_vol", "trend_filter", "ml_ridge", "ml_lightgbm"]

    // Single query: fetch recent completed runs across all strategies, then pick latest per strategy in JS.
    // limit(30) gives ~5 per strategy on average which is more than enough.
    const { data, error } = await supabase
      .from("runs")
      .select("*, run_metrics(*)")
      .in("strategy_id", strategies)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(30)

    if (error || !data) return empty

    const seen = new Set<string>()
    const results: RunWithMetrics[] = []
    for (const row of data as RunWithMetrics[]) {
      if (!seen.has(row.strategy_id)) {
        seen.add(row.strategy_id)
        results.push(row)
      }
    }
    return results
  } catch (err) {
    console.error("getStrategyComparisonRuns exception:", err)
    return empty
  }
}

export async function getCompareRunBundles(limit = 30): Promise<CompareRunBundle[]> {
  try {
    const supabase = await createClient()
    const { data: runsData, error: runsError } = await supabase
      .from("runs")
      .select("*, run_metrics(*)")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (runsError || !runsData || runsData.length === 0) {
      if (runsError) {
        console.error("getCompareRunBundles runs error:", runsError.message)
      }
      return []
    }

    const runs = runsData as RunWithMetrics[]
    const runIds = runs.map((r) => r.id)
    const { data: equityRows, error: eqError } = await supabase
      .from("equity_curve")
      .select("*")
      .in("run_id", runIds)
      .order("date", { ascending: true })

    if (eqError) {
      console.error("getCompareRunBundles equity error:", eqError.message)
      return []
    }

    const grouped = new Map<string, EquityCurveRow[]>()
    for (const row of (equityRows ?? []) as EquityCurveRow[]) {
      const arr = grouped.get(row.run_id) ?? []
      arr.push(row)
      grouped.set(row.run_id, arr)
    }

    const bundles: CompareRunBundle[] = []
    for (const run of runs) {
      const metrics = Array.isArray(run.run_metrics)
        ? run.run_metrics[0]
        : run.run_metrics
      const equity = grouped.get(run.id) ?? []
      if (!metrics || equity.length === 0) continue
      bundles.push({
        run: run as RunRow,
        metrics,
        equity,
      })
    }
    return bundles
  } catch (err) {
    console.error("getCompareRunBundles exception:", err)
    return []
  }
}

export type DataCoverage = {
  minDate: string | null
  maxDate: string | null
}

export async function getDataCoverage(): Promise<DataCoverage> {
  try {
    const supabase = createAdminClient()
    type AggRow = { ticker_count: number; min_date: string | null; max_date: string | null; actual_rows: number }
    const { data, error } = await supabase.rpc("get_data_health_agg") as unknown as {
      data: AggRow | null
      error: { message: string } | null
    }
    if (!error && data) {
      return { minDate: data.min_date, maxDate: data.max_date }
    }
    const [minRes, maxRes] = await Promise.all([
      supabase.from("prices").select("date").order("date", { ascending: true }).limit(1),
      supabase.from("prices").select("date").order("date", { ascending: false }).limit(1),
    ])
    return {
      minDate: minRes.data?.[0]?.date ?? null,
      maxDate: maxRes.data?.[0]?.date ?? null,
    }
  } catch {
    return { minDate: null, maxDate: null }
  }
}

export async function getDataHealthSummary(): Promise<DataHealthSummary> {
  const empty: DataHealthSummary = {
    tickersCount: 0,
    dateStart: null,
    dateEnd: null,
    businessDaysInWindow: 0,
    expectedTickerDays: 0,
    actualTickerDays: 0,
    missingTickerDays: 0,
    completenessPercent: null,
    lastUpdatedAt: null,
  }

  try {
    const supabase = createAdminClient()

    // Try the efficient RPC aggregate first (requires migration 20260305_data_enhancements.sql).
    // Fall back to individual queries if the function isn't deployed yet.
    // Note: both promises are started before either is awaited, so they run in parallel.
    // Cast the RPC promise — the function isn't in the generated schema types yet
    // (requires migration 20260305_data_enhancements.sql to be applied first).
    type AggRow = { ticker_count: number; min_date: string | null; max_date: string | null; actual_rows: number }
    const aggResPromise = supabase.rpc("get_data_health_agg") as unknown as Promise<{
      data: AggRow | null
      error: { message: string } | null
    }>
    const lastUpdatedResPromise = supabase
      .from("data_last_updated")
      .select("last_updated_at, tickers_ingested")
      .eq("source", "yfinance_sp100")
      .maybeSingle()
    const aggRes = await aggResPromise
    const lastUpdatedRes = await lastUpdatedResPromise

    let tickersCount: number
    let dateStart: string | null
    let dateEnd: string | null
    let actualTickerDays: number

    if (!aggRes.error && aggRes.data) {
      const agg = aggRes.data as {
        ticker_count: number
        min_date: string | null
        max_date: string | null
        actual_rows: number
      }
      tickersCount = agg.ticker_count ?? 0
      dateStart = agg.min_date ?? null
      dateEnd = agg.max_date ?? null
      actualTickerDays = agg.actual_rows ?? 0
    } else {
      // Fallback: use data_last_updated.tickers_ingested for count,
      // and separate lightweight queries for dates and row count.
      const [minDateRes, maxDateRes, rowsCountRes] = await Promise.all([
        supabase.from("prices").select("date").order("date", { ascending: true }).limit(1),
        supabase.from("prices").select("date").order("date", { ascending: false }).limit(1),
        supabase.from("prices").select("*", { count: "exact", head: true }),
      ])
      tickersCount = lastUpdatedRes.data?.tickers_ingested ?? 0
      dateStart = minDateRes.data?.[0]?.date ?? null
      dateEnd = maxDateRes.data?.[0]?.date ?? null
      actualTickerDays = rowsCountRes.count ?? 0
    }

    let businessDaysInWindow = 0
    let expectedTickerDays = 0
    let missingTickerDays = 0
    let completenessPercent: number | null = null

    if (tickersCount > 0 && dateStart && dateEnd) {
      // Count Mon–Fri business days across the full coverage window
      const start = new Date(`${dateStart}T00:00:00Z`)
      const end = new Date(`${dateEnd}T00:00:00Z`)
      const current = new Date(start)
      while (current <= end) {
        const day = current.getUTCDay()
        if (day !== 0 && day !== 6) businessDaysInWindow++
        current.setUTCDate(current.getUTCDate() + 1)
      }
      expectedTickerDays = businessDaysInWindow * tickersCount
      missingTickerDays = Math.max(expectedTickerDays - actualTickerDays, 0)
      completenessPercent =
        expectedTickerDays > 0
          ? Math.min((actualTickerDays / expectedTickerDays) * 100, 100)
          : null
    }

    return {
      tickersCount,
      dateStart,
      dateEnd,
      businessDaysInWindow,
      expectedTickerDays,
      actualTickerDays,
      missingTickerDays,
      completenessPercent,
      lastUpdatedAt: lastUpdatedRes.data?.last_updated_at ?? null,
    }
  } catch (err) {
    console.error("getDataHealthSummary exception:", err)
    return empty
  }
}

export async function getTopMissingTickers(
  limit: number,
  businessDaysInWindow: number
): Promise<TickerMissingness[]> {
  if (businessDaysInWindow === 0) return []

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc("get_ticker_day_counts")

    if (error) {
      // Silently skip if the RPC function doesn't exist yet (migration pending)
      if (!error.message.includes("Could not find the function")) {
        console.error("getTopMissingTickers error:", error.message)
      }
      return []
    }

    const rows = (data ?? []) as { ticker: string; actual_days: number }[]
    return rows
      .map(({ ticker, actual_days }) => {
        const actualDays = Number(actual_days)
        const missingDays = Math.max(businessDaysInWindow - actualDays, 0)
        const coveragePercent = Math.min((actualDays / businessDaysInWindow) * 100, 100)
        return { ticker, actualDays, missingDays, coveragePercent }
      })
      .filter((r) => r.missingDays > 0)
      .sort((a, b) => b.missingDays - a.missingDays)
      .slice(0, limit)
  } catch (err) {
    console.error("getTopMissingTickers exception:", err)
    return []
  }
}

export async function getBenchmarkCoverage(
  ticker: string,
  dateStart: string | null,
  dateEnd: string | null,
  businessDaysInWindow: number
): Promise<BenchmarkCoverage | null> {
  if (!dateStart || !dateEnd || businessDaysInWindow === 0) return null

  // Normalize: yfinance stores tickers as uppercase, user input may differ
  const normalizedTicker = ticker.trim().toUpperCase()

  try {
    const supabase = createAdminClient()
    const { count, error } = await supabase
      .from("prices")
      .select("*", { count: "exact", head: true })
      .eq("ticker", normalizedTicker)
      .gte("date", dateStart)
      .lte("date", dateEnd)

    if (error) {
      console.error("getBenchmarkCoverage error:", error.message)
      return null
    }

    const actualDays = count ?? 0

    // When 0 rows found: run a diagnostic to detect symbol mismatches or missing ingestion
    let debugSimilarTickers: string[] | undefined
    let latestDate: string | null = null
    let earliestDate: string | null = null
    if (actualDays === 0) {
      const prefix = normalizedTicker.slice(0, 3)
      const { data: similarRows } = await supabase
        .from("prices")
        .select("ticker")
        .ilike("ticker", `%${prefix}%`)
        .limit(30)
      const similar = [...new Set((similarRows ?? []).map((r) => r.ticker as string))].slice(0, 10)
      console.warn(
        `[getBenchmarkCoverage] 0 rows for "${normalizedTicker}" in prices [${dateStart}–${dateEnd}]. ` +
          `Similar tickers found: ${similar.join(", ") || "(none)"}. ` +
          `If empty, "${normalizedTicker}" is not in the prices table — ingest it or check the benchmark setting.`
      )
      if (process.env.NODE_ENV !== "production") {
        debugSimilarTickers = similar
      }
    } else {
      // Fetch the earliest and latest dates for this ticker (may differ from global window)
      const [latestRow, earliestRow] = await Promise.all([
        supabase
          .from("prices")
          .select("date")
          .eq("ticker", normalizedTicker)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("prices")
          .select("date")
          .eq("ticker", normalizedTicker)
          .order("date", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ])
      latestDate = latestRow.data?.date ?? null
      earliestDate = earliestRow.data?.date ?? null
    }

    const expectedDays = businessDaysInWindow
    const missingDays = Math.max(expectedDays - actualDays, 0)
    const coveragePercent =
      expectedDays > 0 ? Math.min((actualDays / expectedDays) * 100, 100) : 0

    const status: BenchmarkCoverage["status"] =
      actualDays === 0
        ? "not_ingested"
        : coveragePercent < 50
          ? "missing"
          : coveragePercent < 99
            ? "partial"
            : "ok"

    const needsHistoricalBackfill =
      earliestDate !== null && earliestDate > COVERAGE_WINDOW_START

    return {
      ticker: normalizedTicker,
      actualDays,
      expectedDays,
      missingDays,
      coveragePercent,
      latestDate,
      earliestDate,
      needsHistoricalBackfill,
      status,
      debugSimilarTickers,
    }
  } catch (err) {
    console.error("getBenchmarkCoverage exception:", err)
    return null
  }
}

export async function getLatestDataIngestJob(ticker: string): Promise<DataIngestJobStatus | null> {
  const normalizedTicker = ticker.trim().toUpperCase()
  try {
    const supabase = createAdminClient()
    // Fetch the 20 most-recent data_ingest jobs and filter by ticker client-side
    // (JSONB @> filtering may not be available in all environments)
    const { data, error } = await supabase
      .from("jobs")
      .select("id, status, stage, progress, error_message, created_at, started_at, payload, job_type")
      .eq("job_type", "data_ingest")
      .order("created_at", { ascending: false })
      .limit(20)

    if (error) {
      // Column likely doesn't exist yet — migration not applied, silently skip
      if (error.message.includes("job_type") || error.message.includes("does not exist")) return null
      console.error("getLatestDataIngestJob error:", error.message)
      return null
    }

    const match = (data ?? []).find((j) => {
      const p = j.payload as { ticker?: string } | null
      return p?.ticker?.toUpperCase() === normalizedTicker
    })
    if (!match) return null

    return {
      id: match.id,
      status: match.status,
      stage: match.stage,
      progress: match.progress,
      error_message: match.error_message,
      created_at: match.created_at ?? null,
      started_at: match.started_at ?? null,
    }
  } catch (err) {
    console.error("getLatestDataIngestJob exception:", err)
    return null
  }
}

/** Fetch coverage for all 8 BENCHMARK_OPTIONS in a single query. */
export async function getAllBenchmarkCoverage(
  dateStart: string | null,
  dateEnd: string | null,
  businessDaysInWindow: number
): Promise<BenchmarkCoverage[]> {
  const tickers = [...BENCHMARK_OPTIONS]
  try {
    const supabase = createAdminClient()

    // Single query: aggregate per ticker within the coverage window
    const { data, error } = await supabase
      .from("prices")
      .select("ticker, date")
      .in("ticker", tickers)
      .gte("date", dateStart ?? "1900-01-01")
      .lte("date", dateEnd ?? "9999-12-31")

    if (error) {
      console.error("getAllBenchmarkCoverage error:", error.message)
      return []
    }

    // Build a map: ticker → { actualDays, earliestDate, latestDate }
    const agg = new Map<string, { actualDays: number; earliest: string; latest: string }>()
    for (const row of data ?? []) {
      const t = row.ticker as string
      const d = row.date as string
      const existing = agg.get(t)
      if (!existing) {
        agg.set(t, { actualDays: 1, earliest: d, latest: d })
      } else {
        existing.actualDays += 1
        if (d < existing.earliest) existing.earliest = d
        if (d > existing.latest) existing.latest = d
      }
    }

    return tickers.map((ticker) => {
      const stats = agg.get(ticker)
      const actualDays = stats?.actualDays ?? 0
      const earliestDate = stats?.earliest ?? null
      const latestDate = stats?.latest ?? null
      const expectedDays = businessDaysInWindow
      const missingDays = Math.max(expectedDays - actualDays, 0)
      const coveragePercent =
        expectedDays > 0 ? Math.min((actualDays / expectedDays) * 100, 100) : 0
      const status: BenchmarkCoverage["status"] =
        actualDays === 0
          ? "not_ingested"
          : coveragePercent < 50
            ? "missing"
            : coveragePercent < 99
              ? "partial"
              : "ok"
      const needsHistoricalBackfill =
        earliestDate !== null && earliestDate > COVERAGE_WINDOW_START
      return {
        ticker,
        actualDays,
        expectedDays,
        missingDays,
        coveragePercent,
        latestDate,
        earliestDate,
        needsHistoricalBackfill,
        status,
      }
    })
  } catch (err) {
    console.error("getAllBenchmarkCoverage exception:", err)
    return []
  }
}

/** Fetch the latest data_ingest job for each ticker in a single query. */
export async function getLatestDataIngestJobs(
  tickers: readonly string[]
): Promise<Record<string, DataIngestJobStatus | null>> {
  const normalized = tickers.map((t) => t.toUpperCase())
  const result: Record<string, DataIngestJobStatus | null> = {}
  for (const t of normalized) result[t] = null

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("jobs")
      .select("id, status, stage, progress, error_message, created_at, started_at, payload, job_type")
      .eq("job_type", "data_ingest")
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) {
      if (error.message.includes("job_type") || error.message.includes("does not exist")) return result
      console.error("getLatestDataIngestJobs error:", error.message)
      return result
    }

    // Walk newest-first; record the first (most recent) job per ticker
    for (const j of data ?? []) {
      const p = j.payload as { ticker?: string } | null
      const t = p?.ticker?.toUpperCase()
      if (!t || !normalized.includes(t)) continue
      if (result[t] !== null) continue // already recorded a newer job
      result[t] = {
        id: j.id,
        status: j.status,
        stage: j.stage,
        progress: j.progress,
        error_message: j.error_message,
        created_at: j.created_at ?? null,
        started_at: j.started_at ?? null,
      }
    }
  } catch (err) {
    console.error("getLatestDataIngestJobs exception:", err)
  }

  return result
}

export async function getRecentIngestionHistory(limit = 5): Promise<IngestionLogEntry[]> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("data_ingestion_log")
      .select("*")
      .order("ingested_at", { ascending: false })
      .limit(limit)

    if (error) {
      // Table may not exist yet if migration hasn't been applied
      console.warn("getRecentIngestionHistory:", error.message)
      return []
    }

    return (data ?? []) as IngestionLogEntry[]
  } catch (err) {
    console.error("getRecentIngestionHistory exception:", err)
    return []
  }
}

// ---------------------------------------------------------------------------
// Backtest window verification
// ---------------------------------------------------------------------------

export const BACKTEST_MIN_SPAN_DAYS = 730
export const BACKTEST_MIN_DATA_POINTS = 500

export type BacktestWindowSummaryRow = {
  run_id: string
  name: string
  strategy_id: string
  start_date: string
  end_date: string
  span_days: number
  data_points: number
  data_points_with_benchmark: number
  meets_min_span: boolean
  meets_min_points: boolean
}

/**
 * Returns a per-run backtest-window summary for all completed runs.
 * Span is computed from runs.start_date / end_date; data_points are counted
 * from equity_curve rows fetched in a single batch query.
 */
export async function getRunsBacktestWindowSummary(): Promise<BacktestWindowSummaryRow[]> {
  try {
    const supabase = await createClient()

    const { data: runs, error: runsError } = await supabase
      .from("runs")
      .select("id, name, strategy_id, start_date, end_date")
      .eq("status", "completed")
      .order("created_at", { ascending: false })

    if (runsError) {
      console.error("getRunsBacktestWindowSummary runs error:", runsError.message)
      return []
    }
    if (!runs?.length) return []

    const runIds = runs.map((r) => r.id)

    // Fetch only the columns needed for aggregation — avoids loading full curve.
    const { data: ecRows, error: ecError } = await supabase
      .from("equity_curve")
      .select("run_id, date, benchmark")
      .in("run_id", runIds)

    if (ecError) {
      console.error("getRunsBacktestWindowSummary equity_curve error:", ecError.message)
    }

    // Aggregate counts per run_id.
    type Counts = { total: number; withBenchmark: number }
    const countsMap = new Map<string, Counts>()
    for (const row of (ecRows ?? []) as { run_id: string; date: string; benchmark: number | null }[]) {
      const c = countsMap.get(row.run_id) ?? { total: 0, withBenchmark: 0 }
      c.total += 1
      if (row.benchmark != null) c.withBenchmark += 1
      countsMap.set(row.run_id, c)
    }

    const summary: BacktestWindowSummaryRow[] = runs.map((run) => {
      const startMs = new Date(run.start_date + "T00:00:00Z").getTime()
      const endMs = new Date(run.end_date + "T00:00:00Z").getTime()
      const spanDays = Math.floor((endMs - startMs) / (1000 * 60 * 60 * 24))
      const c = countsMap.get(run.id) ?? { total: 0, withBenchmark: 0 }
      return {
        run_id: run.id,
        name: run.name,
        strategy_id: run.strategy_id,
        start_date: run.start_date,
        end_date: run.end_date,
        span_days: spanDays,
        data_points: c.total,
        data_points_with_benchmark: c.withBenchmark,
        meets_min_span: spanDays >= BACKTEST_MIN_SPAN_DAYS,
        meets_min_points: c.total >= BACKTEST_MIN_DATA_POINTS,
      }
    })

    // Console-log summary for server-side audit visibility.
    console.log("[backtest-audit]", JSON.stringify(
      summary.map(({ run_id, name, span_days, data_points, meets_min_span, meets_min_points }) => ({
        run_id,
        name,
        span_days,
        data_points,
        pass: meets_min_span && meets_min_points,
      }))
    ))

    return summary
  } catch (err) {
    console.error("getRunsBacktestWindowSummary exception:", err)
    return []
  }
}

export async function getPositionsByRunId(runId: string): Promise<PositionRow[]> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("positions")
      .select("*")
      .eq("run_id", runId)
      .order("date", { ascending: false })
      .order("symbol", { ascending: true })
      .limit(2000)

    if (error) {
      if (isMissingPositionsTableError(error.message)) {
        return []
      }
      console.error("getPositionsByRunId error:", error.message)
      return []
    }
    return (data ?? []) as PositionRow[]
  } catch (err) {
    console.error("getPositionsByRunId exception:", err)
    return []
  }
}

export async function getUserSettings(): Promise<UserSettings | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("user_settings")
      .select("*")
      .maybeSingle()

    if (error || !data) return null
    return data as UserSettings
  } catch (err) {
    console.error("getUserSettings exception:", err)
    return null
  }
}

export async function upsertUserSettings(
  settings: Partial<Omit<UserSettings, "user_id" | "updated_at">>
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: user.id,
      ...settings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  )
  if (error) throw new Error(error.message)
}

export async function getBenchmarkOverlapStateForRun(
  run: RunBenchmarkContext
): Promise<BenchmarkOverlapState> {
  const benchmark = getRunBenchmark(run)
  const fallbackPossible = inferPossibleOverlapFromUniverse({
    benchmark,
    strategyId: run.strategy_id,
    universeSymbols: run.universe_symbols,
  })

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("positions")
      .select("date, symbol, weight")
      .eq("run_id", run.id)
      .order("date", { ascending: false })
      .order("symbol", { ascending: true })
      .limit(50)

    if (error) {
      return { confirmed: false, possible: fallbackPossible }
    }

    const positions = (data ?? []) as Pick<PositionRow, "date" | "symbol" | "weight">[]
    if (positions.length === 0) {
      return { confirmed: false, possible: fallbackPossible }
    }

    return {
      confirmed: isBenchmarkHeldAtLatestRebalance(positions, benchmark),
      possible: false,
    }
  } catch {
    return { confirmed: false, possible: fallbackPossible }
  }
}
