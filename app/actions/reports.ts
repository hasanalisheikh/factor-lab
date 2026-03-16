"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import {
  fetchAllEquityCurve,
  getBenchmarkOverlapStateForRun,
  type EquityCurveRow,
  type RunMetricsRow,
  type RunRow,
} from "@/lib/supabase/queries"
import { getRunBenchmark } from "@/lib/benchmark"
import { buildReportHtml, parseRunMetadata } from "@/lib/report-builder"

const REPORTS_BUCKET = process.env.SUPABASE_REPORTS_BUCKET ?? "reports"

function isMissingPositionsTableError(message?: string): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return m.includes("public.positions") && m.includes("could not find the table")
}

export async function ensureRunReport(runId: string): Promise<void> {
  // Verify the caller owns this run
  const serverClient = await createClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) {
    throw new Error("Authentication required.")
  }

  const [
    { data: run, error: runError },
    { data: metrics, error: metricsError },
    equity,
  ] = await Promise.all([
    serverClient
      .from("runs")
      .select("*")
      .eq("id", runId)
      .maybeSingle(),
    serverClient
      .from("run_metrics")
      .select("*")
      .eq("run_id", runId)
      .maybeSingle(),
    fetchAllEquityCurve(runId),
  ])

  if (runError || !run) {
    throw new Error(`Failed to load run: ${runError?.message ?? "not found"}`)
  }
  if (metricsError || !metrics) {
    throw new Error(`Failed to load run metrics: ${metricsError?.message ?? "not found"}`)
  }
  const runRow = run as RunRow
  const benchmarkTicker = getRunBenchmark(runRow)
  const overlapState = await getBenchmarkOverlapStateForRun(runRow)
  let benchmarkOverlapDetected = overlapState.confirmed
  if (!benchmarkOverlapDetected) {
    const { data: overlapRows, error: overlapError } = await serverClient
      .from("positions")
      .select("date")
      .eq("run_id", runId)
      .eq("symbol", benchmarkTicker)
      .gt("weight", 0)
      .limit(1)
    if (!overlapError || isMissingPositionsTableError(overlapError.message)) {
      if ((overlapRows?.length ?? 0) > 0) {
        benchmarkOverlapDetected = true
      }
    } else {
      console.error("ensureRunReport overlap query error:", overlapError.message)
    }
  }
  if (runRow.status !== "completed") {
    throw new Error("Report generation is only available for completed runs")
  }

  if (!equity || equity.length === 0) {
    throw new Error("Missing equity curve data")
  }

  // Safely extract run_params fields (best-effort; older runs may lack them)
  const runParamsObj =
    typeof runRow.run_params === "object" &&
    runRow.run_params !== null &&
    !Array.isArray(runRow.run_params)
      ? (runRow.run_params as Record<string, unknown>)
      : {}

  const html = buildReportHtml({
    runName: runRow.name,
    strategyId: runRow.strategy_id,
    startDate: runRow.start_date,
    endDate: runRow.end_date,
    generatedAt: new Date().toISOString(),
    benchmarkTicker,
    benchmarkOverlapDetected,
    metrics: metrics as RunMetricsRow,
    equityCurve: equity as EquityCurveRow[],
    universe: runRow.universe ?? "",
    universeSymbols: runRow.universe_symbols,
    costsBps: runRow.costs_bps ?? 0,
    topN: runRow.top_n ?? 0,
    runParams: runParamsObj,
    runMetadata: parseRunMetadata(runRow.run_metadata),
  })

  const storagePath = `${runId}/tearsheet.html`
  const fileData = new Blob([html], { type: "text/html; charset=utf-8" })
  const admin = createAdminClient()

  // Ensure bucket exists; ignore "already exists" error.
  const { error: bucketError } = await admin.storage.createBucket(REPORTS_BUCKET, { public: true })
  if (bucketError && !bucketError.message.toLowerCase().includes("already exists")) {
    throw new Error(`Failed to create reports bucket: ${bucketError.message}`)
  }

  const { error: uploadError } = await admin.storage
    .from(REPORTS_BUCKET)
    .upload(storagePath, fileData, {
      upsert: true,
      contentType: "text/html; charset=utf-8",
    })

  if (uploadError) {
    throw new Error(`Failed to upload report: ${uploadError.message}`)
  }

  const { data: urlData } = admin.storage
    .from(REPORTS_BUCKET)
    .getPublicUrl(storagePath)

  const { error: reportError } = await admin.from("reports").upsert(
    {
      run_id: runId,
      storage_path: storagePath,
      url: urlData.publicUrl,
    },
    { onConflict: "run_id" }
  )

  if (reportError) {
    throw new Error(`Failed to persist report row: ${reportError.message}`)
  }
}

export async function generateRunReport(
  _prev: { error: string } | { success: true } | null,
  formData: FormData,
): Promise<{ error: string } | { success: true } | null> {
  const runId = formData.get("runId") as string
  try {
    await ensureRunReport(runId)
  } catch (err) {
    console.error("[generateRunReport] report generation failed:", err)
    return {
      error: err instanceof Error ? err.message : "Report generation failed. Please try again.",
    }
  }
  return { success: true }
}
