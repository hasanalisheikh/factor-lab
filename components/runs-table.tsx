import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"
import type { RunWithMetrics } from "@/lib/supabase/queries"
import { STRATEGY_LABELS, type StrategyId, type RunStatus } from "@/lib/types"

interface RunsTableProps {
  runs: RunWithMetrics[]
}

export function RunsTable({ runs }: RunsTableProps) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="text-[13px] font-medium text-card-foreground">
          All Runs
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-1">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-[11px] text-muted-foreground font-medium pl-4 w-[200px]">
                  Name
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium hidden md:table-cell">
                  Strategy
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium">
                  Status
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium text-right">
                  CAGR
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium text-right hidden sm:table-cell">
                  Sharpe
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium text-right hidden lg:table-cell">
                  Max DD
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium text-right pr-4 hidden lg:table-cell">
                  Period
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const metrics = run.run_metrics[0] ?? null
                const status = run.status as RunStatus
                const hasMetrics = metrics !== null && (status === "completed" || status === "failed")
                return (
                  <TableRow
                    key={run.id}
                    className="border-border/40 hover:bg-accent/30 cursor-pointer"
                  >
                    <TableCell className="pl-4 py-2.5">
                      <Link
                        href={`/runs/${run.id}`}
                        className="text-[13px] font-medium text-card-foreground hover:text-primary transition-colors"
                      >
                        {run.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-[12px] text-muted-foreground py-2.5 hidden md:table-cell">
                      {STRATEGY_LABELS[run.strategy_id as StrategyId] ?? run.strategy_id}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <StatusBadge status={status} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-[13px] font-mono text-right py-2.5",
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
                    <TableCell className="text-[13px] font-mono text-right py-2.5 text-card-foreground hidden sm:table-cell">
                      {hasMetrics ? metrics.sharpe.toFixed(2) : "--"}
                    </TableCell>
                    <TableCell className="text-[13px] font-mono text-right py-2.5 text-destructive hidden lg:table-cell">
                      {hasMetrics ? `${(metrics.max_drawdown * 100).toFixed(1)}%` : "--"}
                    </TableCell>
                    <TableCell className="text-[12px] font-mono text-right pr-4 py-2.5 text-muted-foreground hidden lg:table-cell">
                      {run.start_date.slice(0, 7)} – {run.end_date.slice(0, 7)}
                    </TableCell>
                  </TableRow>
                )
              })}
              {runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-[12px] text-muted-foreground">
                    No runs found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
