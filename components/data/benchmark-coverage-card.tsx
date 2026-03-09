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
import { TICKER_INCEPTION_DATES } from "@/lib/supabase/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BenchmarkRowData = {
  ticker: string
  coverage: BenchmarkCoverage | null
  initialJob: DataIngestJobStatus | null
}

type Props = {
  benchmarks: BenchmarkRowData[]
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
  const [job, setJob] = useState<DataIngestJobStatus | null>(initialJob)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Sync from server re-renders
  useEffect(() => {
    setJob(initialJob)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJob?.id, initialJob?.status, initialJob?.progress])

  const isActive = job?.status === "queued" || job?.status === "running"

  // Poll every 3 s while active
  useEffect(() => {
    if (!isActive || !job?.id) return
    const poll = async () => {
      try {
        const res = await fetch(`/api/data/ingest-benchmark?jobId=${job.id}`)
        if (!res.ok) return
        const data = (await res.json()) as DataIngestJobStatus
        setJob(data)
        if (data.status === "completed" || data.status === "failed") {
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
      })
    } catch {
      setSubmitError("Failed to connect. Please try again.")
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

  const showBackfillBtn = !isActive && (needsBackfill || status === "missing")
  const showIngestBtn = !isActive && status === "not_ingested"
  const isFailed = !isActive && job?.status === "failed"

  return (
    <div className="py-2 border-b border-border/50 last:border-0 last:pb-0 first:pt-0">
      <div className="flex items-center gap-2 min-w-0">
        {/* Ticker */}
        <span className="font-mono text-xs text-foreground w-10 flex-shrink-0">{ticker}</span>

        {/* Coverage % */}
        <span className={`text-xs font-semibold w-12 text-right flex-shrink-0 ${pctColor}`}>
          {status === "not_ingested" ? "—" : `${coveragePct.toFixed(1)}%`}
        </span>

        {/* Status badge */}
        <span className={`text-[11px] flex-1 min-w-0 ${statusColor}`}>
          {isActive ? (
            <span className="flex items-center gap-1 text-blue-400">
              <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
              <span className="truncate">
                {job?.stage === "download" ? "Downloading…" : "Ingesting…"}
                {job && job.progress > 0 ? ` ${job.progress}%` : ""}
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

        {/* Action button */}
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
        {isFailed && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px] flex-shrink-0 border-red-800/50 text-red-400 hover:text-red-300"
            onClick={() => handleAction(needsBackfill ? inceptionDate : undefined)}
            disabled={isSubmitting}
          >
            {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Retry"}
          </Button>
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
  const anyNeedsBackfill = benchmarks.some(
    (b) => b.coverage?.needsHistoricalBackfill || b.coverage?.status === "missing"
  )

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-foreground">
          Benchmark Coverage
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Coverage from ticker inception to today across all supported benchmarks.
        </p>
      </CardHeader>

      <CardContent className="space-y-0">
        {anyNeedsBackfill && (
          <div className="flex items-start gap-1.5 rounded-md bg-amber-950/30 border border-amber-800/40 px-2.5 py-2 mb-3">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-300/80 leading-snug">
              Some benchmarks have incomplete history. Click{" "}
              <strong>Backfill</strong> on any affected row to download full history from ticker inception.
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
      </CardContent>
    </Card>
  )
}
