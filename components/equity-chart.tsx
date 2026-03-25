"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import {
  dashboardTimeframes as timeframes,
  getDefaultTimeframe,
  prepareTimeframeEquityCurve,
} from "@/lib/equity-curve";

interface EquityPoint {
  date: string;
  portfolio: number;
  benchmark: number;
}

interface EquityChartProps {
  data: EquityPoint[];
  benchmarkTicker: string;
  /** Controlled mode: externally managed selected timeframe label */
  timeframe?: string;
  /** Controlled mode: called when user clicks a timeframe button */
  onTimeframeChange?: (label: string) => void;
}

export function EquityChart({
  data,
  benchmarkTicker,
  timeframe,
  onTimeframeChange,
}: EquityChartProps) {
  const [internalTf, setInternalTf] = useState(() => getDefaultTimeframe(data));
  const chartConfig = useMemo(
    () =>
      ({
        portfolio: { label: "Portfolio", color: "var(--color-chart-1)" },
        benchmark: { label: benchmarkTicker, color: "var(--color-chart-5)" },
      }) satisfies ChartConfig,
    [benchmarkTicker]
  );

  const selectedTf = timeframe ?? internalTf;
  const handleTfChange = (label: string) => {
    if (onTimeframeChange) {
      onTimeframeChange(label);
    } else {
      setInternalTf(label);
    }
  };

  const chartState = useMemo(() => {
    return prepareTimeframeEquityCurve(data, selectedTf);
  }, [selectedTf, data]);
  const chartData = chartState.plotted;
  const equityDomain = useMemo(() => {
    const values = chartState.raw.flatMap((point) => [point.portfolio, point.benchmark]);
    if (values.length === 0) return undefined;
    return [Math.min(...values), Math.max(...values)] as [number, number];
  }, [chartState.raw]);

  return (
    <Card className="bg-card border-border min-w-0 overflow-hidden">
      <CardHeader className="px-4 pt-4 pb-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <CardTitle className="text-card-foreground shrink-0 text-[13px] font-medium">
              Equity Curve
            </CardTitle>
            <div className="hidden items-center gap-3 sm:flex">
              <div className="flex items-center gap-1.5">
                <div className="bg-chart-1 h-1.5 w-1.5 rounded-full" />
                <span className="text-muted-foreground text-[10px]">Portfolio</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="bg-chart-5 h-1.5 w-1.5 rounded-full" />
                <span className="text-muted-foreground text-[10px]">{benchmarkTicker}</span>
              </div>
            </div>
          </div>
          <div className="bg-secondary flex shrink-0 items-center gap-0.5 rounded-lg p-0.5">
            {timeframes.map((tf) => (
              <Button
                key={tf.label}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-6 rounded-md px-2.5 text-[11px] font-medium",
                  selectedTf === tf.label
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => handleTfChange(tf.label)}
              >
                {tf.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-1 pb-3">
        {chartData.length === 0 ? (
          <div className="text-muted-foreground flex h-[280px] items-center justify-center text-[12px] lg:h-[320px]">
            No equity data available
          </div>
        ) : (
          <>
            <ChartContainer config={chartConfig} className="h-[280px] w-full min-w-0 lg:h-[320px]">
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
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-border/20"
                  vertical={false}
                />
                <XAxis dataKey="date" tick={false} tickLine={false} axisLine={false} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                  domain={equityDomain}
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
            <div className="text-muted-foreground flex items-center justify-between px-4 pt-1 font-mono text-[10px]">
              <span data-testid="chart-start-date">{chartState.dateLabels.start}</span>
              <span>{chartState.dateLabels.mid}</span>
              <span data-testid="chart-end-date">{chartState.dateLabels.end}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
