import "server-only"
import { createClient } from "./server"
import {
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
} from "./types"

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
}

export type DataHealthSummary = {
  tickersCount: number
  dateStart: string | null
  dateEnd: string | null
  missingDaysCount: number
  lastUpdatedAt: string | null
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
        run_metrics(cagr, sharpe, max_drawdown, turnover)
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
          run_metrics(cagr, sharpe, max_drawdown, turnover)
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
    const { data, error } = await supabase
      .from("equity_curve")
      .select("*")
      .eq("run_id", runId)
      .order("date", { ascending: true })

    if (error) {
      console.error("getEquityCurve error:", error.message)
      return []
    }

    return (data ?? []) as EquityCurveRow[]
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

    const results = await Promise.all(
      strategies.map(async (strategyId) => {
        const { data, error } = await supabase
          .from("runs")
          .select("*, run_metrics(*)")
          .eq("strategy_id", strategyId)
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        if (error || !data) return null
        return data as RunWithMetrics
      })
    )

    return results.filter((row): row is RunWithMetrics => row != null)
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

function countBusinessDaysInclusive(start: Date, end: Date): number {
  let count = 0
  const current = new Date(start)
  while (current <= end) {
    const day = current.getUTCDay()
    if (day !== 0 && day !== 6) {
      count += 1
    }
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return count
}

export async function getDataHealthSummary(): Promise<DataHealthSummary> {
  const empty: DataHealthSummary = {
    tickersCount: 0,
    dateStart: null,
    dateEnd: null,
    missingDaysCount: 0,
    lastUpdatedAt: null,
  }

  try {
    const supabase = await createClient()

    const [
      tickersRes,
      minDateRes,
      maxDateRes,
      rowsCountRes,
      lastUpdatedRes,
    ] = await Promise.all([
      supabase.from("prices").select("ticker"),
      supabase.from("prices").select("date").order("date", { ascending: true }).limit(1),
      supabase.from("prices").select("date").order("date", { ascending: false }).limit(1),
      supabase.from("prices").select("*", { count: "exact", head: true }),
      supabase
        .from("data_last_updated")
        .select("last_updated_at")
        .eq("source", "yfinance_sp100")
        .maybeSingle(),
    ])

    if (
      tickersRes.error ||
      minDateRes.error ||
      maxDateRes.error ||
      rowsCountRes.error
    ) {
      console.error("getDataHealthSummary error:", {
        tickers: tickersRes.error?.message,
        minDate: minDateRes.error?.message,
        maxDate: maxDateRes.error?.message,
        rowsCount: rowsCountRes.error?.message,
      })
      return empty
    }

    const tickers = new Set((tickersRes.data ?? []).map((row) => row.ticker))
    const tickersCount = tickers.size
    const dateStart = minDateRes.data?.[0]?.date ?? null
    const dateEnd = maxDateRes.data?.[0]?.date ?? null
    const actualRows = rowsCountRes.count ?? 0

    let missingDaysCount = 0
    if (tickersCount > 0 && dateStart && dateEnd) {
      const businessDays = countBusinessDaysInclusive(
        new Date(`${dateStart}T00:00:00Z`),
        new Date(`${dateEnd}T00:00:00Z`)
      )
      const expectedRows = businessDays * tickersCount
      missingDaysCount = Math.max(expectedRows - actualRows, 0)
    }

    return {
      tickersCount,
      dateStart,
      dateEnd,
      missingDaysCount,
      lastUpdatedAt: lastUpdatedRes.data?.last_updated_at ?? null,
    }
  } catch (err) {
    console.error("getDataHealthSummary exception:", err)
    return empty
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
      .limit(3000)

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
