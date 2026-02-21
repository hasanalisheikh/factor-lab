"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { CompareRunBundle } from "@/lib/supabase/queries"

const config = {
  runA: { label: "Run A", color: "var(--color-chart-1)" },
  runB: { label: "Run B", color: "var(--color-chart-5)" },
  benchA: { label: "SPY A", color: "var(--color-chart-2)" },
  benchB: { label: "SPY B", color: "var(--color-chart-4)" },
} satisfies ChartConfig

type Props = {
  bundles: CompareRunBundle[]
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

export function CompareWorkbench({ bundles }: Props) {
  const [runAId, setRunAId] = useState(bundles[0]?.run.id ?? "")
  const [runBId, setRunBId] = useState(bundles[1]?.run.id ?? bundles[0]?.run.id ?? "")

  const runA = bundles.find((b) => b.run.id === runAId) ?? null
  const runB = bundles.find((b) => b.run.id === runBId) ?? null

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
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          At least two completed runs are required to compare.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Select Runs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Run A</p>
            <Select value={runAId} onValueChange={setRunAId}>
              <SelectTrigger>
                <SelectValue placeholder="Select run A" />
              </SelectTrigger>
              <SelectContent>
                {bundles.map((b) => (
                  <SelectItem key={`a-${b.run.id}`} value={b.run.id}>
                    {b.run.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Run B</p>
            <Select value={runBId} onValueChange={setRunBId}>
              <SelectTrigger>
                <SelectValue placeholder="Select run B" />
              </SelectTrigger>
              <SelectContent>
                {bundles.map((b) => (
                  <SelectItem key={`b-${b.run.id}`} value={b.run.id}>
                    {b.run.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
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
