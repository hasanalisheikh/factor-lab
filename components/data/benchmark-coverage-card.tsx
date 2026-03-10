"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  XCircle,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { BenchmarkCoverage, DataIngestJobStatus } from "@/lib/supabase/types"
import { TICKER_INCEPTION_DATES, getIngestJobError } from "@/lib/supabase/types"
import { useDiagnosticsMode } from "./diagnostics-toggle"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BenchmarkRowData = {
  ticker: string
  coverage: BenchmarkCoverage | null
  initialJob: DataIngestJobStatus | null
}

type Props = {
  /** null signals a query failure — renders "Coverage unavailable" instead of "Not ingested" */
  benchmarks: BenchmarkRowData[] | null
  isDev?: boolean
}

// ---------------------------------------------------------------------------
// Per-ticker row component
// ---------------------------------------------------------------------------

function BenchmarkRow({
  ticker,
  coverage,
  initialJob,
}: {
  ticker: string
  coverage: BenchmarkCoverage | null
  initialJob: DataIngestJobStatus | null
}) {
  const router = useRouter()
  const { enabled: diagnosticsEnabled, toggle } = useDiagnosticsMode()
  const [job, setJob] = useState<DataIngestJobStatus | null>(initialJob)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Sync from server re-renders
  useEffect(() => {
    setJob(initialJob)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJob?.id, initialJob?.status, initialJob?.progress])

  // When a job reaches "completed" but ticker_stats hasn't refreshed yet,
  // show "Refreshing…" briefly and trigger a server re-render.
  useEffect(() => {
    if (job?.status === "completed" && coverage?.status !== "ok") {
      // Small delay so the DB has time to update ticker_stats via the RPC
      const t = setTimeout(() => router.refresh(), 2000)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, coverage?.status])

  // Active = still polling: queued/running, or failed-but-will-retry
  const isActive =
    job?.status === "queued" ||
    job?.status === "running" ||
    (job?.status === "failed" && !!job?.next_retry_at)

  // A running job is "stalled" when its heartbeat (updated_at) is older than 2 min.
  // This mirrors the Python stall_minutes=2 threshold.
  // Falls back gracefully: if updated_at is null (old schema or queued job), never stalled.
  const STALL_MS = 2 * 60 * 1000
  const isStalled =
    job?.status === "running" && !!job?.updated_at
      ? Date.now() - new Date(job.updated_at).getTime() > STALL_MS
      : false

  // Poll every 3 s while active
  useEffect(() => {
    if (!isActive || !job?.id) return
    const poll = async () => {
      try {
        const res = await fetch(`/api/data/ingest-benchmark?jobId=${job.id}`)
        if (!res.ok) return
        const data = (await res.json()) as DataIngestJobStatus
        setJob(data)
        // Stop polling on terminal states
        if (
          data.status === "completed" ||
          data.status === "blocked" ||
          (data.status === "failed" && !data.next_retry_at)
        ) {
          router.refresh()
        }
      } catch { /* ignore transient errors */ }
    }
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [isActive, job?.id, router])

  const handleAction = async (forceStart?: string) => {
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const body: Record<string, string> = { ticker }
      if (forceStart) body.force_start_date = forceStart
      const res = await fetch("/api/data/ingest-benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(data.error ?? "Failed to start ingestion.")
        return
      }
      setJob({
        id: data.jobId,
        status: "queued",
        stage: "download",
        progress: 0,
        error_message: null,
        created_at: new Date().toISOString(),
        started_at: null,
        updated_at: null,
        next_retry_at: null,
        attempt_count: 0,
      })
    } catch {
      setSubmitError("Failed to connect. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = async () => {
    if (!job?.id) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      await fetch(`/api/data/ingest-benchmark?jobId=${job.id}`, { method: "DELETE" })
      setJob((prev) =>
        prev
          ? { ...prev, status: "failed", error: "Cancelled by user.", error_message: "Cancelled by user.", next_retry_at: null }
          : prev
      )
    } catch {
      setSubmitError("Failed to cancel.")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Per-ticker inception date for accurate backfill start
  const inceptionDate = TICKER_INCEPTION_DATES[ticker] ?? "1993-01-01"

  // Derive display values
  const status = coverage?.status ?? "not_ingested"
  const needsBackfill = coverage?.needsHistoricalBackfill ?? false
  const coveragePct = coverage?.coveragePercent ?? 0

  const isBlocked = job?.status === "blocked"
  const hasScheduledRetry = job?.status === "failed" && !!job?.next_retry_at
  const isRetrying = (job?.status === "queued" || job?.status === "running") &&
    (job?.attempt_count ?? 0) > 0

  const pctColor =
    status === "ok"
      ? "text-emerald-400"
      : status === "not_ingested"
        ? "text-muted-foreground"
        : needsBackfill || status === "missing"
          ? "text-red-400"
          : "text-amber-400"

  const statusLabel =
    status === "ok"
      ? "Healthy"
      : status === "not_ingested"
        ? "Not ingested"
        : needsBackfill || status === "missing"
          ? "Needs backfill"
          : "Partial"

  const statusColor =
    status === "ok"
      ? "text-emerald-400"
      : status === "not_ingested"
        ? "text-muted-foreground"
        : needsBackfill || status === "missing"
          ? "text-red-400"
          : "text-amber-400"

  const showBackfillBtn = !isActive && !isBlocked && (needsBackfill || status === "missing")
  const showIngestBtn = !isActive && !isBlocked && status === "not_ingested"
  const isFailed = job?.status === "failed" && !job?.next_retry_at
  // "Retry" for permanently-failed or stalled jobs
  const showRetryBtn = (isFailed && !isBlocked) || (isActive && isStalled)
  // "Retry now" for blocked jobs or scheduled retries (skip the wait)
  const showRetryNowBtn = isBlocked || hasScheduledRetry
  // "Cancel" for queued or running jobs (not stalled — stalled already shows Retry)
  const showCancelBtn = isActive && !isStalled && !hasScheduledRetry

  // Simple status for non-diagnostics mode
  const isNeedsAttention = isBlocked || (isFailed && !hasScheduledRetry)
  const isAutoFixing = isActive || isStalled || hasScheduledRetry ||
    (!isNeedsAttention && status !== "ok" && job?.status === "completed" && coverage?.status !== "ok")

  return (
    <div className="py-2 border-b border-border/50 last:border-0 last:pb-0 first:pt-0">
      <div className="flex items-center gap-2 min-w-0">
        {/* Ticker */}
        <span className="font-mono text-xs text-foreground w-10 flex-shrink-0">{ticker}</span>

        {/* Coverage % */}
        <span className={`text-xs font-semibold w-12 text-right flex-shrink-0 ${pctColor}`}>
          {status === "not_ingested" ? "—" : `${coveragePct.toFixed(1)}%`}
        </span>

        {/* Status area */}
        {diagnosticsEnabled ? (
          /* Full technical status (diagnostics ON) */
          <span className={`text-[11px] flex-1 min-w-0 ${statusColor}`}>
            {isActive && isStalled ? (
              <span className="flex items-center gap-1 text-amber-400">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">Stalled</span>
              </span>
            ) : hasScheduledRetry && job?.next_retry_at ? (
              <span className="flex items-center gap-1 text-amber-400">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">
                  Will retry at {new Date(job.next_retry_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
            ) : job?.status === "completed" && coverage?.status !== "ok" ? (
              <span className="flex items-center gap-1 text-blue-400">
                <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                <span className="truncate">Refreshing…</span>
              </span>
            ) : isActive ? (
              <span className="flex items-center gap-1 text-blue-400">
                <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                <span className="truncate">
                  {isRetrying
                    ? "Retrying…"
                    : job?.status === "queued"
                      ? "Queued…"
                      : job?.stage === "download"
                        ? "Downloading…"
                        : "Ingesting…"}
                  {job && job.progress > 0 ? ` ${job.progress}%` : ""}
                  {job?.status === "running" && job?.updated_at
                    ? ` · ${Math.round((Date.now() - new Date(job.updated_at).getTime()) / 1000)}s ago`
                    : ""}
                </span>
              </span>
            ) : isBlocked ? (
              <span className="flex items-center gap-1 text-red-400">
                <XCircle className="w-3 h-3 flex-shrink-0" />
                <span className="truncate" title={getIngestJobError(job) ?? undefined}>
                  Blocked
                </span>
              </span>
            ) : isFailed ? (
              <span className="flex items-center gap-1 text-red-400">
                <XCircle className="w-3 h-3 flex-shrink-0" />
                Failed
              </span>
            ) : status === "ok" ? (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                {statusLabel}
              </span>
            ) : (
              <span className="flex items-center gap-1">
                {status !== "not_ingested" && <AlertTriangle className="w-3 h-3 flex-shrink-0" />}
                {statusLabel}
              </span>
            )}
          </span>
        ) : (
          /* Simplified status (diagnostics OFF) */
          <span className="text-[11px] flex-1 min-w-0">
            {isNeedsAttention ? (
              <span className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-red-400">
                  <XCircle className="w-3 h-3 flex-shrink-0" />
                  Needs attention
                </span>
                <button
                  onClick={toggle}
                  className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  View diagnostics
                </button>
              </span>
            ) : isAutoFixing ? (
              <span className="flex items-center gap-1 text-blue-400">
                <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                <span className="truncate">Auto-fixing…</span>
              </span>
            ) : status === "ok" ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                Ready
              </span>
            ) : (
              /* Not yet auto-queued or pending — system will handle */
              <span className="flex items-center gap-1 text-blue-400">
                <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                <span className="truncate">Auto-fixing…</span>
              </span>
            )}
          </span>
        )}

        {/* Action buttons — diagnostics mode only */}
        {diagnosticsEnabled && (
          <>
            {showBackfillBtn && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px] flex-shrink-0 border-amber-800/50 text-amber-400 hover:text-amber-300"
                onClick={() => handleAction(inceptionDate)}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Backfill"}
              </Button>
            )}
            {showIngestBtn && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px] flex-shrink-0"
                onClick={() => handleAction()}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Ingest"}
              </Button>
            )}
            {showRetryBtn && (
              <Button
                size="sm"
                variant="outline"
                className={`h-6 px-2 text-[11px] flex-shrink-0 ${
                  isStalled
                    ? "border-amber-800/50 text-amber-400 hover:text-amber-300"
                    : "border-red-800/50 text-red-400 hover:text-red-300"
                }`}
                onClick={() => handleAction(needsBackfill || (isFailed && !isStalled) ? inceptionDate : undefined)}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Retry"}
              </Button>
            )}
            {showRetryNowBtn && (
              <Button
                size="sm"
                variant="outline"
                className={`h-6 px-2 text-[11px] flex-shrink-0 ${
                  isBlocked
                    ? "border-red-800/50 text-red-400 hover:text-red-300"
                    : "border-amber-800/50 text-amber-400 hover:text-amber-300"
                }`}
                onClick={() => handleAction(needsBackfill ? inceptionDate : undefined)}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Retry now"}
              </Button>
            )}
            {showCancelBtn && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px] flex-shrink-0 border-muted-foreground/30 text-muted-foreground hover:text-foreground"
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Cancel"}
              </Button>
            )}
          </>
        )}
      </div>

      {submitError && (
        <p className="text-[11px] text-red-400 mt-1 pl-10">{submitError}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------

export function BenchmarkCoverageCard({ benchmarks, isDev: _isDev = false }: Props) {
  const router = useRouter()
  const { enabled: diagnosticsEnabled } = useDiagnosticsMode()
  const [isCancellingAll, setIsCancellingAll] = useState(false)

  const anyNeedsBackfill = (benchmarks ?? []).some(
    (b) => b.coverage?.needsHistoricalBackfill || b.coverage?.status === "missing"
  )
  const queuedCount = (benchmarks ?? []).filter(
    (b) => b.initialJob?.status === "queued" || b.initialJob?.status === "running"
  ).length

  const handleCancelAll = async () => {
    setIsCancellingAll(true)
    try {
      await fetch("/api/data/ingest-benchmark?cancelAll=1", { method: "DELETE" })
      router.refresh()
    } catch { /* ignore */ } finally {
      setIsCancellingAll(false)
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold text-foreground">
            Benchmark Coverage
          </CardTitle>
          {diagnosticsEnabled && queuedCount >= 1 && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] flex-shrink-0 border-muted-foreground/30 text-muted-foreground hover:text-foreground"
              onClick={handleCancelAll}
              disabled={isCancellingAll}
            >
              {isCancellingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : "Cancel all"}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Coverage from ticker inception to today across all supported benchmarks.
        </p>
      </CardHeader>

      <CardContent className="space-y-0">
        {benchmarks === null ? (
          /* Coverage query failed — avoid showing "Not ingested" for ingested tickers */
          <div className="flex items-start gap-1.5 rounded-md bg-muted/40 border border-border px-2.5 py-3">
            <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-snug">
              Coverage data temporarily unavailable.{" "}
              <a href="/data" className="underline underline-offset-2 hover:text-foreground">
                Retry
              </a>
            </p>
          </div>
        ) : (
          <>
            {anyNeedsBackfill && (
              <div className="flex items-start gap-1.5 rounded-md bg-amber-950/30 border border-amber-800/40 px-2.5 py-2 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-300/80 leading-snug">
                  {diagnosticsEnabled
                    ? <>Some benchmarks have incomplete history. Click <strong>Backfill</strong> on any affected row to download full history from ticker inception.</>
                    : "Auto-backfilling benchmark history from inception. This may take a few minutes."}
                </p>
              </div>
            )}

            {/* Column headers */}
            <div className="flex items-center gap-2 pb-1.5 border-b border-border/50">
              <span className="text-[10px] text-muted-foreground w-10 flex-shrink-0">Ticker</span>
              <span className="text-[10px] text-muted-foreground w-12 text-right flex-shrink-0">Cover.</span>
              <span className="text-[10px] text-muted-foreground flex-1">Status</span>
            </div>

            {benchmarks.map((b) => (
              <BenchmarkRow
                key={b.ticker}
                ticker={b.ticker}
                coverage={b.coverage}
                initialJob={b.initialJob}
              />
            ))}
          </>
        )}
      </CardContent>
    </Card>
  )
}
