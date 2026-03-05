"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/status-badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { RunMetricsRow, RunWithMetrics } from "@/lib/supabase/types"
import { STRATEGY_LABELS, type StrategyId, type RunStatus } from "@/lib/types"

interface RecentRunsProps {
  runs: RunWithMetrics[]
  total: number
  selectedRunId?: string | null
}

function getMetrics(value: RunMetricsRow[] | RunMetricsRow | null): RunMetricsRow | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

export function RecentRuns({ runs, total, selectedRunId }: RecentRunsProps) {
  if (process.env.NODE_ENV !== "production") {
    const seenSharpe = new Map<number, string>()
    for (const run of runs) {
      const m = getMetrics(run.run_metrics)
      if (!m) continue
      // Assert the metrics row actually belongs to this run
      if ("run_id" in m && (m as RunMetricsRow & { run_id?: string }).run_id !== undefined) {
        const metricsRunId = (m as RunMetricsRow & { run_id?: string }).run_id
        if (metricsRunId !== run.id) {
          console.warn(
            `[RecentRuns] metrics mismatch: run.id=${run.id} but metrics.run_id=${metricsRunId}`
          )
        }
      }
      // Warn if two different runs are rendering the exact same sharpe
      const existing = seenSharpe.get(m.sharpe)
      if (existing !== undefined && existing !== run.id) {
        console.warn(
          `[RecentRuns] runs "${existing}" and "${run.id}" both show sharpe=${m.sharpe} — possible metrics mapping bug`
        )
      }
      seenSharpe.set(m.sharpe, run.id)
    }
  }

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
          <TooltipProvider>
            {runs.map((run) => {
              const metrics = getMetrics(run.run_metrics)
              const status = run.status as RunStatus
              return (
                <Link
                  key={run.id}
                  href={`/dashboard?run=${run.id}`}
                  className={`flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg hover:bg-accent/40 transition-colors group ${run.id === selectedRunId ? "bg-accent/40" : ""}`}
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
                    {status === "completed" && (
                      metrics != null ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-[12px] font-mono text-success cursor-default">
                              {metrics.sharpe.toFixed(2)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="text-xs">
                            <div>Sharpe: {metrics.sharpe.toFixed(4)}</div>
                            <div>CAGR: {(metrics.cagr * 100).toFixed(1)}%</div>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-[12px] font-mono text-muted-foreground">—</span>
                      )
                    )}
                    <StatusBadge status={status} />
                  </div>
                </Link>
              )
            })}
          </TooltipProvider>
          {runs.length === 0 && (
            <p className="text-[12px] text-muted-foreground text-center py-4">No runs yet</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
