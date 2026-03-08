"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { NativeSelect } from "@/components/ui/native-select"
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { CompareRunBundle, RunWithMetrics, RunMetricsRow } from "@/lib/supabase/types"
import { STRATEGY_LABELS, type StrategyId } from "@/lib/types"
import { getRunBenchmark } from "@/lib/benchmark"

function extractMetrics(run: RunWithMetrics): RunMetricsRow | null {
  if (!run.run_metrics) return null
  if (Array.isArray(run.run_metrics)) return run.run_metrics[0] ?? null
  return run.run_metrics
}

type Props = {
  bundles: CompareRunBundle[]
  strategyRuns?: RunWithMetrics[]
}

type MetricDef = {
  key: "cagr" | "sharpe" | "max_drawdown" | "turnover"
  label: string
  higherIsBetter: boolean
  format: (value: number) => string
}

const METRICS: MetricDef[] = [
  { key: "cagr", label: "CAGR", higherIsBetter: true, format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "sharpe", label: "Sharpe", higherIsBetter: true, format: (v) => v.toFixed(2) },
  { key: "max_drawdown", label: "Max Drawdown", higherIsBetter: false, format: (v) => `${(Math.abs(v) * 100).toFixed(1)}%` },
  { key: "turnover", label: "Turnover (Ann.)", higherIsBetter: false, format: (v) => `${(v * 100).toFixed(1)}%` },
]

function normalizeSeries(equity: CompareRunBundle["equity"]) {
  if (equity.length === 0) return []
  const firstP = equity[0].portfolio
  const firstB = equity[0].benchmark
  return equity.map((pt) => ({
    date: pt.date,
    portfolio: firstP > 0 ? (pt.portfolio / firstP) * 100 : 100,
    benchmark: firstB > 0 ? (pt.benchmark / firstB) * 100 : 100,
  }))
}

const LEADERBOARD_METRICS: {
  key: keyof RunMetricsRow
  label: string
  higherIsBetter: boolean
  format: (v: number) => string
}[] = [
  { key: "cagr", label: "CAGR", higherIsBetter: true, format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "sharpe", label: "Sharpe", higherIsBetter: true, format: (v) => v.toFixed(2) },
  { key: "max_drawdown", label: "Max DD", higherIsBetter: false, format: (v) => `${(Math.abs(v) * 100).toFixed(1)}%` },
  { key: "volatility", label: "Volatility", higherIsBetter: false, format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "turnover", label: "Turnover", higherIsBetter: false, format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "calmar", label: "Calmar", higherIsBetter: true, format: (v) => v.toFixed(2) },
]

export function CompareWorkbench({ bundles, strategyRuns = [] }: Props) {
  const [runAId, setRunAId] = useState(bundles[0]?.run.id ?? "")
  const [runBId, setRunBId] = useState(bundles[1]?.run.id ?? bundles[0]?.run.id ?? "")

  const runA = bundles.find((b) => b.run.id === runAId) ?? null
  const runB = bundles.find((b) => b.run.id === runBId) ?? null

  const benchLabelA = runA ? getRunBenchmark(runA.run) : "Benchmark"
  const benchLabelB = runB ? getRunBenchmark(runB.run) : "Benchmark"

  const config = useMemo(() => ({
    runA: { label: "Run A", color: "var(--color-chart-1)" },
    runB: { label: "Run B", color: "var(--color-chart-5)" },
    benchA: { label: `${benchLabelA} (A)`, color: "var(--color-chart-2)" },
    benchB: { label: `${benchLabelB} (B)`, color: "var(--color-chart-4)" },
  }) satisfies ChartConfig, [benchLabelA, benchLabelB])

  const chartData = useMemo(() => {
    if (!runA || !runB) return []
    const a = normalizeSeries(runA.equity)
    const b = normalizeSeries(runB.equity)
    const dates = Array.from(new Set([...a.map((x) => x.date), ...b.map((x) => x.date)])).sort()
    const aByDate = new Map(a.map((x) => [x.date, x]))
    const bByDate = new Map(b.map((x) => [x.date, x]))

    return dates.map((date) => {
      const av = aByDate.get(date)
      const bv = bByDate.get(date)
      return {
        date,
        runA: av?.portfolio ?? null,
        runB: bv?.portfolio ?? null,
        benchA: av?.benchmark ?? null,
        benchB: bv?.benchmark ?? null,
      }
    })
  }, [runA, runB])

  if (bundles.length < 2) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
          <p className="text-[13px] font-medium text-foreground">
            At least two completed runs are required to compare.
          </p>
          <p className="text-[12px] text-muted-foreground max-w-[320px]">
            {bundles.length === 0
              ? "You don't have any completed runs yet. Create a backtest run to get started."
              : "You only have one completed run. Create another backtest to enable comparison."}
          </p>
          <Link href="/runs/new">
            <Button size="sm" className="mt-1 h-8 text-[12px] font-medium">
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              New Run
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Strategy leaderboard */}
      {strategyRuns.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Strategy Leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/70 text-muted-foreground">
                    <th className="text-left py-2 pr-3 font-medium">Strategy</th>
                    {LEADERBOARD_METRICS.map((m) => (
                      <th key={m.key} className="text-right py-2 px-2 font-medium">{m.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {strategyRuns.map((run) => {
                    const m = extractMetrics(run)
                    return (
                      <tr key={run.id} className="border-b border-border/40 last:border-0">
                        <td className="py-2 pr-3 font-medium text-foreground">
                          {STRATEGY_LABELS[run.strategy_id as StrategyId] ?? run.strategy_id}
                        </td>
                        {LEADERBOARD_METRICS.map((def) => {
                          const val = m ? Number(m[def.key]) : null
                          return (
                            <td key={def.key} className="py-2 px-2 text-right font-mono text-card-foreground">
                              {val != null && !Number.isNaN(val) ? def.format(val) : "--"}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Select Runs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Run A</p>
            <NativeSelect
              value={runAId}
              onChange={(e) => setRunAId(e.target.value)}
              className="h-9 border-input bg-transparent px-3 pr-8 text-sm"
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
            <p className="text-xs text-muted-foreground">Run B</p>
            <NativeSelect
              value={runBId}
              onChange={(e) => setRunBId(e.target.value)}
              className="h-9 border-input bg-transparent px-3 pr-8 text-sm"
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
          <CardTitle className="text-sm font-semibold text-foreground">Overlay Equity (Indexed to 100)</CardTitle>
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
                tickFormatter={(v) => new Date(v + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })}
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
              <Line type="monotone" dataKey="runA" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="runB" stroke="var(--color-chart-5)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="benchA" stroke="var(--color-chart-2)" strokeDasharray="4 4" strokeWidth={1.2} dot={false} />
              <Line type="monotone" dataKey="benchB" stroke="var(--color-chart-4)" strokeDasharray="4 4" strokeWidth={1.2} dot={false} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {runA && runB && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Metric Diff</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/70 text-muted-foreground">
                    <th className="text-left py-2 pr-3 font-medium">Metric</th>
                    <th className="text-right py-2 px-3 font-medium">Run A</th>
                    <th className="text-right py-2 px-3 font-medium">Run B</th>
                    <th className="text-right py-2 pl-3 font-medium">Difference (A-B)</th>
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map((m) => {
                    const a = Number(runA.metrics[m.key])
                    const b = Number(runB.metrics[m.key])
                    const diff = a - b
                    const aWins = m.higherIsBetter ? a > b : a < b
                    const bWins = m.higherIsBetter ? b > a : b < a
                    return (
                      <tr key={m.key} className="border-b border-border/40 last:border-0">
                        <td className="py-2 pr-3 text-foreground font-medium">{m.label}</td>
                        <td className={`py-2 px-3 text-right font-mono ${aWins ? "text-success" : ""}`}>
                          {m.format(a)}
                        </td>
                        <td className={`py-2 px-3 text-right font-mono ${bWins ? "text-success" : ""}`}>
                          {m.format(b)}
                        </td>
                        <td className={`py-2 pl-3 text-right font-mono ${diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-success" : "text-destructive"}`}>
                          {diff >= 0 ? "+" : ""}
                          {m.key === "sharpe"
                            ? diff.toFixed(2)
                            : `${(diff * 100).toFixed(1)}%`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
