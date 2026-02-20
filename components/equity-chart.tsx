"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { cn } from "@/lib/utils"

const chartConfig = {
  portfolio: { label: "Portfolio", color: "var(--color-chart-1)" },
  benchmark: { label: "S&P 500", color: "var(--color-chart-5)" },
} satisfies ChartConfig

const timeframes = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
]

interface EquityPoint {
  date: string
  portfolio: number
  benchmark: number
}

interface EquityChartProps {
  data: EquityPoint[]
}

export function EquityChart({ data }: EquityChartProps) {
  const [selectedTf, setSelectedTf] = useState("1Y")

  const tf = timeframes.find((t) => t.label === selectedTf)
  const chartData = tf ? data.slice(-tf.days) : data

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-1 px-4 pt-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-4">
            <CardTitle className="text-[13px] font-medium text-card-foreground">
              Equity Curve
            </CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-chart-1" />
                <span className="text-[10px] text-muted-foreground">Portfolio</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-chart-5" />
                <span className="text-[10px] text-muted-foreground">SPY</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5 bg-secondary rounded-lg p-0.5">
            {timeframes.map((tf) => (
              <Button
                key={tf.label}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-6 px-2.5 text-[11px] font-medium rounded-md",
                  selectedTf === tf.label
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setSelectedTf(tf.label)}
              >
                {tf.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-3 pt-1">
        {chartData.length === 0 ? (
          <div className="h-[280px] lg:h-[320px] flex items-center justify-center text-[12px] text-muted-foreground">
            No equity data available
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[280px] lg:h-[320px] w-full">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="eqPortfolio" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="eqBenchmark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-chart-5)" stopOpacity={0.08} />
                  <stop offset="95%" stopColor="var(--color-chart-5)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => {
                  const d = new Date(value)
                  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                }}
                interval="preserveStartEnd"
                className="text-[10px]"
                stroke="var(--color-muted-foreground)"
                opacity={0.5}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                className="text-[10px]"
                stroke="var(--color-muted-foreground)"
                opacity={0.5}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) =>
                      new Date(value).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })
                    }
                    formatter={(value) => [`$${Number(value).toLocaleString()}`, ""]}
                  />
                }
              />
              <Area
                dataKey="benchmark"
                type="monotone"
                fill="url(#eqBenchmark)"
                stroke="var(--color-chart-5)"
                strokeWidth={1.2}
                dot={false}
              />
              <Area
                dataKey="portfolio"
                type="monotone"
                fill="url(#eqPortfolio)"
                stroke="var(--color-chart-1)"
                strokeWidth={1.8}
                dot={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
