/**
 * GET /api/data/auto-maintain
 *
 * Idempotent maintenance endpoint that auto-queues data_ingest_jobs for any
 * benchmark ticker that is:
 *   - Not yet ingested (no ticker_stats row / row_count = 0)
 *   - Needs a historical backfill (first_date > inception date)
 *   - Stale (last_date < yesterday — incremental update needed)
 *
 * Safe to call from a daily cron (Vercel, GitHub Actions, etc.) or on every
 * /data page load. Uses range-aware deduplication: if a queued job already
 * exists for the ticker, its date range is widened instead of creating a
 * duplicate.
 *
 * Auth: accepts either an authenticated user session OR the CRON_SECRET header
 * for automated calls (set CRON_SECRET env var on the server).
 */

import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { BENCHMARK_OPTIONS } from "@/lib/benchmark"
import { TICKER_INCEPTION_DATES } from "@/lib/supabase/types"
import { UNIVERSE_PRESETS } from "@/lib/universe-config"
import type { SupabaseClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const maxDuration = 30

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dij(admin: SupabaseClient<any, any, any>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (admin as any).from("data_ingest_jobs")
}

type TickerStatsRow = {
  symbol: string
  first_date: string | null
  last_date: string | null
  row_count: number | null
}

type DataIngestJobRow = {
  id: string
  symbol: string
  start_date: string
  end_date: string
  status: string
}

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
  }).catch(() => {})
}

export async function GET(request: NextRequest) {
  // Auth: cron secret header or authenticated user session
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get("Authorization")
  const hasCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!hasCronAuth) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }
  }

  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

  // All required tickers: benchmarks + universe presets (deduplicated)
  const ALL_TICKERS = [...new Set([
    ...BENCHMARK_OPTIONS,
    ...Object.values(UNIVERSE_PRESETS).flat(),
  ])]

  // 1. Fetch ticker_stats for all required tickers
  const { data: statsRows } = await admin
    .from("ticker_stats")
    .select("symbol, first_date, last_date, row_count")
    .in("symbol", ALL_TICKERS) as { data: TickerStatsRow[] | null }

  const statsMap = new Map<string, TickerStatsRow>()
  for (const row of statsRows ?? []) {
    statsMap.set(row.symbol, row)
  }

  // 2. Fetch existing active (queued/running) jobs to avoid duplicates
  const { data: activeJobs } = await dij(admin)
    .select("id, symbol, status, start_date, end_date")
    .in("symbol", ALL_TICKERS)
    .in("status", ["queued", "running"]) as { data: DataIngestJobRow[] | null }

  const activeBySymbol = new Map<string, DataIngestJobRow>()
  for (const job of activeJobs ?? []) {
    if (!activeBySymbol.has(job.symbol)) {
      activeBySymbol.set(job.symbol, job)
    }
  }

  const queued: string[] = []
  const skipped: string[] = []
  const widened: string[] = []

  for (const ticker of ALL_TICKERS) {
    const stats = statsMap.get(ticker)
    const inceptionDate = TICKER_INCEPTION_DATES[ticker] ?? "2003-01-01"

    // Determine what action is needed
    let needsFullIngest = false
    let needsBackfill = false
    let needsIncremental = false
    let desiredStart = inceptionDate

    if (!stats || (stats.row_count ?? 0) === 0) {
      needsFullIngest = true
    } else {
      if (stats.first_date && stats.first_date > inceptionDate) {
        needsBackfill = true
        desiredStart = inceptionDate
      }
      if (stats.last_date && stats.last_date < yesterday) {
        needsIncremental = true
      }
    }

    if (!needsFullIngest && !needsBackfill && !needsIncremental) {
      skipped.push(ticker)
      continue
    }

    const existingActive = activeBySymbol.get(ticker)

    if (existingActive) {
      if (existingActive.status === "queued" && (needsBackfill || needsFullIngest)) {
        // Widen the existing queued job to cover inception → today
        const newStart = desiredStart < existingActive.start_date ? desiredStart : existingActive.start_date
        const newEnd = today > existingActive.end_date ? today : existingActive.end_date
        if (newStart !== existingActive.start_date || newEnd !== existingActive.end_date) {
          await dij(admin)
            .update({ start_date: newStart, end_date: newEnd })
            .eq("id", existingActive.id)
          widened.push(ticker)
        } else {
          skipped.push(ticker)
        }
      } else {
        // Running or queued for incremental — already active
        skipped.push(ticker)
      }
      continue
    }

    // No active job — determine the start date for the new job
    let startDate: string
    if (needsFullIngest) {
      startDate = inceptionDate
    } else if (needsBackfill) {
      startDate = inceptionDate
    } else {
      // Incremental only
      const next = new Date(stats!.last_date!)
      next.setDate(next.getDate() + 1)
      startDate = next.toISOString().slice(0, 10)
      if (startDate > today) {
        skipped.push(ticker)
        continue
      }
    }

    const { error } = await dij(admin)
      .insert({
        symbol: ticker,
        start_date: startDate,
        end_date: today,
        status: "queued",
        stage: "download",
        progress: 0,
      })

    if (error) {
      console.error(`[auto-maintain] failed to queue ${ticker}:`, (error as { message: string }).message)
    } else {
      queued.push(ticker)
    }
  }

  if (queued.length > 0 || widened.length > 0) {
    triggerWorker()
  }

  const summary = {
    queued,
    widened,
    skipped,
    total: ALL_TICKERS.length,
    timestamp: new Date().toISOString(),
  }
  console.log("[auto-maintain]", summary)
  return NextResponse.json(summary)
}
