import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  buildScheduledRefreshWindow,
  getLastCompleteTradingDayUtc,
  getRequiredTickers,
  isDailyUpdatesEnabled,
  type DataUpdateMode,
} from "@/lib/data-cutoff"
import { TICKER_INCEPTION_DATES } from "@/lib/supabase/types"
import { randomUUID } from "crypto"

type TickerStatsRow = {
  symbol: string
  last_date: string | null
  row_count: number | null
}

type ExistingBatchRow = {
  id: string
  symbol: string
  status: string
  batch_id: string | null
}

function triggerWorker(): void {
  const url = process.env.WORKER_TRIGGER_URL
  if (!url) return
  const secret = process.env.WORKER_TRIGGER_SECRET
  const isGitHub = url.includes("api.github.com")

  fetch(isGitHub ? url : `${url}/trigger`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      ...(isGitHub
        ? {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          }
        : {}),
    },
    body: isGitHub ? JSON.stringify({ event_type: "run-worker" }) : undefined,
    signal: AbortSignal.timeout(8000),
  }).catch(() => {})
}

async function assertAuthorized(request: NextRequest): Promise<NextResponse | null> {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get("Authorization")
  const hasCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`

  if (hasCronAuth) {
    return null
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 })
  }

  return null
}

export async function runScheduledRefresh(
  request: NextRequest,
  requestMode: Extract<DataUpdateMode, "monthly" | "daily">
): Promise<NextResponse> {
  const authError = await assertAuthorized(request)
  if (authError) return authError

  if (requestMode === "daily" && !isDailyUpdatesEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "daily_updates_disabled",
      mode: requestMode,
      targetCutoffDate: getLastCompleteTradingDayUtc(),
    })
  }

  const admin = createAdminClient()
  const targetCutoffDate = getLastCompleteTradingDayUtc()
  const requiredTickers = getRequiredTickers()
  const { data: currentState } = await admin
    .from("data_state")
    .select("data_cutoff_date, update_mode")
    .eq("id", 1)
    .maybeSingle()
  const currentCutoffDate =
    (currentState as { data_cutoff_date?: string } | null)?.data_cutoff_date ?? null
  const currentUpdateMode =
    (currentState as { update_mode?: string } | null)?.update_mode ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dataIngestJobs = (admin as any).from("data_ingest_jobs")

  const { data: existingBatchRows, error: existingError } = await dataIngestJobs
    .select("id, symbol, status, batch_id")
    .eq("request_mode", requestMode)
    .eq("target_cutoff_date", targetCutoffDate)
    .in("symbol", requiredTickers) as {
      data: ExistingBatchRow[] | null
      error: { message: string } | null
    }

  if (existingError) {
    console.error(`[cron:${requestMode}] existing-batch query error:`, existingError.message)
    return NextResponse.json({ error: "Failed to inspect existing refresh jobs." }, { status: 500 })
  }

  const existingRows = existingBatchRows ?? []
  const activeExisting = existingRows.filter((row) =>
    row.status === "queued" || row.status === "running" || row.status === "retrying"
  )

  if (activeExisting.length > 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "refresh_already_active",
      mode: requestMode,
      batchId: activeExisting[0]?.batch_id ?? null,
      activeJobs: activeExisting.length,
      targetCutoffDate,
    })
  }

  const existingSymbols = new Set(existingRows.map((row) => row.symbol))
  const allRequiredSymbolsPresent = requiredTickers.every((ticker) => existingSymbols.has(ticker))

  if (
    existingRows.length > 0 &&
    allRequiredSymbolsPresent &&
    existingRows.every((row) => row.status === "succeeded")
  ) {
    if (currentCutoffDate !== targetCutoffDate || currentUpdateMode !== requestMode) {
      const nowIso = new Date().toISOString()
      await admin.from("data_state").upsert({
        id: 1,
        data_cutoff_date: targetCutoffDate,
        last_update_at: nowIso,
        update_mode: requestMode,
        updated_by: `cron:${requestMode}-refresh`,
      })
      for (const ticker of requiredTickers) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).rpc("upsert_ticker_stats", { p_ticker: ticker })
      }
    }

    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "refresh_already_succeeded",
      mode: requestMode,
      batchId: existingRows[0]?.batch_id ?? null,
      targetCutoffDate,
      finalizedFallback: currentCutoffDate !== targetCutoffDate || currentUpdateMode !== requestMode,
    })
  }

  const { data: statsRows, error: statsError } = await admin
    .from("ticker_stats")
    .select("symbol, last_date, row_count")
    .in("symbol", requiredTickers) as { data: TickerStatsRow[] | null; error: { message: string } | null }

  if (statsError) {
    console.error(`[cron:${requestMode}] ticker_stats query error:`, statsError.message)
    return NextResponse.json({ error: "Failed to inspect ticker stats." }, { status: 500 })
  }

  const statsMap = new Map<string, TickerStatsRow>()
  for (const row of statsRows ?? []) {
    statsMap.set(row.symbol, row)
  }

  const batchId = randomUUID()
  const requestedBy = `cron:${requestMode}-refresh`
  const jobsToInsert: Array<{
    symbol: string
    start_date: string
    end_date: string
    status: string
    stage: string
    progress: number
    request_mode: string
    batch_id: string
    target_cutoff_date: string
    requested_by: string
  }> = []
  const skippedSymbols: string[] = []

  for (const ticker of requiredTickers) {
    const stats = statsMap.get(ticker)
    const existingLastDate =
      stats && (stats.row_count ?? 0) > 0 ? stats.last_date ?? null : null
    const inceptionDate = TICKER_INCEPTION_DATES[ticker] ?? "1993-01-01"
    const window = buildScheduledRefreshWindow({
      existingLastDate,
      inceptionDate,
      targetCutoffDate,
      requestMode,
    })

    if (window.startDate > window.endDate) {
      skippedSymbols.push(ticker)
      continue
    }

    jobsToInsert.push({
      symbol: ticker,
      start_date: window.startDate,
      end_date: window.endDate,
      status: "queued",
      stage: "download",
      progress: 0,
      request_mode: requestMode,
      batch_id: batchId,
      target_cutoff_date: targetCutoffDate,
      requested_by: requestedBy,
    })
  }

  if (jobsToInsert.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "nothing_to_queue",
      mode: requestMode,
      targetCutoffDate,
      skippedSymbols,
    })
  }

  const { error: insertError } = await dataIngestJobs.insert(jobsToInsert)
  if (insertError) {
    console.error(`[cron:${requestMode}] insert error:`, insertError.message)
    return NextResponse.json({ error: "Failed to queue refresh jobs." }, { status: 500 })
  }

  triggerWorker()

  return NextResponse.json({
    ok: true,
    skipped: false,
    mode: requestMode,
    batchId,
    targetCutoffDate,
    queuedJobs: jobsToInsert.length,
    skippedSymbols,
  })
}
