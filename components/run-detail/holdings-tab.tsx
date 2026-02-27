"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { ModelPredictionRow, PositionRow } from "@/lib/supabase/queries"

function formatPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "--"
  return `${(Number(v) * 100).toFixed(2)}%`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

// ── ML path: derive holdings from model_predictions ──────────────────────────

interface MlHolding {
  ticker: string
  weight: number
  rank: number
  predictedReturn: number | null
  realizedReturn: number | null
}

function getMlDates(predictions: ModelPredictionRow[]): string[] {
  const seen = new Set<string>()
  for (const r of predictions) {
    seen.add(r.as_of_date)
  }
  return Array.from(seen).sort((a, b) => b.localeCompare(a)) // newest first
}

function getMlHoldingsForDate(
  predictions: ModelPredictionRow[],
  date: string
): MlHolding[] {
  return predictions
    .filter((r) => r.as_of_date === date && r.selected)
    .sort((a, b) => a.rank - b.rank)
    .map((r) => ({
      ticker: r.ticker,
      weight: Number(r.weight),
      rank: r.rank,
      predictedReturn: r.predicted_return != null ? Number(r.predicted_return) : null,
      realizedReturn: r.realized_return != null ? Number(r.realized_return) : null,
    }))
}

// ── Baseline path: derive holdings from positions table ───────────────────────

interface BaselineHolding {
  symbol: string
  weight: number
}

function getPositionDates(positions: PositionRow[]): string[] {
  const seen = new Set<string>()
  for (const r of positions) {
    seen.add(r.date)
  }
  return Array.from(seen).sort((a, b) => b.localeCompare(a)) // newest first
}

function getPositionsForDate(positions: PositionRow[], date: string): BaselineHolding[] {
  return positions
    .filter((r) => r.date === date)
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((r) => ({ symbol: r.symbol, weight: Number(r.weight) }))
}

// ── Component ─────────────────────────────────────────────────────────────────

interface HoldingsTabProps {
  predictions?: ModelPredictionRow[]
  positions?: PositionRow[]
}

export function HoldingsTab({ predictions = [], positions = [] }: HoldingsTabProps) {
  const isMl = predictions.length > 0
  const isBaseline = !isMl && positions.length > 0

  const mlDates = useMemo(() => getMlDates(predictions), [predictions])
  const positionDates = useMemo(() => getPositionDates(positions), [positions])
  const dates = isMl ? mlDates : positionDates

  const [selectedDate, setSelectedDate] = useState<string>(() => dates[0] ?? "")

  const activeDate = selectedDate || dates[0] || ""

  const mlHoldings = useMemo(
    () => (isMl ? getMlHoldingsForDate(predictions, activeDate) : []),
    [predictions, activeDate, isMl]
  )
  const baselineHoldings = useMemo(
    () => (isBaseline ? getPositionsForDate(positions, activeDate) : []),
    [positions, activeDate, isBaseline]
  )

  const isEmpty = !isMl && !isBaseline
  const holdingCount = isMl ? mlHoldings.length : baselineHoldings.length

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <CardTitle className="text-[13px] font-medium text-card-foreground">
            Holdings
          </CardTitle>
          <div className="flex items-center gap-3">
            {holdingCount > 0 && (
              <span className="text-[11px] text-muted-foreground font-mono">
                {holdingCount} position{holdingCount !== 1 ? "s" : ""}
              </span>
            )}
            {dates.length > 0 && (
              <Select value={activeDate} onValueChange={setSelectedDate}>
                <SelectTrigger className="h-7 text-[11px] font-mono w-[148px] bg-secondary/50 border-border">
                  <SelectValue placeholder="Select date" />
                </SelectTrigger>
                <SelectContent>
                  {dates.map((d) => (
                    <SelectItem key={d} value={d} className="text-[11px] font-mono">
                      {formatDate(d)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-1">
        {isEmpty ? (
          <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
            Holdings data not available for this run. Re-run the strategy to populate holdings.
          </div>
        ) : isMl ? (
          /* ML holdings table */
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-[11px] text-muted-foreground font-medium pl-4 w-12">
                    Rank
                  </TableHead>
                  <TableHead className="text-[11px] text-muted-foreground font-medium">
                    Ticker
                  </TableHead>
                  <TableHead className="text-[11px] text-muted-foreground font-medium text-right">
                    Weight
                  </TableHead>
                  <TableHead className="text-[11px] text-muted-foreground font-medium text-right hidden sm:table-cell">
                    Predicted Ret
                  </TableHead>
                  <TableHead className="text-[11px] text-muted-foreground font-medium text-right pr-4">
                    Realized Ret
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mlHoldings.map((h) => (
                  <TableRow
                    key={h.ticker}
                    className="border-border/40 hover:bg-accent/30"
                  >
                    <TableCell className="pl-4 py-2.5 text-[12px] font-mono text-muted-foreground">
                      #{h.rank}
                    </TableCell>
                    <TableCell className="py-2.5 text-[13px] font-mono font-medium text-card-foreground">
                      {h.ticker}
                    </TableCell>
                    <TableCell className="py-2.5 text-[13px] font-mono text-right text-card-foreground">
                      {formatPct(h.weight)}
                    </TableCell>
                    <TableCell className="py-2.5 text-[13px] font-mono text-right text-card-foreground hidden sm:table-cell">
                      {formatPct(h.predictedReturn)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "py-2.5 text-[13px] font-mono text-right pr-4",
                        h.realizedReturn == null
                          ? "text-muted-foreground"
                          : h.realizedReturn >= 0
                          ? "text-success"
                          : "text-destructive"
                      )}
                    >
                      {h.realizedReturn == null ? "--" : formatPct(h.realizedReturn)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          /* Baseline holdings table */
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-[11px] text-muted-foreground font-medium pl-4">
                    Symbol
                  </TableHead>
                  <TableHead className="text-[11px] text-muted-foreground font-medium text-right pr-4">
                    Weight
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {baselineHoldings.map((h) => (
                  <TableRow key={h.symbol} className="border-border/40 hover:bg-accent/30">
                    <TableCell className="pl-4 py-2.5 text-[13px] font-mono font-medium text-card-foreground">
                      {h.symbol}
                    </TableCell>
                    <TableCell className="py-2.5 text-[13px] font-mono text-right pr-4 text-card-foreground">
                      {formatPct(h.weight)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
