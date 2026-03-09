import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const maxDuration = 60 // requires Vercel Pro; safe to set for all plans

const ALLOWED_TICKERS = new Set(["SPY", "QQQ", "IWM", "VTI", "EFA", "EEM", "TLT", "GLD", "VNQ"])
const STUCK_JOB_MINUTES = 5
const STUCK_JOB_MS = STUCK_JOB_MINUTES * 60 * 1000

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
  }).catch(() => {
    // fire-and-forget fallback: worker poll loop will still pick queued jobs
  })
}

// ---------------------------------------------------------------------------
// POST /api/data/ingest-benchmark — enqueue a data_ingest job for the worker
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

  const forceStartDate = String(
    (body as { force_start_date?: unknown })?.force_start_date ?? ""
  ).trim()
  const hasForceStart = /^\d{4}-\d{2}-\d{2}$/.test(forceStartDate)

  const admin = createAdminClient()

  // Return existing active job rather than creating a duplicate.
  // If an "active" job has already run beyond the timeout threshold,
  // mark it as failed so a fresh retry can be queued.
  const { data: activeJobs } = await admin
    .from("jobs")
    .select("id, status, stage, progress, created_at, started_at, payload")
    .eq("job_type", "data_ingest")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(10)

  const nowMs = Date.now()
  for (const job of activeJobs ?? []) {
    const payload = job.payload as { ticker?: string } | null
    if (payload?.ticker?.toUpperCase() !== ticker) continue

    const baselineIso = job.started_at ?? job.created_at
    const ageMs = baselineIso ? nowMs - new Date(baselineIso).getTime() : 0
    if (ageMs < STUCK_JOB_MS) {
      return NextResponse.json({ jobId: job.id, already_active: true })
    }

    const timeoutReason =
      `[stage=${job.stage ?? "unknown"}] timed out after ${STUCK_JOB_MINUTES} minutes ` +
      "without completion; marked failed automatically."
    await admin
      .from("jobs")
      .update({
        status: "failed",
        stage: job.stage ?? "finalize",
        progress: 100,
        finished_at: new Date().toISOString(),
        error_message: timeoutReason,
      })
      .eq("id", job.id)
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

  // Determine effective start date.
  // force_start_date bypasses incremental logic (used for historical backfills).
  let startDate: string
  if (hasForceStart) {
    startDate = forceStartDate
  } else if (existingLatest) {
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
          stage: "finalize",
          progress: 100,
          duration: 0,
          finished_at: new Date().toISOString(),
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

  const jobName = hasForceStart
    ? `Ingest ${ticker} (backfill from ${startDate})`
    : `Ingest ${ticker}`

  // Queue job for the worker.
  const { data: job, error: insertError } = await admin
    .from("jobs")
    .insert({
      name: jobName,
      status: "queued",
      stage: "download",
      progress: 0,
      job_type: "data_ingest",
      payload: { ticker, start_date: startDate, end_date: today },
    })
    .select("id")
    .single()

  if (insertError || !job) {
    console.error("[ingest-benchmark] insert error:", insertError?.message)
    return NextResponse.json({ error: "Failed to create ingest job." }, { status: 500 })
  }

  triggerWorker()
  return NextResponse.json({ jobId: job.id })
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
  const { data: initialJob, error } = await admin
    .from("jobs")
    .select("id, status, stage, progress, error_message, started_at, created_at")
    .eq("id", jobId)
    .eq("job_type", "data_ingest")
    .maybeSingle()
  let job = initialJob

  if (error || !job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 })
  }

  if (job.status === "running") {
    const baselineIso = job.started_at ?? job.created_at
    const ageMs = baselineIso ? Date.now() - new Date(baselineIso).getTime() : 0
    if (ageMs >= STUCK_JOB_MS) {
      const timeoutReason =
        `[stage=${job.stage ?? "unknown"}] timed out after ${STUCK_JOB_MINUTES} minutes ` +
        "without completion; marked failed automatically."
      const { data: failed } = await admin
        .from("jobs")
        .update({
          status: "failed",
          progress: 100,
          stage: job.stage ?? "finalize",
          finished_at: new Date().toISOString(),
          error_message: timeoutReason,
        })
        .eq("id", job.id)
        .select("id, status, stage, progress, error_message, started_at, created_at")
        .single()
      if (failed) {
        job = failed
      }
    }
  }

  return NextResponse.json(job)
}
