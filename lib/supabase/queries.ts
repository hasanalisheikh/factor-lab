import { createClient } from "./server"
import type { Database } from "./types"

type RunRow = Database["public"]["Tables"]["runs"]["Row"]
type RunMetricsRow = Database["public"]["Tables"]["run_metrics"]["Row"]
type EquityCurveRow = Database["public"]["Tables"]["equity_curve"]["Row"]
type ReportRow = Database["public"]["Tables"]["reports"]["Row"]
type JobRow = Database["public"]["Tables"]["jobs"]["Row"]
type PriceRow = Database["public"]["Tables"]["prices"]["Row"]
type DataLastUpdatedRow = Database["public"]["Tables"]["data_last_updated"]["Row"]

export type { RunRow, RunMetricsRow, EquityCurveRow, ReportRow, JobRow, PriceRow, DataLastUpdatedRow }

export type RunWithMetrics = RunRow & { run_metrics: RunMetricsRow[] }
export type DataHealthSummary = {
  tickersCount: number
  dateStart: string | null
  dateEnd: string | null
  missingDaysCount: number
  lastUpdatedAt: string | null
}

export async function getRuns(): Promise<RunWithMetrics[]> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("runs")
      .select("*, run_metrics(*)")
      .order("created_at", { ascending: false })

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
