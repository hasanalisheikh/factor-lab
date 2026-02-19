import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/status-badge"
import { runs } from "@/lib/mock"
import { STRATEGY_LABELS } from "@/lib/types"

export function RecentRuns() {
  const recentRuns = runs
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6)

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[13px] font-medium text-card-foreground">
            Recent Runs
          </CardTitle>
          <span className="text-[11px] text-muted-foreground font-mono">
            {runs.length} total
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className="flex flex-col gap-0.5">
          {recentRuns.map((run) => (
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
                  {STRATEGY_LABELS[run.strategyId]}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                {run.status === "completed" && (
                  <span className="text-[12px] font-mono text-success">
                    {run.metrics.sharpe.toFixed(2)}
                  </span>
                )}
                <StatusBadge status={run.status} />
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
