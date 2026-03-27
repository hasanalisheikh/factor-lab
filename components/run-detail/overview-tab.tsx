"use client";

import { useState, useMemo } from "react";
import { formatDrawdown } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { EquityChart } from "@/components/equity-chart";
import {
  getDefaultTimeframe,
  pickByIndices,
  prepareTimeframeEquityCurve,
} from "@/lib/equity-curve";
import type { RunMetricsRow, EquityCurveRow } from "@/lib/supabase/types";

function DisclaimerFooter() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-border/40 text-muted-foreground mt-3 border-t pt-2.5 text-[11px]">
      <span>
        Research only — not financial advice. Results are simulated and may not reflect real
        trading. Costs/slippage are simplified; taxes, corporate actions, liquidity, and market
        impact are not fully modeled.
      </span>{" "}
      <button
        onClick={() => setOpen((v) => !v)}
        className="hover:text-foreground/70 underline underline-offset-2 transition-colors"
      >
        {open ? "Hide details" : "Details"}
      </button>
      {open && (
        <p className="mt-1.5">
          Universe presets are static snapshots and do not account for assets delisted or replaced
          during the backtest window, which may overstate long-window performance. The cost model
          applies a flat bps × turnover rate and does not capture bid-ask spread, market impact,
          borrowing costs, or short-selling constraints. Price data is sourced from Yahoo Finance;
          gaps are forward-filled and significant coverage gaps may affect results. All outputs are
          historical simulations only — not a guarantee of future returns.
        </p>
      )}
    </div>
  );
}

const ddConfig = {
  drawdown: { label: "Drawdown", color: "var(--color-chart-4)" },
} satisfies ChartConfig;

function computeDrawdown(equity: Array<{ date: string; portfolio: number }>) {
  let peak = -Infinity;
  return equity.map((pt) => {
    if (pt.portfolio > peak) peak = pt.portfolio;
    const dd = peak > 0 ? ((pt.portfolio - peak) / peak) * 100 : 0;
    return { date: pt.date, drawdown: dd };
  });
}

const metricDefs: { key: keyof RunMetricsRow; label: string; format: (v: number) => string }[] = [
  { key: "cagr", label: "CAGR", format: (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` },
  { key: "sharpe", label: "Sharpe", format: (v) => v.toFixed(2) },
  { key: "max_drawdown", label: "Max Drawdown", format: (v) => formatDrawdown(v) },
  { key: "volatility", label: "Volatility", format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "win_rate", label: "Win Rate", format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "profit_factor", label: "Profit Factor", format: (v) => v.toFixed(2) },
  { key: "turnover", label: "Turnover (Ann.)", format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "calmar", label: "Calmar", format: (v) => v.toFixed(2) },
];

export type RunConfig = {
  strategyLabel: string;
  universe: string;
  universeCount: number | null;
  benchmark: string;
  startDate: string | null;
  endDate: string | null;
  costsBps: number;
  topN: number | null;
  rebalanceFreq?: string;
  dataCutoffUsed?: string | null;
  universeEarliestStart?: string | null;
  benchmarkCoverageHealth?: { status: string; reason: string | null } | null;
  dualClassDisclosure?: boolean;
};

interface OverviewTabProps {
  metrics: RunMetricsRow | null;
  equityCurve: EquityCurveRow[];
  benchmarkTicker: string;
  runConfig?: RunConfig;
}

export function OverviewTab({
  metrics,
  equityCurve,
  benchmarkTicker,
  runConfig,
}: OverviewTabProps) {
  const [selectedTf, setSelectedTf] = useState(() => getDefaultTimeframe(equityCurve));

  // Derive effective window from actual equity-curve data, not requested run params.
  // These are used for the Period card so it stays consistent with the chart x-axis.
  const effectiveStart = equityCurve[0]?.date ?? runConfig?.startDate;
  const effectiveEnd = equityCurve[equityCurve.length - 1]?.date ?? runConfig?.endDate;

  const chartState = useMemo(
    () => prepareTimeframeEquityCurve(equityCurve, selectedTf),
    [equityCurve, selectedTf]
  );

  const rawDrawdownData = useMemo(() => computeDrawdown(chartState.raw), [chartState.raw]);
  const drawdownData = useMemo(
    () => pickByIndices(rawDrawdownData, chartState.plottedIndices),
    [chartState.plottedIndices, rawDrawdownData]
  );
  const drawdownDomain = useMemo(() => {
    if (rawDrawdownData.length === 0) return undefined;
    return [Math.min(...rawDrawdownData.map((point) => point.drawdown), 0), 0] as [number, number];
  }, [rawDrawdownData]);

  return (
    <div className="flex flex-col gap-4">
      {/* Metric cards grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metricDefs.map(({ key, label, format }) => (
          <Card
            key={key}
            data-testid="kpi-card"
            data-kpi-name={key}
            className="bg-card border-border"
          >
            <CardContent className="p-3.5">
              <p className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wider uppercase">
                {label}
              </p>
              <p
                className={`font-mono text-lg leading-none font-semibold ${
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
        <CardHeader className="px-4 pt-4 pb-1">
          <CardTitle className="text-card-foreground text-[13px] font-medium">Drawdown</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pt-1 pb-3">
          {drawdownData.length === 0 ? (
            <div className="text-muted-foreground flex h-[160px] items-center justify-center text-[12px]">
              No drawdown data available
            </div>
          ) : (
            <>
              <ChartContainer config={ddConfig} className="h-[160px] w-full">
                <AreaChart data={drawdownData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ovDrawdown" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-chart-4)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-chart-4)" stopOpacity={0} />
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
                    tickFormatter={(v) => `${v.toFixed(1)}%`}
                    domain={drawdownDomain}
                    className="text-[10px]"
                    stroke="var(--color-muted-foreground)"
                    opacity={0.5}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(v) => [`${Number(v).toFixed(2)}%`, "Drawdown"]}
                      />
                    }
                  />
                  <Area
                    dataKey="drawdown"
                    type="monotone"
                    fill="url(#ovDrawdown)"
                    stroke="var(--color-chart-4)"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </AreaChart>
              </ChartContainer>
              <div className="text-muted-foreground flex items-center justify-between px-4 pt-1 font-mono text-[10px]">
                <span>{chartState.dateLabels.start}</span>
                <span>{chartState.dateLabels.mid}</span>
                <span>{chartState.dateLabels.end}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Assumptions */}
      {runConfig && (
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-card-foreground text-[13px] font-medium">
              Run Configuration &amp; Assumptions
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[12px] sm:grid-cols-3">
              {[
                { label: "Strategy", value: runConfig.strategyLabel },
                {
                  label: "Universe",
                  value:
                    runConfig.universeCount != null
                      ? `${runConfig.universe} (${runConfig.universeCount} assets)`
                      : runConfig.universe,
                },
                { label: "Benchmark", value: runConfig.benchmark },
                {
                  label: "Period",
                  value:
                    effectiveStart && effectiveEnd
                      ? `${effectiveStart.slice(0, 7)} – ${effectiveEnd.slice(0, 7)}`
                      : "—",
                },
                { label: "Costs", value: `${runConfig.costsBps} bps per rebalance` },
                { label: "Rebalance", value: runConfig.rebalanceFreq ?? "Monthly" },
                { label: "Construction", value: "Equal weight" },
                {
                  label: "Data Handling",
                  value: "Inception-aware constraints enforced before queueing",
                },
                {
                  label: "Data Cutoff Used",
                  value: runConfig.dataCutoffUsed ?? "—",
                },
                {
                  label: "Universe Earliest Start",
                  value: runConfig.universeEarliestStart ?? "—",
                },
                {
                  label: "Benchmark Coverage Health",
                  value: runConfig.benchmarkCoverageHealth
                    ? `${runConfig.benchmarkCoverageHealth.status}${runConfig.benchmarkCoverageHealth.reason ? ` — ${runConfig.benchmarkCoverageHealth.reason}` : ""}`
                    : "—",
                },
                ...(runConfig.topN != null
                  ? [{ label: "Top N", value: String(runConfig.topN) }]
                  : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
                    {label}
                  </span>
                  <span className="text-foreground/90">{value}</span>
                </div>
              ))}
            </div>
            {runConfig.dualClassDisclosure && (
              <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-500">
                <strong>Dual-class shares:</strong> GOOGL and GOOG are both held &mdash; these are
                dual-class shares of Alphabet Inc. and move nearly identically; their combined
                weight is roughly double a single-class holding.
              </p>
            )}
            <DisclaimerFooter />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
