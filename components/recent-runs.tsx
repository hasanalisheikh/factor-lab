import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/status-badge"
import type { RunMetricsRow, RunWithMetrics } from "@/lib/supabase/queries"
import { STRATEGY_LABELS, type StrategyId, type RunStatus } from "@/lib/types"

interface RecentRunsProps {
  runs: RunWithMetrics[]
  total: number
}

export function RecentRuns({ runs, total }: RecentRunsProps) {
  const getMetrics = (value: RunMetricsRow[] | RunMetricsRow | null): RunMetricsRow | null =>
    Array.isArray(value) ? value[0] ?? null : value ?? null

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[13px] font-medium text-card-foreground">
            Recent Runs
          </CardTitle>
          <span className="text-[11px] text-muted-foreground font-mono">
            {total} total
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className="flex flex-col gap-0.5">
          {runs.map((run) => {
            const metrics = getMetrics(run.run_metrics)
            const status = run.status as RunStatus
            return (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg hover:bg-accent/40 transition-colors group"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[13px] font-medium text-card-foreground group-hover:text-primary transition-colors truncate">
                    {run.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {STRATEGY_LABELS[run.strategy_id as StrategyId] ?? run.strategy_id}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  {status === "completed" && metrics && (
                    <span className="text-[12px] font-mono text-success">
                      {metrics.sharpe.toFixed(2)}
                    </span>
                  )}
                  <StatusBadge status={status} />
                </div>
              </Link>
            )
          })}
          {runs.length === 0 && (
            <p className="text-[12px] text-muted-foreground text-center py-4">No runs yet</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
