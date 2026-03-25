"use client";

import { useState, useMemo, type ReactNode } from "react";
import { MetricCards } from "@/components/metric-cards";
import { EquityChart } from "@/components/equity-chart";
import { computeMetrics } from "@/lib/metrics";
import { getAlignedTimeframeEquityCurve, getDefaultTimeframe } from "@/lib/equity-curve";
import {
  formatSignedPct,
  formatPct,
  formatNum,
  formatSignedPctPoints,
  formatSignedNum,
  formatDrawdown,
} from "@/lib/format";
import type { DashboardMetric } from "@/lib/types";
import { BenchmarkOverlapWarning } from "@/components/benchmark-overlap-warning";

interface EquityPoint {
  date: string;
  portfolio: number;
  benchmark: number;
}

interface DashboardOverviewProps {
  equityCurve: EquityPoint[];
  benchmark: string;
  benchmarkOverlapConfirmed: boolean;
  storedTurnover: number | null;
  children?: ReactNode;
}

export function DashboardOverview({
  equityCurve,
  benchmark,
  benchmarkOverlapConfirmed,
  storedTurnover,
  children,
}: DashboardOverviewProps) {
  const [selectedTf, setSelectedTf] = useState(() => getDefaultTimeframe(equityCurve));

  const sliced = useMemo(() => {
    return getAlignedTimeframeEquityCurve(equityCurve, selectedTf);
  }, [equityCurve, selectedTf]);

  // Compute all metrics from the same slice shown in the chart.
  const computed = useMemo(() => {
    if (sliced.length < 3) return null;
    const dates = sliced.map((p) => p.date);
    const portfolio = sliced.map((p) => p.portfolio);
    const benchmark = sliced.map((p) => p.benchmark);
    return computeMetrics(dates, portfolio, benchmark);
  }, [sliced]);

  const dashboardMetrics: DashboardMetric[] = useMemo(() => {
    const pm = computed?.portfolio ?? null;
    const bm = computed?.benchmark ?? null;
    const sp = computed?.sparklines;

    // ── CAGR ──────────────────────────────────────────────────────────────
    const cagrDelta = pm?.cagr != null && bm?.cagr != null ? pm.cagr - bm.cagr : null;

    // ── Sharpe ────────────────────────────────────────────────────────────
    const sharpeDelta = pm?.sharpe != null && bm?.sharpe != null ? pm.sharpe - bm.sharpe : null;

    // ── Max Drawdown ───────────────────────────────────────────────────────
    // Both are positive fractions (lower is better).
    // Negative delta means portfolio drew down less → good.
    const maxDDDelta =
      pm?.maxDrawdown != null && bm?.maxDrawdown != null ? pm.maxDrawdown - bm.maxDrawdown : null;

    return [
      {
        label: "CAGR",
        value: pm?.cagr != null ? formatSignedPct(pm.cagr) : "—",
        deltaRaw: cagrDelta,
        deltaFormatted: cagrDelta != null ? formatSignedPctPoints(cagrDelta) : null,
        deltaLabel: `vs ${benchmark}`,
        lowerIsBetter: false,
        // Normalized equity: starts at 1.0, shape reflects growth trend.
        sparkline: sp?.equity ?? [],
      },
      {
        label: "Sharpe Ratio",
        value: pm?.sharpe != null ? formatNum(pm.sharpe) : "—",
        deltaRaw: sharpeDelta,
        deltaFormatted: sharpeDelta != null ? formatSignedNum(sharpeDelta) : null,
        deltaLabel: `vs ${benchmark}`,
        lowerIsBetter: false,
        // Rolling 60-day Sharpe series (falls back to equity if data < 60 pts).
        sparkline: sp?.rollingSharpe ?? [],
      },
      {
        label: "Max Drawdown",
        value: pm?.maxDrawdown != null ? formatDrawdown(pm.maxDrawdown) : "—",
        deltaRaw: maxDDDelta,
        deltaFormatted: maxDDDelta != null ? formatSignedPctPoints(maxDDDelta) : null,
        deltaLabel: `vs ${benchmark}`,
        lowerIsBetter: true,
        // Drawdown series: 0 at peak, negative fraction when underwater.
        sparkline: sp?.drawdown ?? [],
      },
      {
        label: "Turnover (Ann.)",
        // Turnover is stored per-run total, not re-computed from equity curve.
        // No timeframe-adjusted delta is possible without per-rebalance data.
        value: storedTurnover != null ? formatPct(storedTurnover) : "—",
        deltaRaw: null,
        deltaFormatted: null,
        deltaLabel: "delta n/a",
        lowerIsBetter: true,
        // Use portfolio equity mini-trend as a neutral background sparkline.
        sparkline: sp?.equity ?? [],
      },
    ];
  }, [benchmark, computed, storedTurnover]);

  return (
    <>
      {benchmarkOverlapConfirmed ? <BenchmarkOverlapWarning benchmark={benchmark} /> : null}
      <MetricCards metrics={dashboardMetrics} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
        {children}
        <div className="flex flex-col gap-2">
          <EquityChart
            data={equityCurve}
            benchmarkTicker={benchmark}
            timeframe={selectedTf}
            onTimeframeChange={setSelectedTf}
          />
        </div>
      </div>
    </>
  );
}
