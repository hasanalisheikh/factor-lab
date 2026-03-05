import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const maxDuration = 60 // requires Vercel Pro; safe to set for all plans

const ALLOWED_TICKERS = new Set(["SPY", "QQQ", "IWM", "VTI", "EFA", "TLT", "GLD", "VNQ"])

// ---------------------------------------------------------------------------
// Rate limiting (unchanged)
// ---------------------------------------------------------------------------

async function checkIngestRateLimit(
  userId: string
): Promise<{ allowed: boolean; error?: string }> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return { allowed: true }
  }
  try {
    const { Ratelimit } = await import("@upstash/ratelimit")
    const { Redis } = await import("@upstash/redis")
    const ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(5, "1 h"),
      prefix: "factorlab:data-ingest",
      analytics: false,
    })
    const { success } = await ratelimit.limit(userId)
    if (!success) {
      return {
        allowed: false,
        error: "Rate limit reached (5 ingests/hour). Please wait before trying again.",
      }
    }
    return { allowed: true }
  } catch {
    return { allowed: true }
  }
}

// ---------------------------------------------------------------------------
// Yahoo Finance fetch (inline — no worker needed for a single ticker)
// ---------------------------------------------------------------------------

type PriceRow = { date: string; adj_close: number }

async function fetchAdjustedClose(
  ticker: string,
  startDate: string,
  endDate: string
): Promise<PriceRow[]> {
  const YahooFinance = (await import("yahoo-finance2")).default
  const yf = new YahooFinance()

  const endPlusOne = new Date(endDate)
  endPlusOne.setDate(endPlusOne.getDate() + 1)

  // chart() is the non-deprecated replacement for historical()
  const result = await yf.chart(ticker, {
    period1: startDate,
    period2: endPlusOne.toISOString().slice(0, 10),
    interval: "1d",
  })

  const rows: PriceRow[] = []
  for (const q of result.quotes ?? []) {
    const val = q.adjclose ?? q.close
    if (val == null) continue
    rows.push({ date: (q.date as Date).toISOString().slice(0, 10), adj_close: val })
  }
  return rows
}

// ---------------------------------------------------------------------------
// POST /api/data/ingest-benchmark — ingest inline, no worker required
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 })
  }

  const { allowed, error: rateLimitError } = await checkIngestRateLimit(user.id)
  if (!allowed) {
    return NextResponse.json({ error: rateLimitError }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const ticker = String((body as { ticker?: unknown })?.ticker ?? "")
    .trim()
    .toUpperCase()
  if (!ALLOWED_TICKERS.has(ticker)) {
    return NextResponse.json(
      {
        error: `"${ticker}" is not an allowed benchmark ticker. Allowed: ${[...ALLOWED_TICKERS].join(", ")}.`,
      },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  // Return existing active job rather than creating a duplicate
  const { data: activeJobs } = await admin
    .from("jobs")
    .select("id, status, payload")
    .eq("job_type", "data_ingest")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(10)

  const existing = (activeJobs ?? []).find((j) => {
    const p = j.payload as { ticker?: string } | null
    return p?.ticker?.toUpperCase() === ticker
  })
  if (existing) {
    return NextResponse.json({ jobId: existing.id, already_active: true })
  }

  // Incremental: find the latest already-stored date for this ticker
  const { data: latestRow } = await admin
    .from("prices")
    .select("date")
    .eq("ticker", ticker)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle()

  const today = new Date().toISOString().slice(0, 10)
  const existingLatest: string | null = latestRow?.date ?? null

  // Determine effective start date
  let startDate: string
  if (existingLatest) {
    const next = new Date(existingLatest)
    next.setDate(next.getDate() + 1)
    startDate = next.toISOString().slice(0, 10)

    if (startDate > today) {
      // Already up to date — create a completed job and return immediately
      const { data: job } = await admin
        .from("jobs")
        .insert({
          name: `Ingest ${ticker}`,
          status: "completed",
          stage: "report",
          progress: 100,
          duration: 0,
          job_type: "data_ingest",
          payload: { ticker, start_date: existingLatest, end_date: existingLatest },
        })
        .select("id")
        .single()
      return NextResponse.json({ jobId: job?.id })
    }
  } else {
    startDate = "1993-01-01"
  }

  // Create job as "running" — we do the work inline in this request
  const { data: job, error: insertError } = await admin
    .from("jobs")
    .insert({
      name: `Ingest ${ticker}`,
      status: "running",
      stage: "ingest",
      progress: 20,
      job_type: "data_ingest",
      payload: { ticker, start_date: startDate, end_date: today },
    })
    .select("id")
    .single()

  if (insertError || !job) {
    console.error("[ingest-benchmark] insert error:", insertError?.message)
    return NextResponse.json({ error: "Failed to create ingest job." }, { status: 500 })
  }

  try {
    const rows = await fetchAdjustedClose(ticker, startDate, today)

    await admin.from("jobs").update({ stage: "backtest", progress: 60 }).eq("id", job.id)

    if (rows.length > 0) {
      const CHUNK = 5000
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK).map((r) => ({ ticker, ...r }))
        await admin.from("prices").upsert(chunk, { onConflict: "ticker,date" })
      }
    }

    const actualStart = rows[0]?.date ?? startDate
    const actualEnd = rows[rows.length - 1]?.date ?? today

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from("data_ingestion_log").insert({
        status: "success",
        tickers_updated: 1,
        rows_upserted: rows.length,
        note: `on-demand ingest ${ticker} (${actualStart} to ${actualEnd})`,
        source: "yfinance",
      })
    } catch { /* non-fatal */ }

    await admin.from("jobs").update({
      status: "completed",
      stage: "report",
      progress: 100,
      duration: 0,
      error_message: null,
    }).eq("id", job.id)

    return NextResponse.json({ jobId: job.id })
  } catch (err) {
    const msg = String(err).slice(0, 400)
    console.error("[ingest-benchmark] ingest error:", msg)
    await admin.from("jobs").update({
      status: "failed",
      stage: "report",
      progress: 100,
      error_message: msg,
    }).eq("id", job.id)
    return NextResponse.json({ error: "Ingest failed. See job log for details." }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// GET /api/data/ingest-benchmark?jobId=xxx — poll job status
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const jobId = new URL(request.url).searchParams.get("jobId")
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId." }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: job, error } = await admin
    .from("jobs")
    .select("id, status, stage, progress, error_message")
    .eq("id", jobId)
    .eq("job_type", "data_ingest")
    .maybeSingle()

  if (error || !job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 })
  }

  return NextResponse.json(job)
}
