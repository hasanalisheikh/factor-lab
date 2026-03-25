"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { RunMetricsRow, RunWithMetrics } from "@/lib/supabase/types";
import { STRATEGY_LABELS, type StrategyId, type RunStatus } from "@/lib/types";

interface RecentRunsProps {
  runs: RunWithMetrics[];
  total: number;
  selectedRunId?: string | null;
}

function getMetrics(value: RunMetricsRow[] | RunMetricsRow | null): RunMetricsRow | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export function RecentRuns({ runs, total, selectedRunId }: RecentRunsProps) {
  if (process.env.NODE_ENV !== "production") {
    const seenSharpe = new Map<number, string>();
    for (const run of runs) {
      const m = getMetrics(run.run_metrics);
      if (!m) continue;
      // Assert the metrics row actually belongs to this run
      if ("run_id" in m && (m as RunMetricsRow & { run_id?: string }).run_id !== undefined) {
        const metricsRunId = (m as RunMetricsRow & { run_id?: string }).run_id;
        if (metricsRunId !== run.id) {
          console.warn(
            `[RecentRuns] metrics mismatch: run.id=${run.id} but metrics.run_id=${metricsRunId}`
          );
        }
      }
      // Warn if two different runs are rendering the exact same sharpe
      const existing = seenSharpe.get(m.sharpe);
      if (existing !== undefined && existing !== run.id) {
        console.warn(
          `[RecentRuns] runs "${existing}" and "${run.id}" both show sharpe=${m.sharpe} — possible metrics mapping bug`
        );
      }
      seenSharpe.set(m.sharpe, run.id);
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-foreground text-[13px] font-medium">
            Recent Runs
          </CardTitle>
          <div className="flex items-center gap-2">
            {selectedRunId && runs.some((r) => r.id === selectedRunId) && (
              <span className="text-primary bg-primary/10 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium">
                <Check className="h-2.5 w-2.5" />
                Selected
              </span>
            )}
            <span className="text-muted-foreground font-mono text-[11px]">{total} total</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className="flex flex-col gap-0.5">
          <TooltipProvider>
            {runs.map((run) => {
              const metrics = getMetrics(run.run_metrics);
              const status = run.status as RunStatus;
              return (
                <Link
                  key={run.id}
                  href={`/dashboard?run=${run.id}`}
                  className={`hover:bg-accent/40 group -mx-2 flex items-center justify-between rounded-lg px-2 py-2.5 transition-colors ${run.id === selectedRunId ? "bg-primary/8 ring-primary/20 ring-1" : ""}`}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-card-foreground group-hover:text-primary truncate text-[13px] font-medium transition-colors">
                      {run.name}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {STRATEGY_LABELS[run.strategy_id as StrategyId] ?? run.strategy_id}
                    </span>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-3">
                    {status === "completed" &&
                      (metrics != null ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-success cursor-default font-mono text-[12px]">
                              {metrics.sharpe.toFixed(2)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="text-xs">
                            <div>Sharpe: {metrics.sharpe.toFixed(4)}</div>
                            <div>CAGR: {(metrics.cagr * 100).toFixed(1)}%</div>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground font-mono text-[12px]">—</span>
                      ))}
                    <StatusBadge status={status} />
                    {run.id === selectedRunId && (
                      <Check className="text-primary h-3.5 w-3.5 shrink-0" />
                    )}
                  </div>
                </Link>
              );
            })}
          </TooltipProvider>
          {runs.length === 0 && (
            <p className="text-muted-foreground py-4 text-center text-[12px]">No runs yet</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
