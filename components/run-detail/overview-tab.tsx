"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { RunMetricsRow, EquityCurveRow } from "@/lib/supabase/queries"

const equityConfig = {
  portfolio: { label: "Portfolio", color: "var(--color-chart-1)" },
  benchmark: { label: "Benchmark", color: "var(--color-chart-5)" },
} satisfies ChartConfig

const ddConfig = {
  drawdown: { label: "Drawdown", color: "var(--color-chart-4)" },
} satisfies ChartConfig

function computeDrawdown(equity: EquityCurveRow[]) {
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
  { key: "max_drawdown", label: "Max DD", format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "volatility", label: "Volatility", format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "win_rate", label: "Win Rate", format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "profit_factor", label: "Profit Factor", format: (v) => v.toFixed(2) },
  { key: "turnover", label: "Turnover", format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "calmar", label: "Calmar", format: (v) => v.toFixed(2) },
]

interface OverviewTabProps {
  metrics: RunMetricsRow | null
  equityCurve: EquityCurveRow[]
}

export function OverviewTab({ metrics, equityCurve }: OverviewTabProps) {
  const drawdownData = computeDrawdown(equityCurve)

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
              <p className="text-lg font-semibold font-mono text-card-foreground leading-none">
                {metrics != null ? format(metrics[key] as number) : "--"}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Equity curve */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-1 px-4 pt-4">
          <CardTitle className="text-[13px] font-medium text-card-foreground">
            Equity Curve
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-3 pt-1">
          {equityCurve.length === 0 ? (
            <div className="h-[240px] flex items-center justify-center text-[12px] text-muted-foreground">
              No equity data available
            </div>
          ) : (
            <ChartContainer config={equityConfig} className="h-[240px] w-full">
              <AreaChart data={equityCurve} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ovPortfolio" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
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
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  className="text-[10px]"
                  stroke="var(--color-muted-foreground)"
                  opacity={0.5}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area dataKey="benchmark" type="monotone" fill="transparent" stroke="var(--color-chart-5)" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                <Area dataKey="portfolio" type="monotone" fill="url(#ovPortfolio)" stroke="var(--color-chart-1)" strokeWidth={1.8} dot={false} />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

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
    </div>
  )
}
