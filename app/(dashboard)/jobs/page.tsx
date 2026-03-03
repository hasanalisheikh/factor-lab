import { AppShell } from "@/components/layout/app-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/status-badge"
import {
  getJobs,
  getRunsBacktestWindowSummary,
  BACKTEST_MIN_SPAN_DAYS,
  BACKTEST_MIN_DATA_POINTS,
} from "@/lib/supabase/queries"
import type { RunStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "--"
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function formatDate(iso: string | null): string {
  if (!iso) return "--"
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export default async function JobsPage() {
  const [jobs, auditRows] = await Promise.all([
    getJobs(),
    getRunsBacktestWindowSummary(),
  ])

  return (
    <AppShell title="Jobs">
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[13px] font-medium text-card-foreground">
              Job Queue
            </CardTitle>
            <span className="text-[11px] text-muted-foreground font-mono">
              {jobs.length} jobs
            </span>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <p className="text-[13px] font-medium text-foreground">No jobs yet</p>
              <p className="text-[12px] text-muted-foreground max-w-[280px]">
                Jobs will appear here once you queue or run backtests.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {jobs.map((job) => {
                const status = job.status as RunStatus
                const isRunning = status === "running"
                const stageLabel = job.stage
                  ? job.stage.charAt(0).toUpperCase() + job.stage.slice(1)
                  : "Ingest"
                return (
                  <div key={job.id} className="px-4 py-3 hover:bg-accent/20 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-[13px] font-medium text-card-foreground truncate">
                          {job.name}
                        </span>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-[11px] text-muted-foreground font-mono">
                            Started {formatDate(job.started_at)}
                          </span>
                          <span className="text-[11px] text-muted-foreground font-mono">
                            Stage {stageLabel}
                          </span>
                          {job.duration != null && (
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {formatDuration(job.duration)}
                            </span>
                          )}
                        </div>
                        {status === "failed" && job.error_message && (
                          <p className="text-[11px] text-destructive mt-1 max-w-[520px] truncate">
                            {job.error_message}
                          </p>
                        )}
                        {isRunning && (
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="flex-1 max-w-[200px] h-1 rounded-full bg-secondary overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: `${job.progress}%` }}
                              />
                            </div>
                            <span
                              className={cn(
                                "text-[11px] font-mono",
                                isRunning ? "text-warning" : "text-muted-foreground"
                              )}
                            >
                              {job.progress}%
                            </span>
                          </div>
                        )}
                      </div>
                      <StatusBadge status={status} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Backtest Window Audit -------------------------------------------- */}
      {auditRows.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 px-4 pt-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[13px] font-medium text-card-foreground">
                Backtest Window Audit
              </CardTitle>
              <span className="text-[11px] text-muted-foreground font-mono">
                min {BACKTEST_MIN_SPAN_DAYS}d span · {BACKTEST_MIN_DATA_POINTS} pts
              </span>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <div className="divide-y divide-border/40">
              {auditRows.map((row) => {
                const pass = row.meets_min_span && row.meets_min_points
                return (
                  <div
                    key={row.run_id}
                    className="px-4 py-2.5 flex items-center justify-between gap-4"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[13px] font-medium text-card-foreground truncate">
                        {row.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {row.start_date} → {row.end_date}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-[11px] font-mono">
                      <span
                        className={cn(
                          row.meets_min_span
                            ? "text-muted-foreground"
                            : "text-destructive"
                        )}
                      >
                        {row.span_days}d
                      </span>
                      <span
                        className={cn(
                          row.meets_min_points
                            ? "text-muted-foreground"
                            : "text-destructive"
                        )}
                      >
                        {row.data_points} pts
                      </span>
                      <span
                        className={cn(
                          "font-semibold",
                          pass ? "text-success" : "text-destructive"
                        )}
                      >
                        {pass ? "PASS" : "FAIL"}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </AppShell>
  )
}
