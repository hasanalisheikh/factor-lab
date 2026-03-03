"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowUpDown } from "lucide-react"
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
import type { RunMetricsRow, RunWithMetrics } from "@/lib/supabase/types"
import { STRATEGY_LABELS, type StrategyId, type RunStatus } from "@/lib/types"

type SortKey = "name" | "strategy_id" | "status" | "cagr" | "sharpe" | "max_drawdown" | "start_date"

function SortHeader({ label, sort, onToggle }: { label: string; sort: SortKey; onToggle: (k: SortKey) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(sort)}
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
    >
      {label}
      <ArrowUpDown className="w-3 h-3" />
    </button>
  )
}

interface RunsTableProps {
  runs: RunWithMetrics[]
  searchQuery?: string
}

export function RunsTable({ runs, searchQuery }: RunsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("start_date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const getMetrics = (value: RunMetricsRow[] | RunMetricsRow | null): RunMetricsRow | null =>
    Array.isArray(value) ? value[0] ?? null : value ?? null

  const sortedRuns = useMemo(() => {
    const sorted = [...runs]
    sorted.sort((a, b) => {
      const am = getMetrics(a.run_metrics)
      const bm = getMetrics(b.run_metrics)
      let cmp = 0
      switch (sortKey) {
        case "name":
        case "strategy_id":
        case "status":
        case "start_date":
          cmp = String(a[sortKey]).localeCompare(String(b[sortKey]))
          break
        case "cagr":
          cmp = (am?.cagr ?? Number.NEGATIVE_INFINITY) - (bm?.cagr ?? Number.NEGATIVE_INFINITY)
          break
        case "sharpe":
          cmp = (am?.sharpe ?? Number.NEGATIVE_INFINITY) - (bm?.sharpe ?? Number.NEGATIVE_INFINITY)
          break
        case "max_drawdown":
          cmp = Math.abs(am?.max_drawdown ?? Number.POSITIVE_INFINITY) - Math.abs(bm?.max_drawdown ?? Number.POSITIVE_INFINITY)
          break
      }
      return sortDir === "asc" ? cmp : -cmp
    })
    return sorted
  }, [runs, sortDir, sortKey])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(key)
    setSortDir("asc")
  }

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="text-[13px] font-medium text-card-foreground">
          All Runs
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-1">
        <div className="overflow-x-auto">
          <Table className="table-fixed min-w-[900px]">
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-[11px] text-muted-foreground font-medium pl-4">
                  <SortHeader label="Name" sort="name" onToggle={toggleSort} />
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium hidden md:table-cell w-[150px]">
                  <SortHeader label="Strategy" sort="strategy_id" onToggle={toggleSort} />
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium w-[90px]">
                  <SortHeader label="Status" sort="status" onToggle={toggleSort} />
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium text-right w-[72px]">
                  <SortHeader label="CAGR" sort="cagr" onToggle={toggleSort} />
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium text-right hidden sm:table-cell w-[72px]">
                  <SortHeader label="Sharpe" sort="sharpe" onToggle={toggleSort} />
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium text-right hidden lg:table-cell w-[72px]">
                  <SortHeader label="Max DD" sort="max_drawdown" onToggle={toggleSort} />
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium pr-4 hidden lg:table-cell w-[164px]">
                  <SortHeader label="Period" sort="start_date" onToggle={toggleSort} />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRuns.map((run) => {
                const metrics = getMetrics(run.run_metrics)
                const status = run.status as RunStatus
                const hasMetrics = metrics !== null && (status === "completed" || status === "failed")
                const startPeriod = run.start_date ? run.start_date.slice(0, 7) : "--"
                const endPeriod = run.end_date ? run.end_date.slice(0, 7) : "--"
                return (
                  <TableRow
                    key={run.id}
                    className="border-border/40 hover:bg-accent/30 cursor-pointer"
                  >
                    <TableCell className="pl-4 py-2.5 max-w-0 overflow-hidden">
                      <Link
                        href={`/runs/${run.id}`}
                        className="text-[13px] font-medium text-card-foreground hover:text-primary transition-colors truncate block"
                      >
                        {run.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-[12px] text-muted-foreground py-2.5 hidden md:table-cell truncate">
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
                      {hasMetrics ? `${Math.abs(metrics.max_drawdown * 100).toFixed(1)}%` : "--"}
                    </TableCell>
                    <TableCell className="text-[12px] font-mono pr-4 py-2.5 text-muted-foreground hidden lg:table-cell">
                      {startPeriod} – {endPeriod}
                    </TableCell>
                  </TableRow>
                )
              })}
              {runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-[12px] text-muted-foreground">
                    {searchQuery ? `No runs found for "${searchQuery}"` : "No runs found"}
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
