"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { NativeSelect } from "@/components/ui/native-select";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { CompareRunBundle, RunWithMetrics, RunMetricsRow } from "@/lib/supabase/types";
import { STRATEGY_LABELS, type StrategyId } from "@/lib/types";
import { getRunBenchmark } from "@/lib/benchmark";
import { alignEquityCurveByDate, type EquityCurvePoint } from "@/lib/equity-curve";

function extractMetrics(run: RunWithMetrics): RunMetricsRow | null {
  if (!run.run_metrics) return null;
  if (Array.isArray(run.run_metrics)) return run.run_metrics[0] ?? null;
  return run.run_metrics;
}

type Props = {
  bundles: CompareRunBundle[];
  strategyRuns?: RunWithMetrics[];
};

type MetricDef = {
  key: "cagr" | "sharpe" | "max_drawdown" | "turnover";
  label: string;
  higherIsBetter: boolean;
  format: (value: number) => string;
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
    label: "Turnover (Ann.)",
    higherIsBetter: false,
    format: (v) => `${(v * 100).toFixed(1)}%`,
  },
];

function normalizeSeries(equity: EquityCurvePoint[]) {
  if (equity.length === 0) return [];
  const firstP = equity[0].portfolio;
  const firstB = equity[0].benchmark;
  return equity.map((pt) => ({
    date: pt.date,
    portfolio: firstP > 0 ? (pt.portfolio / firstP) * 100 : 100,
    benchmark: firstB > 0 ? (pt.benchmark / firstB) * 100 : 100,
  }));
}

const LEADERBOARD_METRICS: {
  key: keyof RunMetricsRow;
  label: string;
  higherIsBetter: boolean;
  format: (v: number) => string;
}[] = [
  { key: "cagr", label: "CAGR", higherIsBetter: true, format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "sharpe", label: "Sharpe", higherIsBetter: true, format: (v) => v.toFixed(2) },
  {
    key: "max_drawdown",
    label: "Max DD",
    higherIsBetter: false,
    format: (v) => `${(Math.abs(v) * 100).toFixed(1)}%`,
  },
  {
    key: "volatility",
    label: "Volatility",
    higherIsBetter: false,
    format: (v) => `${(v * 100).toFixed(1)}%`,
  },
  {
    key: "turnover",
    label: "Turnover (Ann.)",
    higherIsBetter: false,
    format: (v) => `${(v * 100).toFixed(1)}%`,
  },
  { key: "calmar", label: "Calmar", higherIsBetter: true, format: (v) => v.toFixed(2) },
];

export function CompareWorkbench({ bundles, strategyRuns = [] }: Props) {
  const [runAId, setRunAId] = useState(bundles[0]?.run.id ?? "");
  const [runBId, setRunBId] = useState(bundles[1]?.run.id ?? bundles[0]?.run.id ?? "");

  const runA = bundles.find((b) => b.run.id === runAId) ?? null;
  const runB = bundles.find((b) => b.run.id === runBId) ?? null;

  const benchLabelA = runA ? getRunBenchmark(runA.run) : "Benchmark";
  const benchLabelB = runB ? getRunBenchmark(runB.run) : "Benchmark";

  const config = useMemo(
    () =>
      ({
        runA: { label: "Run A", color: "var(--color-chart-1)" },
        runB: { label: "Run B", color: "var(--color-chart-5)" },
        benchA: { label: `${benchLabelA} (A)`, color: "var(--color-chart-2)" },
        benchB: { label: `${benchLabelB} (B)`, color: "var(--color-chart-4)" },
      }) satisfies ChartConfig,
    [benchLabelA, benchLabelB]
  );

  const chartData = useMemo(() => {
    if (!runA || !runB) return [];

    // Clean each series the same way the run-detail chart does: remove invalid
    // portfolio values and forward-fill benchmark gaps.
    const aClean = alignEquityCurveByDate(runA.equity);
    const bClean = alignEquityCurveByDate(runB.equity);

    if (aClean.length === 0 || bClean.length === 0) return [];

    // Use the INTERSECTION of both date sets so neither line has null gaps.
    // A union merge with null produces a visual cliff where one run ends before
    // the other — Recharts draws nothing at null values, making the shorter
    // series appear to flatline and cut off mid-chart.
    const bDateSet = new Set(bClean.map((x) => x.date));
    const aDateSet = new Set(aClean.map((x) => x.date));
    const aIntersection = aClean.filter((x) => bDateSet.has(x.date));
    const bIntersection = bClean.filter((x) => aDateSet.has(x.date));

    if (aIntersection.length === 0) return [];

    // Normalize each filtered series to 100 at the shared start date.
    const a = normalizeSeries(aIntersection);
    const b = normalizeSeries(bIntersection);
    const aByDate = new Map(a.map((x) => [x.date, x]));
    const bByDate = new Map(b.map((x) => [x.date, x]));

    return aIntersection.map(({ date }) => ({
      date,
      runA: aByDate.get(date)?.portfolio ?? null,
      runB: bByDate.get(date)?.portfolio ?? null,
      benchA: aByDate.get(date)?.benchmark ?? null,
      benchB: bByDate.get(date)?.benchmark ?? null,
    }));
  }, [runA, runB]);

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
      {/* Strategy leaderboard */}
      {strategyRuns.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-foreground text-sm font-semibold">
              Strategy Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-border/70 text-muted-foreground border-b">
                    <th className="py-2 pr-3 text-left font-medium">Strategy</th>
                    {LEADERBOARD_METRICS.map((m) => (
                      <th key={m.key} className="px-2 py-2 text-right font-medium">
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {strategyRuns.map((run) => {
                    const m = extractMetrics(run);
                    return (
                      <tr key={run.id} className="border-border/40 border-b last:border-0">
                        <td className="text-foreground py-2 pr-3 font-medium">
                          {STRATEGY_LABELS[run.strategy_id as StrategyId] ?? run.strategy_id}
                        </td>
                        {LEADERBOARD_METRICS.map((def) => {
                          const val = m ? Number(m[def.key]) : null;
                          return (
                            <td
                              key={def.key}
                              className="text-card-foreground px-2 py-2 text-right font-mono"
                            >
                              {val != null && !Number.isNaN(val) ? def.format(val) : "--"}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

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
          <ChartContainer config={config} className="h-[320px] w-full">
            <LineChart data={chartData} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v) =>
                  new Date(v + "T00:00:00Z").toLocaleDateString("en-US", {
                    month: "short",
                    year: "2-digit",
                    timeZone: "UTC",
                  })
                }
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
              <ChartTooltip content={<ChartTooltipContent />} />
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
