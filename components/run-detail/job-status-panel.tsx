import { Clock, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { JobRow } from "@/lib/supabase/queries"
import type { RunStatus } from "@/lib/types"

interface JobStatusPanelProps {
  job: JobRow | null
  runStatus: RunStatus
}

export function JobStatusPanel({ job, runStatus }: JobStatusPanelProps) {
  if (runStatus !== "queued" && runStatus !== "running") return null

  const isQueued = runStatus === "queued"
  const isRunning = runStatus === "running"
  const progress = job?.progress ?? 0

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
              {isQueued ? "Queued" : "Running backtest…"}
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {isQueued
                ? "Waiting for a worker to pick up this job."
                : `Stage: data loading & factor computation — ${progress}% complete`}
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
