"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { Run } from "@/lib/mock-data"
import { equityCurve, drawdownData } from "@/lib/mock-data"

const equityConfig = {
  portfolio: { label: "Portfolio", color: "var(--color-chart-1)" },
  benchmark: { label: "Benchmark", color: "var(--color-chart-5)" },
} satisfies ChartConfig

const ddConfig = {
  drawdown: { label: "Drawdown", color: "var(--color-chart-4)" },
} satisfies ChartConfig

const metricLabels: { key: keyof Run["metrics"]; label: string; format: (v: number) => string }[] = [
  { key: "cagr", label: "CAGR", format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` },
  { key: "sharpe", label: "Sharpe", format: (v) => v.toFixed(2) },
  { key: "maxDrawdown", label: "Max DD", format: (v) => `${v.toFixed(1)}%` },
  { key: "volatility", label: "Volatility", format: (v) => `${v.toFixed(1)}%` },
  { key: "winRate", label: "Win Rate", format: (v) => `${v.toFixed(1)}%` },
  { key: "profitFactor", label: "Profit Factor", format: (v) => v.toFixed(2) },
  { key: "turnover", label: "Turnover", format: (v) => `${v.toFixed(1)}%` },
  { key: "calmar", label: "Calmar", format: (v) => v.toFixed(2) },
]

export function OverviewTab({ run }: { run: Run }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Metric cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {metricLabels.map(({ key, label, format }) => (
          <Card key={key} className="bg-card border-border">
            <CardContent className="p-3.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                {label}
              </p>
              <p className="text-lg font-semibold font-mono text-card-foreground leading-none">
                {format(run.metrics[key])}
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
                tickFormatter={(v) => `${v}%`}
                className="text-[10px]"
                stroke="var(--color-muted-foreground)"
                opacity={0.5}
              />
              <ChartTooltip content={<ChartTooltipContent formatter={(v) => [`${Number(v).toFixed(2)}%`, "Drawdown"]} />} />
              <Area dataKey="drawdown" type="monotone" fill="url(#ovDrawdown)" stroke="var(--color-chart-4)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}
