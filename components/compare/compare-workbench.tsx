"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { NativeSelect } from "@/components/ui/native-select";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { CompareRunBundle } from "@/lib/supabase/types";
import { getRunBenchmark } from "@/lib/benchmark";
import { alignEquityCurveByDate, type EquityCurvePoint } from "@/lib/equity-curve";

type Props = {
  bundles: CompareRunBundle[];
};

type MetricDef = {
  key: "cagr" | "sharpe" | "max_drawdown" | "turnover";
  label: string;
  higherIsBetter: boolean;
  format: (value: number) => string;
};

type SharedComparisonPoint = {
  date: string;
  runA: EquityCurvePoint;
  runB: EquityCurvePoint;
};

const METRICS: MetricDef[] = [
  { key: "cagr", label: "CAGR", higherIsBetter: true, format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "sharpe", label: "Sharpe", higherIsBetter: true, format: (v) => v.toFixed(2) },
  {
    key: "max_drawdown",
    label: "Max Drawdown",
    higherIsBetter: false,
    format: (v) => `${(Math.abs(v) * 100).toFixed(1)}%`,
  },
  {
    key: "turnover",
    label: "Turnover (Ann., drift-adj.)",
    higherIsBetter: false,
    format: (v) => `${(v * 100).toFixed(1)}%`,
  },
];

const RUN_COMPARE_CONFIG = {
  runA: { label: "Run A", color: "var(--color-chart-1)" },
  runB: { label: "Run B", color: "var(--color-chart-5)" },
} satisfies ChartConfig;

function formatCompareAxisDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function formatCompareTooltipDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function getSharedComparisonPoints(
  runAEquity: EquityCurvePoint[],
  runBEquity: EquityCurvePoint[]
): SharedComparisonPoint[] {
  const aClean = alignEquityCurveByDate(runAEquity);
  const bClean = alignEquityCurveByDate(runBEquity);

  if (aClean.length === 0 || bClean.length === 0) return [];

  const aByDate = new Map(aClean.map((point) => [point.date, point]));
  const bByDate = new Map(bClean.map((point) => [point.date, point]));
  const sharedDates = aClean.map((point) => point.date).filter((date) => bByDate.has(date));

  return sharedDates.map((date) => ({
    date,
    runA: aByDate.get(date)!,
    runB: bByDate.get(date)!,
  }));
}

function buildDrawdownChartData(points: SharedComparisonPoint[]) {
  let peakA = Number.NEGATIVE_INFINITY;
  let peakB = Number.NEGATIVE_INFINITY;

  return points.map(({ date, runA, runB }) => {
    peakA = Math.max(peakA, runA.portfolio);
    peakB = Math.max(peakB, runB.portfolio);

    return {
      date,
      runA: peakA > 0 ? ((runA.portfolio - peakA) / peakA) * 100 : 0,
      runB: peakB > 0 ? ((runB.portfolio - peakB) / peakB) * 100 : 0,
    };
  });
}

export function CompareWorkbench({ bundles }: Props) {
  const [runAId, setRunAId] = useState(bundles[0]?.run.id ?? "");
  const [runBId, setRunBId] = useState(bundles[1]?.run.id ?? bundles[0]?.run.id ?? "");

  const runA = bundles.find((b) => b.run.id === runAId) ?? null;
  const runB = bundles.find((b) => b.run.id === runBId) ?? null;

  const benchLabelA = runA ? getRunBenchmark(runA.run) : "Benchmark";
  const benchLabelB = runB ? getRunBenchmark(runB.run) : "Benchmark";

  const equityConfig = useMemo(
    () =>
      ({
        ...RUN_COMPARE_CONFIG,
        benchA: { label: `${benchLabelA} (A)`, color: "var(--color-chart-2)" },
        benchB: { label: `${benchLabelB} (B)`, color: "var(--color-chart-4)" },
      }) satisfies ChartConfig,
    [benchLabelA, benchLabelB]
  );

  const sharedComparisonPoints = useMemo(() => {
    if (!runA || !runB) return [];
    return getSharedComparisonPoints(runA.equity, runB.equity);
  }, [runA, runB]);

  const equityChartData = useMemo(() => {
    if (sharedComparisonPoints.length === 0) return [];

    const firstRunA = sharedComparisonPoints[0].runA.portfolio;
    const firstRunB = sharedComparisonPoints[0].runB.portfolio;
    const firstBenchA = sharedComparisonPoints[0].runA.benchmark;
    const firstBenchB = sharedComparisonPoints[0].runB.benchmark;

    return sharedComparisonPoints.map(({ date, runA, runB }) => ({
      date,
      runA: firstRunA > 0 ? (runA.portfolio / firstRunA) * 100 : 100,
      runB: firstRunB > 0 ? (runB.portfolio / firstRunB) * 100 : 100,
      benchA: firstBenchA > 0 ? (runA.benchmark / firstBenchA) * 100 : 100,
      benchB: firstBenchB > 0 ? (runB.benchmark / firstBenchB) * 100 : 100,
    }));
  }, [sharedComparisonPoints]);

  const drawdownChartData = useMemo(
    () => buildDrawdownChartData(sharedComparisonPoints),
    [sharedComparisonPoints]
  );

  const drawdownDomain = useMemo(() => {
    if (drawdownChartData.length === 0) return undefined;

    return [Math.min(...drawdownChartData.flatMap((point) => [point.runA, point.runB]), 0), 0] as [
      number,
      number,
    ];
  }, [drawdownChartData]);

  if (bundles.length < 2) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-foreground text-[13px] font-medium">
            At least two completed runs are required to compare.
          </p>
          <p className="text-muted-foreground max-w-[320px] text-[12px]">
            {bundles.length === 0
              ? "You don't have any completed runs yet. Create a backtest run to get started."
              : "You only have one completed run. Create another backtest to enable comparison."}
          </p>
          <Link href="/runs/new">
            <Button size="sm" className="mt-1 h-8 text-[12px] font-medium">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Run
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-foreground text-sm font-semibold">Select Runs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">Run A</p>
            <NativeSelect
              value={runAId}
              onChange={(e) => setRunAId(e.target.value)}
              className="border-input h-9 bg-transparent px-3 pr-8 text-sm"
              iconClassName="opacity-50"
            >
              {bundles.map((b) => (
                <option key={`a-${b.run.id}`} value={b.run.id}>
                  {b.run.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">Run B</p>
            <NativeSelect
              value={runBId}
              onChange={(e) => setRunBId(e.target.value)}
              className="border-input h-9 bg-transparent px-3 pr-8 text-sm"
              iconClassName="opacity-50"
            >
              {bundles.map((b) => (
                <option key={`b-${b.run.id}`} value={b.run.id}>
                  {b.run.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-foreground text-sm font-semibold">
            Overlay Equity (Indexed to 100)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={equityConfig} className="h-[320px] w-full">
            <LineChart data={equityChartData} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={formatCompareAxisDate}
                interval="preserveStartEnd"
                className="text-[10px]"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v) => `${Number(v).toFixed(0)}`}
                className="text-[10px]"
              />
              <ChartTooltip
                content={<ChartTooltipContent labelFormatter={formatCompareTooltipDate} />}
              />
              <Line
                type="monotone"
                dataKey="runA"
                stroke="var(--color-chart-1)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="runB"
                stroke="var(--color-chart-5)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="benchA"
                stroke="var(--color-chart-2)"
                strokeDasharray="4 4"
                strokeWidth={1.2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="benchB"
                stroke="var(--color-chart-4)"
                strokeDasharray="4 4"
                strokeWidth={1.2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-foreground text-sm font-semibold">Overlay Drawdown</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={RUN_COMPARE_CONFIG} className="h-[240px] w-full">
            <LineChart data={drawdownChartData} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={formatCompareAxisDate}
                interval="preserveStartEnd"
                className="text-[10px]"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                domain={drawdownDomain}
                className="text-[10px]"
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={formatCompareTooltipDate}
                    formatter={(value) => [`${Number(value).toFixed(2)}%`, ""]}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent verticalAlign="top" />} />
              <Line
                type="monotone"
                dataKey="runA"
                stroke="var(--color-chart-1)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="runB"
                stroke="var(--color-chart-5)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {runA && runB && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-foreground text-sm font-semibold">Metric Diff</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-border/70 text-muted-foreground border-b">
                    <th className="py-2 pr-3 text-left font-medium">Metric</th>
                    <th className="px-3 py-2 text-right font-medium">Run A</th>
                    <th className="px-3 py-2 text-right font-medium">Run B</th>
                    <th className="py-2 pl-3 text-right font-medium">Difference (A-B)</th>
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map((m) => {
                    const a = Number(runA.metrics[m.key]);
                    const b = Number(runB.metrics[m.key]);
                    const diff = a - b;
                    const aWins = m.higherIsBetter ? a > b : a < b;
                    const bWins = m.higherIsBetter ? b > a : b < a;
                    return (
                      <tr key={m.key} className="border-border/40 border-b last:border-0">
                        <td className="text-foreground py-2 pr-3 font-medium">{m.label}</td>
                        <td
                          className={`px-3 py-2 text-right font-mono ${aWins ? "text-success" : ""}`}
                        >
                          {m.format(a)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-mono ${bWins ? "text-success" : ""}`}
                        >
                          {m.format(b)}
                        </td>
                        <td
                          className={`py-2 pl-3 text-right font-mono ${diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-success" : "text-destructive"}`}
                        >
                          {diff >= 0 ? "+" : ""}
                          {m.key === "sharpe" ? diff.toFixed(2) : `${(diff * 100).toFixed(1)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
