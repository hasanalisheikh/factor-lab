import { createClient } from "./server"
import type { Database } from "./types"

type RunRow = Database["public"]["Tables"]["runs"]["Row"]
type RunMetricsRow = Database["public"]["Tables"]["run_metrics"]["Row"]
type EquityCurveRow = Database["public"]["Tables"]["equity_curve"]["Row"]
type JobRow = Database["public"]["Tables"]["jobs"]["Row"]

export type { RunRow, RunMetricsRow, EquityCurveRow, JobRow }

export type RunWithMetrics = RunRow & { run_metrics: RunMetricsRow[] }

export async function getRuns(): Promise<RunWithMetrics[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("runs")
    .select("*, run_metrics(*)")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("getRuns error:", error)
    return []
  }

  return (data ?? []) as RunWithMetrics[]
}

export async function getRunById(id: string): Promise<RunWithMetrics | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("runs")
    .select("*, run_metrics(*)")
    .eq("id", id)
    .maybeSingle()

  if (error || !data) return null

  return data as RunWithMetrics
}

export async function getEquityCurve(runId: string): Promise<EquityCurveRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("equity_curve")
    .select("*")
    .eq("run_id", runId)
    .order("date", { ascending: true })

  if (error) {
    console.error("getEquityCurve error:", error)
    return []
  }

  return data ?? []
}

export async function getJobs(): Promise<JobRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("getJobs error:", error)
    return []
  }

  return data ?? []
}

export async function getMostRecentCompletedRun(): Promise<RunWithMetrics | null> {
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
}
