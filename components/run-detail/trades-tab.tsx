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
import type { ModelPredictionRow, PositionRow } from "@/lib/supabase/types";

const turnoverConfig = {
  turnover: { label: "Turnover %", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

type RebalanceEntry = {
  date: string;
  entered: string[];
  exited: string[];
  count: number;
};

type TradesData = {
  turnoverData: { date: string; turnover: number }[];
  rebalanceLog: RebalanceEntry[];
};

function getPredictionDisplayDate(row: ModelPredictionRow): string {
  return row.target_date || row.as_of_date;
}

function buildFromPredictions(predictions: ModelPredictionRow[]): TradesData {
  if (predictions.length === 0) return { turnoverData: [], rebalanceLog: [] };

  // Group by realized holding date so the log stays inside the requested run window.
  const byDate: Record<string, ModelPredictionRow[]> = {};
  for (const row of predictions) {
    const date = getPredictionDisplayDate(row);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(row);
  }

  const dates = Object.keys(byDate).sort();
  const turnoverData: { date: string; turnover: number }[] = [];
  const rebalanceLog: RebalanceEntry[] = [];
  let prevSelected = new Set<string>();
  let prevWeights = new Map<string, number>();

  for (const date of dates) {
    const rows = byDate[date];
    const currWeights = new Map(rows.map((r) => [r.ticker, Number(r.weight)]));
    const currSelected = new Set(rows.filter((r) => r.selected).map((r) => r.ticker));

    const allTickers = new Set([...prevWeights.keys(), ...currWeights.keys()]);
    let to = 0;
    for (const t of allTickers) {
      to += Math.abs((currWeights.get(t) ?? 0) - (prevWeights.get(t) ?? 0));
    }
    to /= 2;
    turnoverData.push({ date, turnover: Math.round(to * 1000) / 10 });

    const entered = [...currSelected].filter((t) => !prevSelected.has(t));
    const exited = [...prevSelected].filter((t) => !currSelected.has(t));
    rebalanceLog.push({ date, entered, exited, count: currSelected.size });

    prevSelected = currSelected;
    prevWeights = currWeights;
  }

  return { turnoverData, rebalanceLog };
}

function buildFromPositions(positions: PositionRow[]): TradesData {
  if (positions.length === 0) return { turnoverData: [], rebalanceLog: [] };

  // Group by date (rebalance snapshots)
  const byDate: Record<string, PositionRow[]> = {};
  for (const row of positions) {
    if (!byDate[row.date]) byDate[row.date] = [];
    byDate[row.date].push(row);
  }

  const dates = Object.keys(byDate).sort();
  const turnoverData: { date: string; turnover: number }[] = [];
  const rebalanceLog: RebalanceEntry[] = [];
  let prevSelected = new Set<string>();
  let prevWeights = new Map<string, number>();

  for (const date of dates) {
    const rows = byDate[date];
    const currWeights = new Map(rows.map((r) => [r.symbol, Number(r.weight)]));
    const currSelected = new Set(rows.filter((r) => Number(r.weight) > 0).map((r) => r.symbol));

    const allTickers = new Set([...prevWeights.keys(), ...currWeights.keys()]);
    let to = 0;
    for (const t of allTickers) {
      to += Math.abs((currWeights.get(t) ?? 0) - (prevWeights.get(t) ?? 0));
    }
    to /= 2;
    turnoverData.push({ date, turnover: Math.round(to * 1000) / 10 });

    const entered = [...currSelected].filter((t) => !prevSelected.has(t));
    const exited = [...prevSelected].filter((t) => !currSelected.has(t));
    rebalanceLog.push({ date, entered, exited, count: currSelected.size });

    prevSelected = currSelected;
    prevWeights = currWeights;
  }

  return { turnoverData, rebalanceLog };
}

interface TradesTabProps {
  predictions?: ModelPredictionRow[];
  positions?: PositionRow[];
}

export function TradesTab({ predictions = [], positions = [] }: TradesTabProps) {
  const { turnoverData, rebalanceLog } =
    predictions.length > 0 ? buildFromPredictions(predictions) : buildFromPositions(positions);
  const isEmpty = predictions.length === 0 && positions.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Turnover chart */}
      <Card className="bg-card border-border">
        <CardHeader className="px-4 pt-4 pb-1">
          <CardTitle className="text-card-foreground text-[13px] font-medium">
            Monthly Turnover
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
                        <TableCell className="text-muted-foreground hidden py-2.5 pr-4 text-right font-mono text-[12px] sm:table-cell">
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
  );
}
