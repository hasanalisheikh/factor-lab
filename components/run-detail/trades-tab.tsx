"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { PositionRow } from "@/lib/supabase/types";
import { buildTurnoverPointsFromPositions, injectAllCashGaps } from "@/lib/turnover";

const turnoverConfig = {
  turnover: { label: "Turnover %", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

type RebalanceEntry = {
  date: string;
  entered: string[];
  exited: string[];
  count: number;
  isInitialEstablishment: boolean;
  isAllCash?: boolean;
};

type TradesData = {
  turnoverData: { date: string; turnover: number }[];
  rebalanceLog: RebalanceEntry[];
};

function buildFromPositions(positions: PositionRow[]): TradesData {
  if (positions.length === 0) return { turnoverData: [], rebalanceLog: [] };
  const rawPoints = buildTurnoverPointsFromPositions(positions);
  const points = injectAllCashGaps(rawPoints);
  return {
    turnoverData: rawPoints.map((point) => ({
      date: point.date,
      turnover: Math.round(point.turnover * 1000) / 10,
    })),
    rebalanceLog: points.map((point) => ({
      date: point.date,
      entered: point.entered,
      exited: point.exited,
      count: point.count,
      isInitialEstablishment: point.isInitialEstablishment,
      isAllCash: point.isAllCash,
    })),
  };
}

interface TradesTabProps {
  positions?: PositionRow[];
}

export function TradesTab({ positions = [] }: TradesTabProps) {
  const { turnoverData, rebalanceLog } = buildFromPositions(positions);
  const isEmpty = positions.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Turnover chart */}
      <Card className="bg-card border-border">
        <CardHeader className="px-4 pt-4 pb-1">
          <CardTitle className="text-card-foreground text-[13px] font-medium">
            Per-rebalance constituent turnover
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pt-1 pb-3">
          {isEmpty ? (
            <div className="text-muted-foreground flex h-[180px] items-center justify-center text-[12px]">
              Turnover data not available. Re-run the strategy to populate trades.
            </div>
          ) : (
            <ChartContainer config={turnoverConfig} className="h-[180px] w-full">
              <BarChart data={turnoverData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-border/20"
                  vertical={false}
                />
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
                      formatter={(v) => [`${Number(v).toFixed(1)}%`, "One-way turnover"]}
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
          {!isEmpty && (
            <p className="text-muted-foreground px-2 pt-2 text-[11px]">
              Bars show weight changes when holdings enter or exit the portfolio at each rebalance.
              For equal-weight strategies with stable holdings, this will be 0 after initialization
              — the annualized Turnover KPI (Overview tab, drift-adjusted) captures total
              rebalancing cost including drift-reset between rebalances.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Rebalance log */}
      <Card className="bg-card border-border">
        <CardHeader className="px-4 pt-4 pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-card-foreground text-[13px] font-medium">
              Rebalance Log
            </CardTitle>
            {rebalanceLog.length > 0 && (
              <span className="text-muted-foreground font-mono text-[11px]">
                {rebalanceLog.length} rebalances
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-1">
          {isEmpty ? (
            <div className="text-muted-foreground px-4 py-8 text-center text-[12px]">
              Rebalance log not available. Re-run the strategy to populate trades.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground pl-4 text-[11px] font-medium">
                      Date
                    </TableHead>
                    <TableHead className="text-muted-foreground text-[11px] font-medium">
                      Entered
                    </TableHead>
                    <TableHead className="text-muted-foreground text-[11px] font-medium">
                      Exited
                    </TableHead>
                    <TableHead className="text-muted-foreground hidden pr-4 text-right text-[11px] font-medium sm:table-cell">
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
                        <TableCell className="text-muted-foreground py-2.5 pl-4 font-mono text-[12px] whitespace-nowrap">
                          {row.date}
                        </TableCell>
                        {row.isAllCash ? (
                          <TableCell
                            colSpan={2}
                            className="text-muted-foreground/60 py-2.5 text-[11px] italic"
                          >
                            all-cash (no qualifying assets this period)
                          </TableCell>
                        ) : (
                          <>
                            <TableCell className="max-w-[200px] py-2">
                              <div className="flex flex-wrap gap-1">
                                {row.entered.length === 0 ? (
                                  <span className="text-muted-foreground text-[11px]">—</span>
                                ) : (
                                  row.entered.map((t) => (
                                    <Badge
                                      key={t}
                                      variant="outline"
                                      className="text-success border-success/20 bg-success/8 h-[18px] px-1.5 py-0 font-mono text-[10px]"
                                    >
                                      {t}
                                    </Badge>
                                  ))
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[200px] py-2">
                              <div className="flex flex-wrap gap-1">
                                {row.exited.length === 0 ? (
                                  <span className="text-muted-foreground text-[11px]">—</span>
                                ) : (
                                  row.exited.map((t) => (
                                    <Badge
                                      key={t}
                                      variant="outline"
                                      className="text-destructive border-destructive/20 bg-destructive/8 h-[18px] px-1.5 py-0 font-mono text-[10px]"
                                    >
                                      {t}
                                    </Badge>
                                  ))
                                )}
                              </div>
                            </TableCell>
                          </>
                        )}
                        <TableCell className="text-muted-foreground hidden py-2.5 pr-4 text-right font-mono text-[12px] sm:table-cell">
                          {row.isAllCash
                            ? "0 (cash)"
                            : row.isInitialEstablishment
                              ? `${row.count} (init)`
                              : row.count}
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
  );
}
