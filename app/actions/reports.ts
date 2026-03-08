"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import {
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

  const supabase = createAdminClient()

  // Confirm ownership before generating
  const { data: ownerCheck, error: ownerError } = await supabase
    .from("runs")
    .select("id")
    .eq("id", runId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (ownerError || !ownerCheck) {
    throw new Error("Run not found or access denied.")
  }

  const [
    { data: run, error: runError },
    { data: metrics, error: metricsError },
    { data: equity, error: equityError },
  ] = await Promise.all([
    supabase
      .from("runs")
      .select("*")
      .eq("id", runId)
      .maybeSingle(),
    supabase
      .from("run_metrics")
      .select("*")
      .eq("run_id", runId)
      .maybeSingle(),
    supabase
      .from("equity_curve")
      .select("*")
      .eq("run_id", runId)
      .order("date", { ascending: true }),
  ])

  if (runError || !run) {
    throw new Error(`Failed to load run: ${runError?.message ?? "not found"}`)
  }
  if (metricsError || !metrics) {
    throw new Error(`Failed to load run metrics: ${metricsError?.message ?? "not found"}`)
  }
  if (equityError) {
    throw new Error(`Failed to load equity curve: ${equityError.message}`)
  }
  const runRow = run as RunRow
  const benchmarkTicker = getRunBenchmark(runRow)
  const overlapState = await getBenchmarkOverlapStateForRun(runRow)
  let benchmarkOverlapDetected = overlapState.confirmed
  if (!benchmarkOverlapDetected) {
    const { data: overlapRows, error: overlapError } = await supabase
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

  let { error: uploadError } = await supabase.storage
    .from(REPORTS_BUCKET)
    .upload(storagePath, fileData, {
      upsert: true,
      contentType: "text/html; charset=utf-8",
    })

  if (uploadError && uploadError.message.toLowerCase().includes("bucket")) {
    const { error: createBucketError } = await supabase.storage.createBucket(
      REPORTS_BUCKET,
      { public: true }
    )
    if (createBucketError) {
      throw new Error(`Failed to create reports bucket: ${createBucketError.message}`)
    }
    const retry = await supabase.storage.from(REPORTS_BUCKET).upload(storagePath, fileData, {
      upsert: true,
      contentType: "text/html; charset=utf-8",
    })
    uploadError = retry.error
  }

  if (uploadError) {
    throw new Error(`Failed to upload report: ${uploadError.message}`)
  }

  const { data: urlData } = supabase.storage
    .from(REPORTS_BUCKET)
    .getPublicUrl(storagePath)

  const { error: reportError } = await supabase.from("reports").upsert(
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

export async function generateRunReport(runId: string) {
  await ensureRunReport(runId)
  revalidatePath(`/runs/${runId}`)
  redirect(`/runs/${runId}`)
}
