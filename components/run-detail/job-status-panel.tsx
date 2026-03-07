"use client"

import { useState } from "react"
import { Clock, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { JobRow } from "@/lib/supabase/types"
import type { RunStatus } from "@/lib/types"

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
}

export function JobStatusPanel({ job, runStatus }: JobStatusPanelProps) {
  if (runStatus !== "queued" && runStatus !== "running" && runStatus !== "failed") return null

  const isQueued = runStatus === "queued"
  const isRunning = runStatus === "running"
  const isFailed = runStatus === "failed"
  const progress = job?.progress ?? 0
  const stage = job?.stage ?? "ingest"
  const stageLabel = stage.charAt(0).toUpperCase() + stage.slice(1)
  const errorText = job?.error_message || null

  return (
    <Card className="bg-card border-border">
      <CardContent className="px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="mt-0.5 shrink-0">
            {isRunning ? (
              <Loader2 className="w-4 h-4 text-warning animate-spin" />
            ) : (
              <Clock className="w-4 h-4 text-muted-foreground" />
            )}
          </div>

          {/* Text + progress */}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-card-foreground">
              {isQueued ? "Queued" : isFailed ? "Run failed" : "Running backtest…"}
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {isQueued
                ? "Your run is being processed, please wait shortly!"
                : isRunning
                ? `Stage: ${stageLabel} — ${progress}% complete`
                : isFailed && errorText
                ? <FailedErrorMessage message={errorText} />
                : "The worker failed before completion."}
            </p>

            {isRunning && (
              <div className="mt-2.5 flex items-center gap-2.5">
                <div className="flex-1 max-w-[280px] h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-warning transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono text-warning tabular-nums">
                  {progress}%
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
