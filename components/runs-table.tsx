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
import { runs } from "@/lib/mock"
import { STRATEGY_LABELS } from "@/lib/types"

export function RunsTable() {
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
                const hasMetrics = run.status === "completed" || run.status === "failed"
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
                      {STRATEGY_LABELS[run.strategyId]}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-[13px] font-mono text-right py-2.5",
                        !hasMetrics
                          ? "text-muted-foreground"
                          : run.metrics.cagr >= 0
                          ? "text-success"
                          : "text-destructive"
                      )}
                    >
                      {hasMetrics
                        ? `${run.metrics.cagr >= 0 ? "+" : ""}${run.metrics.cagr.toFixed(1)}%`
                        : "--"}
                    </TableCell>
                    <TableCell className="text-[13px] font-mono text-right py-2.5 text-card-foreground hidden sm:table-cell">
                      {hasMetrics ? run.metrics.sharpe.toFixed(2) : "--"}
                    </TableCell>
                    <TableCell className="text-[13px] font-mono text-right py-2.5 text-destructive hidden lg:table-cell">
                      {hasMetrics ? `${run.metrics.maxDrawdown.toFixed(1)}%` : "--"}
                    </TableCell>
                    <TableCell className="text-[12px] font-mono text-right pr-4 py-2.5 text-muted-foreground hidden lg:table-cell">
                      {run.startDate.slice(0, 7)} - {run.endDate.slice(0, 7)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
