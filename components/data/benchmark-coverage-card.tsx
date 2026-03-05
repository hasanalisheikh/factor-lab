"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  XCircle,
  ExternalLink,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { BenchmarkCoverage, DataIngestJobStatus } from "@/lib/supabase/queries"
import { getFreshnessStatus } from "@/lib/utils/dates"

// ---------------------------------------------------------------------------
// Freshness badge helper (mirrors the one in data/page.tsx server component)
// ---------------------------------------------------------------------------

function FreshnessBadge({ date }: { date: string | null }) {
  if (!date) return null
  const status = getFreshnessStatus(date)
  const cls =
    status === "fresh"
      ? "text-emerald-400 bg-emerald-950/40 border border-emerald-800/50"
      : status === "stale"
        ? "text-amber-400 bg-amber-950/40 border border-amber-800/50"
        : "text-red-400 bg-red-950/40 border border-red-800/50"
  const label = status === "fresh" ? "Fresh" : status === "stale" ? "Stale" : "Outdated"
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  benchmarkTicker: string
  initialBenchmarkCov: BenchmarkCoverage | null
  initialIngestJob: DataIngestJobStatus | null
  isDev?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BenchmarkCoverageCard({
  benchmarkTicker,
  initialBenchmarkCov,
  initialIngestJob,
  isDev = false,
}: Props) {
  const router = useRouter()
  const [ingestJob, setIngestJob] = useState<DataIngestJobStatus | null>(initialIngestJob)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Sync job state from server re-renders triggered by router.refresh()
  useEffect(() => {
    setIngestJob(initialIngestJob)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIngestJob?.id, initialIngestJob?.status])

  const isActive = ingestJob?.status === "queued" || ingestJob?.status === "running"

  // Poll every 3 s while the job is active
  useEffect(() => {
    if (!isActive || !ingestJob?.id) return
    const poll = async () => {
      try {
        const res = await fetch(`/api/data/ingest-benchmark?jobId=${ingestJob.id}`)
        if (!res.ok) return
        const data = (await res.json()) as DataIngestJobStatus
        setIngestJob(data)
        if (data.status === "completed") {
          router.refresh()
        }
      } catch {
        // ignore transient poll errors
      }
    }
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [isActive, ingestJob?.id, router])

  const handleIngest = async () => {
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch("/api/data/ingest-benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: benchmarkTicker }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(data.error ?? "Failed to start ingestion.")
        return
      }
      setIngestJob({
        id: data.jobId,
        status: "queued",
        stage: "ingest",
        progress: 0,
        error_message: null,
      })
    } catch {
      setSubmitError("Failed to connect. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Determine which of the 4 states to show
  //   isActive  → Ingesting
  //   !isActive && benchmarkCov.status !== "not_ingested" → Ingested
  //   !isActive && most-recent job failed → Failed
  //   otherwise → Not Ingested
  // ---------------------------------------------------------------------------

  const benchmarkCov = initialBenchmarkCov
  const isIngested =
    !isActive &&
    benchmarkCov !== null &&
    benchmarkCov.status !== "not_ingested"
  const isFailed = !isActive && ingestJob?.status === "failed"
  const isNotIngested = !isActive && !isFailed && !isIngested

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-foreground">
          Benchmark Coverage
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Default benchmark:{" "}
          <span className="font-mono text-foreground">{benchmarkTicker}</span>
        </p>
      </CardHeader>

      <CardContent>
        {/* ── State A: Ingested ──────────────────────────────────────────── */}
        {isIngested && benchmarkCov && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Coverage</span>
              <span
                className={`font-semibold ${
                  benchmarkCov.status === "ok"
                    ? "text-emerald-400"
                    : benchmarkCov.status === "partial"
                      ? "text-amber-400"
                      : "text-red-400"
                }`}
              >
                {benchmarkCov.coveragePercent.toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Missing days</span>
              <span className="text-foreground">
                {benchmarkCov.missingDays.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Status</span>
              <span
                className={`font-medium ${
                  benchmarkCov.status === "ok"
                    ? "text-emerald-400"
                    : benchmarkCov.status === "partial"
                      ? "text-amber-400"
                      : "text-red-400"
                }`}
              >
                {benchmarkCov.status === "ok"
                  ? "OK"
                  : benchmarkCov.status === "partial"
                    ? "Partial"
                    : "Missing"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Freshness</span>
              <FreshnessBadge date={benchmarkCov.latestDate} />
            </div>
            {benchmarkCov.status !== "ok" && (
              <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-950/30 border border-amber-800/40 px-2.5 py-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-300/80 leading-snug">
                  {benchmarkTicker} has incomplete coverage; comparisons may be less reliable.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── State B: Not Ingested ──────────────────────────────────────── */}
        {isNotIngested && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium text-muted-foreground">Not ingested</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              This page reports coverage for data stored in the prices table. Backtests can still
              benchmark vs {benchmarkTicker} because the worker fetches prices at run time.
            </p>
            {submitError && (
              <p className="text-[11px] text-red-400">{submitError}</p>
            )}
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-xs"
              onClick={handleIngest}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3 h-3 mr-1.5" />
                  Ingest {benchmarkTicker}
                </>
              )}
            </Button>
            {isDev && benchmarkCov?.debugSimilarTickers && (
              <div className="rounded-md bg-muted/40 border border-border px-2.5 py-2">
                <p className="text-[10px] font-mono text-muted-foreground">
                  <span className="text-foreground font-semibold">DEV</span>{" "}
                  Similar tickers in prices:{" "}
                  {benchmarkCov.debugSimilarTickers.length > 0
                    ? benchmarkCov.debugSimilarTickers.join(", ")
                    : "(none — ticker not ingested)"}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── State C: Ingesting ─────────────────────────────────────────── */}
        {isActive && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 flex-shrink-0" />
              <span className="text-foreground font-medium">
                Ingesting {benchmarkTicker}…
              </span>
            </div>
            {ingestJob && ingestJob.progress > 0 && (
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${ingestJob.progress}%` }}
                />
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Downloading and storing price history. This may take a minute.
            </p>
            <a
              href="/jobs"
              className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
            >
              View all jobs
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        )}

        {/* ── State D: Failed ────────────────────────────────────────────── */}
        {isFailed && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
              <span className="text-red-400 font-medium">Ingestion failed</span>
            </div>
            {ingestJob?.error_message && (
              <p className="text-[11px] text-muted-foreground leading-snug line-clamp-3">
                {ingestJob.error_message}
              </p>
            )}
            {submitError && (
              <p className="text-[11px] text-red-400">{submitError}</p>
            )}
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-xs border-red-800/50 text-red-400 hover:text-red-300"
              onClick={handleIngest}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  Starting…
                </>
              ) : (
                "Retry ingest"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
