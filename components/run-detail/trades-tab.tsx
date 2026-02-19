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
import { cn } from "@/lib/utils"
import { trades, turnoverData } from "@/lib/mock-data"

const turnoverConfig = {
  turnover: { label: "Turnover %", color: "var(--color-chart-2)" },
} satisfies ChartConfig

export function TradesTab() {
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
          <ChartContainer config={turnoverConfig} className="h-[180px] w-full">
            <BarChart data={turnoverData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short" })}
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
              <ChartTooltip content={<ChartTooltipContent formatter={(v) => [`${Number(v).toFixed(1)}%`, "Turnover"]} />} />
              <Bar dataKey="turnover" fill="var(--color-chart-2)" radius={[3, 3, 0, 0]} opacity={0.8} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Trades table */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[13px] font-medium text-card-foreground">
              Recent Trades
            </CardTitle>
            <span className="text-[11px] text-muted-foreground font-mono">
              {trades.length} trades
            </span>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-1">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-[11px] text-muted-foreground font-medium pl-4">
                    Date
                  </TableHead>
                  <TableHead className="text-[11px] text-muted-foreground font-medium">
                    Ticker
                  </TableHead>
                  <TableHead className="text-[11px] text-muted-foreground font-medium">
                    Side
                  </TableHead>
                  <TableHead className="text-[11px] text-muted-foreground font-medium text-right hidden sm:table-cell">
                    Qty
                  </TableHead>
                  <TableHead className="text-[11px] text-muted-foreground font-medium text-right hidden sm:table-cell">
                    Price
                  </TableHead>
                  <TableHead className="text-[11px] text-muted-foreground font-medium text-right pr-4">
                    P&L
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((t) => (
                  <TableRow key={t.id} className="border-border/40 hover:bg-accent/30">
                    <TableCell className="pl-4 py-2.5 text-[12px] font-mono text-muted-foreground">
                      {t.date}
                    </TableCell>
                    <TableCell className="py-2.5 text-[13px] font-mono font-medium text-card-foreground">
                      {t.ticker}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-medium px-2 py-0 h-5 leading-5 rounded-md uppercase",
                          t.side === "buy"
                            ? "text-success border-success/20 bg-success/8"
                            : "text-destructive border-destructive/20 bg-destructive/8"
                        )}
                      >
                        {t.side}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2.5 text-[13px] font-mono text-right text-card-foreground hidden sm:table-cell">
                      {t.qty}
                    </TableCell>
                    <TableCell className="py-2.5 text-[13px] font-mono text-right text-card-foreground hidden sm:table-cell">
                      ${t.price.toFixed(2)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "py-2.5 text-[13px] font-mono text-right pr-4",
                        t.pnl === 0
                          ? "text-muted-foreground"
                          : t.pnl > 0
                          ? "text-success"
                          : "text-destructive"
                      )}
                    >
                      {t.pnl === 0
                        ? "--"
                        : `${t.pnl > 0 ? "+" : ""}$${Math.abs(t.pnl).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
