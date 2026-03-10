import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { SupabaseClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const maxDuration = 60

const ALLOWED_TICKERS = new Set(["SPY", "QQQ", "IWM", "VTI", "EFA", "EEM", "TLT", "GLD", "VNQ"])
// Python worker handles real stall recovery at 2 min; this is a last-resort
// backstop for when the worker isn't running at all.
const STUCK_JOB_MINUTES = 10
const STUCK_JOB_MS = STUCK_JOB_MINUTES * 60 * 1000

// Local type for data_ingest_jobs rows (table not yet in generated Supabase types)
type DataIngestJobRow = {
  id: string
  symbol: string
  start_date: string
  end_date: string
  status: string
  stage: string | null
  progress: number
  error: string | null
  created_at: string | null
  started_at: string | null
  updated_at: string | null
  finished_at: string | null
  next_retry_at: string | null
  attempt_count: number | null
  requested_by_run_id: string | null
  requested_by_user_id: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dij(admin: SupabaseClient<any, any, any>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (admin as any).from("data_ingest_jobs")
}

// ---------------------------------------------------------------------------
// Rate limiting
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
// POST /api/data/ingest-benchmark — enqueue a data_ingest_job for the worker
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
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

  const ticker = String((body as { ticker?: unknown })?.ticker ?? "").trim().toUpperCase()
  if (!ALLOWED_TICKERS.has(ticker)) {
    return NextResponse.json(
      { error: `"${ticker}" is not an allowed benchmark ticker. Allowed: ${[...ALLOWED_TICKERS].join(", ")}.` },
      { status: 400 }
    )
  }

  const forceStartDate = String((body as { force_start_date?: unknown })?.force_start_date ?? "").trim()
  const hasForceStart = /^\d{4}-\d{2}-\d{2}$/.test(forceStartDate)

  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  // Check for existing active (queued or running) jobs in data_ingest_jobs.
  const { data: activeJobs } = await dij(admin)
    .select("id, status, stage, progress, created_at, started_at, updated_at, next_retry_at, attempt_count, start_date, end_date")
    .eq("symbol", ticker)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(5) as { data: DataIngestJobRow[] | null }

  const nowMs = Date.now()

  for (const job of activeJobs ?? []) {
    const baselineIso = job.updated_at ?? job.started_at ?? job.created_at
    const ageMs = baselineIso ? nowMs - new Date(baselineIso).getTime() : 0

    if (job.status === "running" && ageMs >= STUCK_JOB_MS) {
      // Stale running job — mark failed with short retry so worker re-picks it
      const timeoutReason =
        `[stage=${job.stage ?? "unknown"}] timed out after ${STUCK_JOB_MINUTES} minutes ` +
        "without completion; marked failed by API watchdog."
      const attemptCount = (job.attempt_count ?? 0) + 1
      const nextRetryAt = new Date(Date.now() + 30_000).toISOString()
      await dij(admin)
        .update({
          status: "failed",
          stage: job.stage ?? "finalize",
          progress: 100,
          finished_at: new Date().toISOString(),
          error: timeoutReason,
          attempt_count: attemptCount,
          next_retry_at: nextRetryAt,
        })
        .eq("id", job.id)
      continue
    }

    if (job.status === "queued" && hasForceStart) {
      // Widen the existing queued job's date range to cover the requested window
      const newStart = forceStartDate < (job.start_date ?? forceStartDate) ? forceStartDate : job.start_date
      const newEnd = today > (job.end_date ?? today) ? today : job.end_date
      await dij(admin)
        .update({ start_date: newStart, end_date: newEnd })
        .eq("id", job.id)
      triggerWorker()
      return NextResponse.json({ jobId: job.id, already_active: true })
    }

    // Healthy active job — return it as-is
    if (ageMs < STUCK_JOB_MS || job.status === "queued") {
      return NextResponse.json({ jobId: job.id, already_active: true })
    }
  }

  // Determine effective start date for the new job.
  let startDate: string
  if (hasForceStart) {
    startDate = forceStartDate
  } else {
    // Incremental: start from the day after the latest stored price (from ticker_stats cache)
    const { data: statsRow } = await admin
      .from("ticker_stats")
      .select("last_date")
      .eq("symbol", ticker)
      .maybeSingle()

    const existingLatest: string | null = (statsRow as { last_date?: string } | null)?.last_date ?? null

    if (existingLatest) {
      const next = new Date(existingLatest)
      next.setDate(next.getDate() + 1)
      startDate = next.toISOString().slice(0, 10)

      if (startDate > today) {
        // Already up to date — create an immediately-completed placeholder job
        const { data: completedJob } = await dij(admin)
          .insert({
            symbol: ticker,
            start_date: existingLatest,
            end_date: existingLatest,
            status: "completed",
            stage: "finalize",
            progress: 100,
            finished_at: new Date().toISOString(),
            requested_by_user_id: user.id,
          })
          .select("id")
          .single() as { data: { id: string } | null }
        return NextResponse.json({ jobId: completedJob?.id })
      }
    } else {
      startDate = "1993-01-01"
    }
  }

  // Insert a new data_ingest_job
  const { data: newJob, error: insertError } = await dij(admin)
    .insert({
      symbol: ticker,
      start_date: startDate,
      end_date: today,
      status: "queued",
      stage: "download",
      progress: 0,
      requested_by_user_id: user.id,
    })
    .select("id")
    .single() as { data: { id: string } | null; error: { message: string } | null }

  if (insertError || !newJob) {
    console.error("[ingest-benchmark] insert error:", insertError?.message)
    return NextResponse.json({ error: "Failed to create ingest job." }, { status: 500 })
  }

  triggerWorker()
  return NextResponse.json({ jobId: newJob.id }, { status: 201 })
}

// ---------------------------------------------------------------------------
// DELETE /api/data/ingest-benchmark?jobId=xxx  — cancel a single job
// DELETE /api/data/ingest-benchmark?cancelAll=1 — cancel all queued/running jobs
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 })
  }

  const admin = createAdminClient()
  const url = new URL(request.url)
  const cancelAll = url.searchParams.get("cancelAll") === "1"
  const jobId = url.searchParams.get("jobId")
  const cancelledAt = new Date().toISOString()

  if (cancelAll) {
    await dij(admin)
      .update({ status: "failed", error: "Cancelled by user.", finished_at: cancelledAt, next_retry_at: null })
      .in("status", ["queued", "running"])
    return NextResponse.json({ ok: true })
  }

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId or cancelAll." }, { status: 400 })
  }

  const { error } = await dij(admin)
    .update({ status: "failed", error: "Cancelled by user.", finished_at: cancelledAt, next_retry_at: null })
    .eq("id", jobId)
    .in("status", ["queued", "running"])

  if (error) {
    return NextResponse.json({ error: (error as { message: string }).message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: initialJob, error } = await dij(admin)
    .select("id, symbol, status, stage, progress, error, created_at, started_at, updated_at, finished_at, next_retry_at, attempt_count")
    .eq("id", jobId)
    .maybeSingle() as { data: DataIngestJobRow | null; error: { message: string } | null }

  if (error || !initialJob) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 })
  }

  let job = initialJob

  // Auto-fail genuinely running jobs with stale heartbeats
  if (job.status === "running") {
    const baselineIso = job.updated_at ?? job.started_at ?? job.created_at
    const ageMs = baselineIso ? Date.now() - new Date(baselineIso).getTime() : 0
    if (ageMs >= STUCK_JOB_MS) {
      const timeoutReason =
        `[stage=${job.stage ?? "unknown"}] timed out after ${STUCK_JOB_MINUTES} minutes ` +
        "without completion; marked failed by API watchdog."
      const attemptCount = (job.attempt_count ?? 0) + 1
      const nextRetryAt = new Date(Date.now() + 30_000).toISOString()
      const { data: failed } = await dij(admin)
        .update({
          status: "failed",
          progress: 100,
          stage: job.stage ?? "finalize",
          finished_at: new Date().toISOString(),
          error: timeoutReason,
          attempt_count: attemptCount,
          next_retry_at: nextRetryAt,
        })
        .eq("id", job.id)
        .select("id, symbol, status, stage, progress, error, created_at, started_at, updated_at, finished_at, next_retry_at, attempt_count")
        .single() as { data: DataIngestJobRow | null }
      if (failed) {
        job = failed
      }
    }
  }

  // Map error column to error_message for UI backward compat
  return NextResponse.json({ ...job, error_message: job.error })
}
