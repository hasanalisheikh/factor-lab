"use client"

import { useState } from "react"
import { Clock, Download, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { JobRow } from "@/lib/supabase/types"
import type { RunStatus } from "@/lib/types"
import type { IngestProgress } from "@/lib/supabase/queries"
import { computeEtaSeconds, formatEtaSeconds } from "@/lib/eta"

const ERROR_TRUNCATE_CHARS = 200

function FailedErrorMessage({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = message.length > ERROR_TRUNCATE_CHARS
  const displayed = !isLong || expanded ? message : message.slice(0, ERROR_TRUNCATE_CHARS) + "…"

  return (
    <span>
      <span className="font-mono break-all">{displayed}</span>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-1.5 text-[11px] text-primary underline underline-offset-2 hover:no-underline"
        >
          {expanded ? "collapse" : "expand"}
        </button>
      )}
    </span>
  )
}

interface JobStatusPanelProps {
  job: JobRow | null
  runStatus: RunStatus
  /** Aggregated ingest progress — present when runStatus === "waiting_for_data". */
  ingestProgress?: IngestProgress | null
}

export function JobStatusPanel({ job, runStatus, ingestProgress }: JobStatusPanelProps) {
  if (
    runStatus !== "queued" &&
    runStatus !== "running" &&
    runStatus !== "failed" &&
    runStatus !== "blocked" &&
    runStatus !== "waiting_for_data"
  ) return null

  const isQueued = runStatus === "queued"
  const isRunning = runStatus === "running"
  const isFailed = runStatus === "failed"
  const isBlocked = runStatus === "blocked"
  const isWaiting = runStatus === "waiting_for_data"
  const progress = job?.progress ?? 0
  const stage = job?.stage ?? "ingest"
  const stageLabel = stage.charAt(0).toUpperCase() + stage.slice(1)
  const errorText = job?.error_message || null

  // ETA for the running backtest (uses job.started_at from DB).
  const backtestEta = isRunning
    ? formatEtaSeconds(computeEtaSeconds(progress, job?.started_at ?? null))
    : ""

  // ETA for data ingestion (aggregated across all ingest jobs for this run).
  const ingestAvg = ingestProgress?.avgProgress ?? 0
  const ingestEta = isWaiting && ingestProgress
    ? formatEtaSeconds(computeEtaSeconds(ingestAvg, ingestProgress.minStartedAt))
    : ""

  // Summary line for the waiting-for-data state.
  const ingestSummary =
    ingestProgress && ingestProgress.totalJobs > 0
      ? `Downloading data for ${ingestProgress.totalJobs} ticker${ingestProgress.totalJobs !== 1 ? "s" : ""} (${ingestProgress.completedJobs}/${ingestProgress.totalJobs} done)`
      : "Ingesting required price history — the backtest will start automatically when done."

  return (
    <Card className="bg-card border-border">
      <CardContent className="px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="mt-0.5 shrink-0">
            {isRunning ? (
              <Loader2 className="w-4 h-4 text-warning animate-spin" />
            ) : isWaiting ? (
              <Download className="w-4 h-4 text-blue-500" />
            ) : isBlocked ? (
              <Clock className="w-4 h-4 text-amber-300" />
            ) : (
              <Clock className="w-4 h-4 text-muted-foreground" />
            )}
          </div>

          {/* Text + progress */}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-card-foreground">
              {isQueued
                ? "Queued"
                : isWaiting
                ? "Preparing data…"
                : isBlocked
                ? "Run blocked"
                : isFailed
                ? "Run failed"
                : `Running backtest — ${stageLabel}`}
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {isQueued
                ? "Your run is being processed — it will start shortly."
                : isWaiting
                ? ingestSummary
                : isRunning
                ? `${progress}% complete`
                : (isFailed || isBlocked) && errorText
                ? <FailedErrorMessage message={errorText} />
                : isBlocked
                ? "This run was blocked before execution because the required data or settings were not safe to use."
                : "The worker failed before completion."}
            </p>

            {/* ── Ingest progress bar (waiting_for_data) ─────────────────── */}
            {isWaiting && ingestProgress && ingestProgress.totalJobs > 0 && (
              <div className="mt-2.5 flex items-center gap-2.5">
                <div className="flex-1 max-w-[280px] h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${ingestAvg}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono text-blue-500 tabular-nums w-9 text-right">
                  {ingestAvg}%
                </span>
                {ingestEta && (
                  <span className="text-[11px] text-muted-foreground">{ingestEta}</span>
                )}
              </div>
            )}

            {/* ── Backtest progress bar (running) ────────────────────────── */}
            {isRunning && (
              <div className="mt-2.5 flex items-center gap-2.5">
                <div className="flex-1 max-w-[280px] h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-warning transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono text-warning tabular-nums w-9 text-right">
                  {progress}%
                </span>
                {backtestEta && (
                  <span className="text-[11px] text-muted-foreground">{backtestEta}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
