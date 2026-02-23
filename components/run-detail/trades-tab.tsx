"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { ModelPredictionRow } from "@/lib/supabase/queries"

const turnoverConfig = {
  turnover: { label: "Turnover %", color: "var(--color-chart-2)" },
} satisfies ChartConfig

type RebalanceEntry = {
  date: string
  entered: string[]
  exited: string[]
  count: number
}

function buildRebalanceData(predictions: ModelPredictionRow[]): {
  turnoverData: { date: string; turnover: number }[]
  rebalanceLog: RebalanceEntry[]
} {
  if (predictions.length === 0) return { turnoverData: [], rebalanceLog: [] }

  // Group by as_of_date
  const byDate: Record<string, ModelPredictionRow[]> = {}
  for (const row of predictions) {
    if (!byDate[row.as_of_date]) byDate[row.as_of_date] = []
    byDate[row.as_of_date].push(row)
  }

  // Sort chronologically (ISO strings sort correctly)
  const dates = Object.keys(byDate).sort()

  const turnoverData: { date: string; turnover: number }[] = []
  const rebalanceLog: RebalanceEntry[] = []

  let prevSelected = new Set<string>()
  let prevWeights = new Map<string, number>()

  for (const date of dates) {
    const rows = byDate[date]
    const currWeights = new Map(rows.map((r) => [r.ticker, Number(r.weight)]))
    const currSelected = new Set(rows.filter((r) => r.selected).map((r) => r.ticker))

    // Compute one-way turnover
    const allTickers = new Set([...prevWeights.keys(), ...currWeights.keys()])
    let to = 0
    for (const t of allTickers) {
      to += Math.abs((currWeights.get(t) ?? 0) - (prevWeights.get(t) ?? 0))
    }
    to /= 2
    turnoverData.push({ date, turnover: Math.round(to * 1000) / 10 })

    // Entries and exits vs previous period
    const entered = [...currSelected].filter((t) => !prevSelected.has(t))
    const exited = [...prevSelected].filter((t) => !currSelected.has(t))
    rebalanceLog.push({ date, entered, exited, count: currSelected.size })

    prevSelected = currSelected
    prevWeights = currWeights
  }

  return { turnoverData, rebalanceLog }
}

interface TradesTabProps {
  predictions?: ModelPredictionRow[]
}

export function TradesTab({ predictions = [] }: TradesTabProps) {
  const { turnoverData, rebalanceLog } = buildRebalanceData(predictions)
  const isEmpty = predictions.length === 0

  return (
    <div className="flex flex-col gap-4">
      {/* Turnover chart */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-1 px-4 pt-4">
          <CardTitle className="text-[13px] font-medium text-card-foreground">
            Monthly Turnover
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-3 pt-1">
          {isEmpty ? (
            <div className="h-[180px] flex items-center justify-center text-[12px] text-muted-foreground">
              Turnover chart available for ML strategy runs.
            </div>
          ) : (
            <ChartContainer config={turnoverConfig} className="h-[180px] w-full">
              <BarChart data={turnoverData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(v) =>
                    new Date(v).toLocaleDateString("en-US", { month: "short", year: "2-digit" })
                  }
                  interval="preserveStartEnd"
                  className="text-[10px]"
                  stroke="var(--color-muted-foreground)"
                  opacity={0.5}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(v) => `${v}%`}
                  className="text-[10px]"
                  stroke="var(--color-muted-foreground)"
                  opacity={0.5}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(v) => [`${Number(v).toFixed(1)}%`, "Turnover"]}
                    />
                  }
                />
                <Bar
                  dataKey="turnover"
                  fill="var(--color-chart-2)"
                  radius={[3, 3, 0, 0]}
                  opacity={0.8}
                />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Rebalance log */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[13px] font-medium text-card-foreground">
              Rebalance Log
            </CardTitle>
            {rebalanceLog.length > 0 && (
              <span className="text-[11px] text-muted-foreground font-mono">
                {rebalanceLog.length} rebalances
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-1">
          {isEmpty ? (
            <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
              Rebalance log available for ML strategy runs.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-[11px] text-muted-foreground font-medium pl-4">
                      Date
                    </TableHead>
                    <TableHead className="text-[11px] text-muted-foreground font-medium">
                      Entered
                    </TableHead>
                    <TableHead className="text-[11px] text-muted-foreground font-medium">
                      Exited
                    </TableHead>
                    <TableHead className="text-[11px] text-muted-foreground font-medium text-right pr-4 hidden sm:table-cell">
                      Positions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rebalanceLog
                    .slice()
                    .reverse()
                    .map((row) => (
                      <TableRow key={row.date} className="border-border/40 hover:bg-accent/30">
                        <TableCell className="pl-4 py-2.5 text-[12px] font-mono text-muted-foreground whitespace-nowrap">
                          {row.date}
                        </TableCell>
                        <TableCell className="py-2 max-w-[200px]">
                          <div className="flex flex-wrap gap-1">
                            {row.entered.length === 0 ? (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            ) : (
                              row.entered.map((t) => (
                                <Badge
                                  key={t}
                                  variant="outline"
                                  className="text-[10px] font-mono px-1.5 py-0 h-[18px] text-success border-success/20 bg-success/8"
                                >
                                  {t}
                                </Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-2 max-w-[200px]">
                          <div className="flex flex-wrap gap-1">
                            {row.exited.length === 0 ? (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            ) : (
                              row.exited.map((t) => (
                                <Badge
                                  key={t}
                                  variant="outline"
                                  className="text-[10px] font-mono px-1.5 py-0 h-[18px] text-destructive border-destructive/20 bg-destructive/8"
                                >
                                  {t}
                                </Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5 text-[12px] font-mono text-right text-muted-foreground pr-4 hidden sm:table-cell">
                          {row.count}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
