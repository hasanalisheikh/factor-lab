import Link from "next/link";

import { RunActionsMenu } from "@/components/run-actions-menu";
import { StatusBadge } from "@/components/status-badge";
import { CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDrawdown } from "@/lib/format";
import type { RunWithMetrics } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import { STRATEGY_LABELS, type RunStatus, type StrategyId } from "@/lib/types";

import { SortHeader } from "./sort-header";
import { getMetrics } from "./table-helpers";
import type { DesktopSortKey } from "./types";

type DesktopRunsTableProps = {
  runs: RunWithMetrics[];
  sortedRuns: RunWithMetrics[];
  searchQuery?: string;
  progressMap: Record<string, number>;
  onToggleSort: (key: DesktopSortKey) => void;
};

export function DesktopRunsTable({
  runs,
  sortedRuns,
  searchQuery,
  progressMap,
  onToggleSort,
}: DesktopRunsTableProps) {
  return (
    <CardContent className="hidden px-0 pb-1 md:block">
      <div className="overflow-x-auto">
        <Table className="min-w-[900px] table-fixed">
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground pl-4 text-[11px] font-medium">
                <SortHeader label="Name" sort="name" onToggle={onToggleSort} />
              </TableHead>
              <TableHead className="text-muted-foreground hidden w-[150px] text-[11px] font-medium md:table-cell">
                <SortHeader label="Strategy" sort="strategy_id" onToggle={onToggleSort} />
              </TableHead>
              <TableHead className="text-muted-foreground w-[90px] text-[11px] font-medium">
                <SortHeader label="Status" sort="status" onToggle={onToggleSort} />
              </TableHead>
              <TableHead className="text-muted-foreground w-[72px] text-right text-[11px] font-medium">
                <SortHeader label="CAGR" sort="cagr" onToggle={onToggleSort} />
              </TableHead>
              <TableHead className="text-muted-foreground hidden w-[72px] text-right text-[11px] font-medium sm:table-cell">
                <SortHeader label="Sharpe" sort="sharpe" onToggle={onToggleSort} />
              </TableHead>
              <TableHead className="text-muted-foreground hidden w-[72px] text-right text-[11px] font-medium lg:table-cell">
                <SortHeader label="Max DD" sort="max_drawdown" onToggle={onToggleSort} />
              </TableHead>
              <TableHead className="text-muted-foreground hidden w-[164px] pr-4 text-[11px] font-medium lg:table-cell">
                <SortHeader label="Period" sort="start_date" onToggle={onToggleSort} />
              </TableHead>
              <TableHead className="text-muted-foreground w-[72px] pr-4 text-right text-[11px] font-medium">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRuns.map((run) => {
              const metrics = getMetrics(run.run_metrics);
              const status = run.status as RunStatus;
              const hasMetrics =
                metrics !== null && (status === "completed" || status === "failed");
              const activeProgress =
                status === "running" || status === "waiting_for_data"
                  ? (progressMap[run.id] ?? null)
                  : null;
              const startPeriod = (run.executed_start_date ?? run.start_date)?.slice(0, 7) ?? "--";
              const endPeriod = (run.executed_end_date ?? run.end_date)?.slice(0, 7) ?? "--";

              return (
                <TableRow
                  key={run.id}
                  className="border-border/40 hover:bg-accent/30 cursor-pointer"
                >
                  <TableCell className="max-w-0 overflow-hidden py-2.5 pl-4">
                    <Link
                      href={`/runs/${run.id}`}
                      className="text-card-foreground hover:text-primary block truncate text-[13px] font-medium transition-colors"
                    >
                      {run.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden truncate py-2.5 text-[12px] md:table-cell">
                    {STRATEGY_LABELS[run.strategy_id as StrategyId] ?? run.strategy_id}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <StatusBadge status={status} />
                    {activeProgress !== null && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <div className="bg-secondary h-1 w-12 overflow-hidden rounded-full">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              status === "waiting_for_data" ? "bg-blue-500" : "bg-warning"
                            )}
                            style={{ width: `${activeProgress}%` }}
                          />
                        </div>
                        <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
                          {activeProgress}%
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "py-2.5 text-right font-mono text-[13px]",
                      !hasMetrics
                        ? "text-muted-foreground"
                        : metrics.cagr >= 0
                          ? "text-success"
                          : "text-destructive"
                    )}
                  >
                    {hasMetrics
                      ? `${metrics.cagr >= 0 ? "+" : ""}${(metrics.cagr * 100).toFixed(1)}%`
                      : "--"}
                  </TableCell>
                  <TableCell className="text-card-foreground hidden py-2.5 text-right font-mono text-[13px] sm:table-cell">
                    {hasMetrics ? metrics.sharpe.toFixed(2) : "--"}
                  </TableCell>
                  <TableCell className="text-destructive hidden py-2.5 text-right font-mono text-[13px] lg:table-cell">
                    {hasMetrics ? formatDrawdown(metrics.max_drawdown) : "--"}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden py-2.5 pr-4 font-mono text-[12px] lg:table-cell">
                    {startPeriod} – {endPeriod}
                  </TableCell>
                  <TableCell className="py-2.5 pr-4 text-right">
                    <RunActionsMenu runId={run.id} runName={run.name} status={status} />
                  </TableCell>
                </TableRow>
              );
            })}
            {runs.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-muted-foreground py-10 text-center text-[12px]"
                >
                  {searchQuery ? `No runs found for "${searchQuery}"` : "No runs found"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </CardContent>
  );
}
