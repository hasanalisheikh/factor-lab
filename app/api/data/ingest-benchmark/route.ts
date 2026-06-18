import { type NextRequest, NextResponse } from "next/server";

import {
  ALLOWED_TICKERS,
  CANCELLABLE_INGEST_STATUSES,
  dij,
  findUserOwnedIngestJob,
  isUserOwnedIngestJob,
  resolveCurrentCutoffDate,
  runDataIngestWriteCompat,
  selectDataIngestJobsCompat,
} from "@/app/api/data/ingest-benchmark/_lib/jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { TICKER_INCEPTION_DATES } from "@/lib/supabase/types";
import { triggerWorker } from "@/lib/worker-trigger";

export const runtime = "nodejs";
export const maxDuration = 60;

// Python worker handles real stall recovery at 2 min; this is a last-resort
// backstop for when the worker isn't running at all.
const STUCK_JOB_MINUTES = 2;
const STUCK_JOB_MS = STUCK_JOB_MINUTES * 60 * 1000;

async function checkIngestRateLimit(userId: string): Promise<{ allowed: boolean; error?: string }> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return { allowed: true };
  }
  try {
    const { Ratelimit } = await import("@upstash/ratelimit");
    const { Redis } = await import("@upstash/redis");
    const ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(5, "1 h"),
      prefix: "factorlab:data-ingest",
      analytics: false,
    });
    const { success } = await ratelimit.limit(userId);
    if (!success) {
      return {
        allowed: false,
        error: "Rate limit reached (5 ingests/hour). Please wait before trying again.",
      };
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

// POST /api/data/ingest-benchmark — enqueue a data_ingest_job for the worker
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { allowed, error: rateLimitError } = await checkIngestRateLimit(user.id);
  if (!allowed) {
    return NextResponse.json({ error: rateLimitError }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const ticker = String((body as { ticker?: unknown })?.ticker ?? "")
    .trim()
    .toUpperCase();
  if (!ALLOWED_TICKERS.has(ticker)) {
    return NextResponse.json(
      {
        error: `"${ticker}" is not an allowed benchmark ticker. Allowed: ${[...ALLOWED_TICKERS].join(", ")}.`,
      },
      { status: 400 }
    );
  }

  const forceStartDate = String(
    (body as { force_start_date?: unknown })?.force_start_date ?? ""
  ).trim();
  const hasForceStart = /^\d{4}-\d{2}-\d{2}$/.test(forceStartDate);

  const admin = createAdminClient();
  const cutoffDate = await resolveCurrentCutoffDate(admin);
  const requestedBy = `manual:${user.id}`;

  if (hasForceStart && forceStartDate > cutoffDate) {
    return NextResponse.json(
      { error: `Requested start date is after the current cutoff (${cutoffDate}).` },
      { status: 400 }
    );
  }

  // Check for existing active (queued or running) jobs in data_ingest_jobs.
  const { data: activeJobs } = await selectDataIngestJobsCompat(admin, (selectColumns) =>
    dij(admin)
      .select(selectColumns)
      .eq("symbol", ticker)
      .in("status", ["queued", "running", "retrying", "failed"])
      .order("created_at", { ascending: false })
      .limit(5)
  );

  const nowMs = Date.now();

  for (const job of activeJobs ?? []) {
    if (!(await isUserOwnedIngestJob(admin, job, user.id))) {
      continue;
    }

    const baselineIso = job.last_heartbeat_at ?? job.updated_at ?? job.started_at ?? job.created_at;
    const ageMs = baselineIso ? nowMs - new Date(baselineIso).getTime() : 0;

    if (job.status === "running" && ageMs >= STUCK_JOB_MS) {
      // Stale running job — mark retrying so the worker re-picks it
      const timeoutReason =
        `[stage=${job.stage ?? "unknown"}] timed out after ${STUCK_JOB_MINUTES} minutes ` +
        "without completion; marked retrying by API watchdog.";
      const attemptCount = (job.attempt_count ?? 0) + 1;
      const nextRetryAt = new Date(Date.now() + 30_000).toISOString();
      await runDataIngestWriteCompat(
        async (payload) => dij(admin).update(payload).eq("id", job.id),
        {
          status: "retrying",
          stage: job.stage ?? "finalize",
          progress: 100,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_heartbeat_at: new Date().toISOString(),
          error: timeoutReason,
          attempt_count: attemptCount,
          next_retry_at: nextRetryAt,
        }
      );
      continue;
    }

    if (job.status === "queued" && hasForceStart) {
      // Widen the existing queued job's date range to cover the requested window
      const newStart =
        forceStartDate < (job.start_date ?? forceStartDate) ? forceStartDate : job.start_date;
      const newEnd = cutoffDate > (job.end_date ?? cutoffDate) ? cutoffDate : job.end_date;
      await runDataIngestWriteCompat(
        async (payload) => dij(admin).update(payload).eq("id", job.id),
        {
          start_date: newStart,
          end_date: newEnd,
          target_cutoff_date: cutoffDate,
          request_mode: job.request_mode ?? "manual",
          requested_by: job.requested_by ?? requestedBy,
        }
      );
      await triggerWorker("ingest-benchmark.reuseQueuedJob");
      return NextResponse.json({ jobId: job.id, already_active: true });
    }

    if (job.status === "failed" && job.next_retry_at) {
      return NextResponse.json({ jobId: job.id, already_active: true });
    }

    // Healthy active job — return it as-is
    if (ageMs < STUCK_JOB_MS || job.status === "queued") {
      return NextResponse.json({ jobId: job.id, already_active: true });
    }
  }

  // Determine effective start date for the new job.
  let startDate: string;
  if (hasForceStart) {
    startDate = forceStartDate;
  } else {
    // Incremental: start from the day after the latest stored price (from ticker_stats cache)
    const { data: statsRow } = await admin
      .from("ticker_stats")
      .select("last_date")
      .eq("symbol", ticker)
      .maybeSingle();

    const existingLatest: string | null =
      (statsRow as { last_date?: string } | null)?.last_date ?? null;

    if (existingLatest) {
      const next = new Date(existingLatest);
      next.setDate(next.getDate() + 1);
      startDate = next.toISOString().slice(0, 10);

      if (startDate > cutoffDate) {
        // Already up to date — create an immediately-succeeded placeholder job
        try {
          const completedResult = (await runDataIngestWriteCompat(
            async (payload) => dij(admin).insert(payload).select("id").single(),
            {
              symbol: ticker,
              start_date: existingLatest,
              end_date: existingLatest,
              status: "succeeded",
              stage: "finalize",
              progress: 100,
              rows_inserted: 0,
              finished_at: new Date().toISOString(),
              request_mode: "manual",
              target_cutoff_date: cutoffDate,
              requested_by: requestedBy,
              requested_by_user_id: user.id,
            }
          )) as { data: { id: string } | null };
          const completedJob = completedResult.data;
          return NextResponse.json({ jobId: completedJob?.id });
        } catch (error) {
          console.error("[ingest-benchmark] placeholder insert error:", error);
          return NextResponse.json({ error: "Failed to create ingest job." }, { status: 500 });
        }
      }
    } else {
      startDate = TICKER_INCEPTION_DATES[ticker] ?? "1993-01-01";
    }
  }

  // Insert a new data_ingest_job
  let newJobResult: { data: { id: string } | null };
  try {
    newJobResult = (await runDataIngestWriteCompat(
      async (payload) => dij(admin).insert(payload).select("id").single(),
      {
        symbol: ticker,
        start_date: startDate,
        end_date: cutoffDate,
        status: "queued",
        stage: "download",
        progress: 0,
        rows_inserted: 0,
        request_mode: "manual",
        target_cutoff_date: cutoffDate,
        requested_by: requestedBy,
        requested_by_user_id: user.id,
      }
    )) as { data: { id: string } | null };
  } catch (error) {
    console.error("[ingest-benchmark] insert error:", error);
    return NextResponse.json({ error: "Failed to create ingest job." }, { status: 500 });
  }

  const newJob = newJobResult.data;
  if (!newJob) {
    console.error("[ingest-benchmark] insert error: missing job id");
    return NextResponse.json({ error: "Failed to create ingest job." }, { status: 500 });
  }

  await triggerWorker("ingest-benchmark.createJob");
  return NextResponse.json({ jobId: newJob.id }, { status: 201 });
}

// DELETE /api/data/ingest-benchmark?jobId=xxx  — cancel a single user-owned job
// DELETE /api/data/ingest-benchmark?cancelAll=1 — cancel the user's queued/running jobs
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const admin = createAdminClient();
  const url = new URL(request.url);
  const cancelAll = url.searchParams.get("cancelAll") === "1";
  const jobId = url.searchParams.get("jobId");
  const cancelledAt = new Date().toISOString();

  if (cancelAll) {
    await runDataIngestWriteCompat(
      async (payload) =>
        dij(admin)
          .update(payload)
          .eq("requested_by_user_id", user.id)
          .in("status", CANCELLABLE_INGEST_STATUSES),
      {
        status: "failed",
        error: "Cancelled by user.",
        finished_at: cancelledAt,
        updated_at: cancelledAt,
        last_heartbeat_at: cancelledAt,
        next_retry_at: null,
      }
    );
    return NextResponse.json({ ok: true });
  }

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId or cancelAll." }, { status: 400 });
  }

  const job = await findUserOwnedIngestJob(admin, jobId, user.id);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  let error: { message: string } | null = null;
  try {
    await runDataIngestWriteCompat(
      async (payload) =>
        dij(admin).update(payload).eq("id", job.id).in("status", CANCELLABLE_INGEST_STATUSES),
      {
        status: "failed",
        error: "Cancelled by user.",
        finished_at: cancelledAt,
        updated_at: cancelledAt,
        last_heartbeat_at: cancelledAt,
        next_retry_at: null,
      }
    );
  } catch (writeError) {
    error = { message: writeError instanceof Error ? writeError.message : String(writeError) };
  }

  if (error) {
    return NextResponse.json({ error: (error as { message: string }).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// GET /api/data/ingest-benchmark?jobId=xxx — poll job status
export async function GET(request: NextRequest) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const admin = createAdminClient();
  const initialJob = await findUserOwnedIngestJob(admin, jobId, user.id);
  if (!initialJob) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  let job = initialJob;

  // Auto-retry genuinely running jobs with stale heartbeats
  if (job.status === "running") {
    const baselineIso = job.last_heartbeat_at ?? job.updated_at ?? job.started_at ?? job.created_at;
    const ageMs = baselineIso ? Date.now() - new Date(baselineIso).getTime() : 0;
    if (ageMs >= STUCK_JOB_MS) {
      const timeoutReason =
        `[stage=${job.stage ?? "unknown"}] timed out after ${STUCK_JOB_MINUTES} minutes ` +
        "without completion; marked retrying by API watchdog.";
      const attemptCount = (job.attempt_count ?? 0) + 1;
      const nextRetryAt = new Date(Date.now() + 30_000).toISOString();
      await runDataIngestWriteCompat(
        async (payload) => dij(admin).update(payload).eq("id", job.id),
        {
          status: "retrying",
          progress: 100,
          stage: job.stage ?? "finalize",
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_heartbeat_at: new Date().toISOString(),
          error: timeoutReason,
          attempt_count: attemptCount,
          next_retry_at: nextRetryAt,
        }
      );
      const { data: refreshedRows } = await selectDataIngestJobsCompat(admin, (selectColumns) =>
        dij(admin).select(selectColumns).eq("id", job.id).limit(1)
      );
      const failed = refreshedRows?.[0] ?? null;
      if (failed) {
        job = failed;
      }
    }
  }

  // Map error column to error_message for UI backward compat
  return NextResponse.json({ ...job, error_message: job.error });
}
