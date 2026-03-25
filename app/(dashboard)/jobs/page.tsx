import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import {
  getJobs,
  getRunsBacktestWindowSummary,
  BACKTEST_MIN_SPAN_DAYS,
  BACKTEST_MIN_DATA_POINTS,
  BACKTEST_END_DATE_TOLERANCE_TRADING_DAYS,
} from "@/lib/supabase/queries";
import type { RunStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "--";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function JobsPage() {
  const [jobs, auditRows] = await Promise.all([getJobs(), getRunsBacktestWindowSummary()]);

  return (
    <AppShell title="Jobs">
      <Card className="bg-card border-border">
        <CardHeader className="px-4 pt-4 pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-card-foreground text-[13px] font-medium">
              Job Queue
            </CardTitle>
            <span className="text-muted-foreground font-mono text-[11px]">{jobs.length} jobs</span>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="text-foreground text-[13px] font-medium">No jobs yet</p>
              <p className="text-muted-foreground max-w-[280px] text-[12px]">
                Jobs will appear here once you queue or run backtests.
              </p>
            </div>
          ) : (
            <div className="divide-border/40 divide-y">
              {jobs.map((job) => {
                const status = job.status as RunStatus;
                const isRunning = status === "running";
                const stageLabel = job.stage
                  ? job.stage.charAt(0).toUpperCase() + job.stage.slice(1)
                  : "Ingest";
                return (
                  <div key={job.id} className="hover:bg-accent/20 px-4 py-3 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-card-foreground truncate text-[13px] font-medium">
                          {job.name}
                        </span>
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-muted-foreground font-mono text-[11px]">
                            Started {formatDate(job.started_at)}
                          </span>
                          <span className="text-muted-foreground font-mono text-[11px]">
                            Stage {stageLabel}
                          </span>
                          {job.duration != null && (
                            <span className="text-muted-foreground font-mono text-[11px]">
                              {formatDuration(job.duration)}
                            </span>
                          )}
                        </div>
                        {(status === "failed" || status === "blocked") && job.error_message && (
                          <p className="text-destructive mt-1 max-w-full truncate text-[11px]">
                            {job.error_message}
                          </p>
                        )}
                        {isRunning && (
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="bg-secondary h-1 max-w-[200px] flex-1 overflow-hidden rounded-full">
                              <div
                                className="bg-primary h-full rounded-full transition-all"
                                style={{ width: `${job.progress}%` }}
                              />
                            </div>
                            <span
                              className={cn(
                                "font-mono text-[11px]",
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
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Backtest Window Audit -------------------------------------------- */}
      {auditRows.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-card-foreground text-[13px] font-medium">
                Backtest Window Audit
              </CardTitle>
              <span className="text-muted-foreground font-mono text-[11px]">
                min {BACKTEST_MIN_SPAN_DAYS}d span · {BACKTEST_MIN_DATA_POINTS} pts · ≤
                {BACKTEST_END_DATE_TOLERANCE_TRADING_DAYS}td end gap
              </span>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <div className="divide-border/40 divide-y">
              {auditRows.map((row) => {
                const outcome = row.audit_outcome;
                const outcomeLabel =
                  outcome === "pass" ? "PASS" : outcome === "fail" ? "FAIL" : "SKIP";
                return (
                  <div
                    key={row.run_id}
                    className="flex flex-wrap items-start justify-between gap-3 px-4 py-2.5 sm:flex-nowrap"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-card-foreground truncate text-[13px] font-medium">
                        {row.name}
                      </span>
                      <span className="text-muted-foreground font-mono text-[11px]">
                        {row.status} · run {row.start_date} → {row.end_date}
                        {row.equity_start_date && row.equity_end_date
                          ? ` · eq ${row.equity_start_date} → ${row.equity_end_date}`
                          : " · eq --"}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 font-mono text-[11px]">
                      <span
                        className={cn(
                          outcome === "skip"
                            ? "text-muted-foreground"
                            : row.meets_min_span
                              ? "text-muted-foreground"
                              : "text-destructive"
                        )}
                      >
                        {row.span_days}d
                      </span>
                      <span
                        className={cn(
                          outcome === "skip"
                            ? "text-muted-foreground"
                            : row.meets_min_points
                              ? "text-muted-foreground"
                              : "text-destructive"
                        )}
                      >
                        {row.data_points} pts
                      </span>
                      <span
                        className={cn(
                          "font-semibold",
                          outcome === "pass"
                            ? "text-success"
                            : outcome === "fail"
                              ? "text-destructive"
                              : "text-muted-foreground"
                        )}
                      >
                        {outcomeLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
