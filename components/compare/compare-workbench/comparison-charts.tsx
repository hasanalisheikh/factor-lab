import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { formatCompareAxisDate, formatCompareTooltipDate, RUN_COMPARE_CONFIG } from "./chart-data";

type EquityChartPoint = {
  date: string;
  runA: number;
  runB: number;
  benchA: number;
  benchB: number;
};

type DrawdownChartPoint = {
  date: string;
  runA: number;
  runB: number;
};

type ComparisonChartsProps = {
  equityConfig: ChartConfig;
  equityChartData: EquityChartPoint[];
  drawdownChartData: DrawdownChartPoint[];
  drawdownDomain?: [number, number];
};

export function ComparisonCharts({
  equityConfig,
  equityChartData,
  drawdownChartData,
  drawdownDomain,
}: ComparisonChartsProps) {
  return (
    <>
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
                tickFormatter={(value) => `${Number(value).toFixed(0)}`}
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
                tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
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
    </>
  );
}
