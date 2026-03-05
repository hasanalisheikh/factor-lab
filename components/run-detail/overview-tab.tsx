"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { EquityChart } from "@/components/equity-chart"
import {
  getDefaultTimeframe,
  sliceEquityCurveByTimeframe,
  alignEquityCurveByDate,
} from "@/lib/equity-curve"
import type { RunMetricsRow, EquityCurveRow } from "@/lib/supabase/types"

const ddConfig = {
  drawdown: { label: "Drawdown", color: "var(--color-chart-4)" },
} satisfies ChartConfig

function computeDrawdown(equity: Array<{ date: string; portfolio: number }>) {
  let peak = -Infinity
  return equity.map((pt) => {
    if (pt.portfolio > peak) peak = pt.portfolio
    const dd = peak > 0 ? ((pt.portfolio - peak) / peak) * 100 : 0
    return { date: pt.date, drawdown: dd }
  })
}

const metricDefs: { key: keyof RunMetricsRow; label: string; format: (v: number) => string }[] = [
  { key: "cagr", label: "CAGR", format: (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` },
  { key: "sharpe", label: "Sharpe", format: (v) => v.toFixed(2) },
  { key: "max_drawdown", label: "Max DD", format: (v) => `${Math.abs(v * 100).toFixed(1)}%` },
  { key: "volatility", label: "Volatility", format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "win_rate", label: "Win Rate", format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "profit_factor", label: "Profit Factor", format: (v) => v.toFixed(2) },
  { key: "turnover", label: "Turnover (Ann.)", format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "calmar", label: "Calmar", format: (v) => v.toFixed(2) },
]

export type RunConfig = {
  strategyLabel: string
  universe: string
  universeCount: number | null
  benchmark: string
  startDate: string | null
  endDate: string | null
  costsBps: number
  topN: number | null
}

interface OverviewTabProps {
  metrics: RunMetricsRow | null
  equityCurve: EquityCurveRow[]
  benchmarkTicker: string
  runConfig?: RunConfig
}

export function OverviewTab({ metrics, equityCurve, benchmarkTicker, runConfig }: OverviewTabProps) {
  const [selectedTf, setSelectedTf] = useState(() => getDefaultTimeframe(equityCurve))

  const slicedEquity = useMemo(
    () => alignEquityCurveByDate(sliceEquityCurveByTimeframe(equityCurve, selectedTf)),
    [equityCurve, selectedTf],
  )

  const drawdownData = useMemo(() => computeDrawdown(slicedEquity), [slicedEquity])

  return (
    <div className="flex flex-col gap-4">
      {/* Metric cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {metricDefs.map(({ key, label, format }) => (
          <Card key={key} className="bg-card border-border">
            <CardContent className="p-3.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                {label}
              </p>
              <p
                className={`text-lg font-semibold font-mono leading-none ${
                  key === "max_drawdown" ? "text-destructive" : "text-card-foreground"
                }`}
              >
                {metrics != null ? format(metrics[key] as number) : "--"}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Equity curve */}
      <EquityChart
        data={equityCurve}
        benchmarkTicker={benchmarkTicker}
        timeframe={selectedTf}
        onTimeframeChange={setSelectedTf}
      />

      {/* Drawdown */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-1 px-4 pt-4">
          <CardTitle className="text-[13px] font-medium text-card-foreground">
            Drawdown
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-3 pt-1">
          {drawdownData.length === 0 ? (
            <div className="h-[160px] flex items-center justify-center text-[12px] text-muted-foreground">
              No drawdown data available
            </div>
          ) : (
            <ChartContainer config={ddConfig} className="h-[160px] w-full">
              <AreaChart data={drawdownData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ovDrawdown" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-chart-4)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-chart-4)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short" })}
                  interval="preserveStartEnd"
                  className="text-[10px]"
                  stroke="var(--color-muted-foreground)"
                  opacity={0.5}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(v) => `${v.toFixed(1)}%`}
                  className="text-[10px]"
                  stroke="var(--color-muted-foreground)"
                  opacity={0.5}
                />
                <ChartTooltip content={<ChartTooltipContent formatter={(v) => [`${Number(v).toFixed(2)}%`, "Drawdown"]} />} />
                <Area dataKey="drawdown" type="monotone" fill="url(#ovDrawdown)" stroke="var(--color-chart-4)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Assumptions */}
      {runConfig && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-1 px-4 pt-4">
            <CardTitle className="text-[13px] font-medium text-card-foreground">
              Run Configuration &amp; Assumptions
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2.5 text-[12px]">
              {[
                { label: "Strategy", value: runConfig.strategyLabel },
                {
                  label: "Universe",
                  value: runConfig.universeCount != null
                    ? `${runConfig.universe} (${runConfig.universeCount} assets)`
                    : runConfig.universe,
                },
                { label: "Benchmark", value: runConfig.benchmark },
                {
                  label: "Period",
                  value: runConfig.startDate && runConfig.endDate
                    ? `${runConfig.startDate.slice(0, 7)} – ${runConfig.endDate.slice(0, 7)}`
                    : "—",
                },
                { label: "Costs", value: `${runConfig.costsBps} bps per rebalance` },
                { label: "Rebalance", value: "Monthly" },
                { label: "Construction", value: "Equal weight" },
                ...(runConfig.topN != null ? [{ label: "Top N", value: String(runConfig.topN) }] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    {label}
                  </span>
                  <span className="text-foreground/90">{value}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground border-t border-border/40 pt-2.5">
              Research only — not financial advice. Survivorship bias not accounted for.
              Cost model applies flat bps × turnover; market impact and bid-ask spread are not modeled.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
