"use client"

import { useState, useMemo, type ReactNode } from "react"
import { MetricCards } from "@/components/metric-cards"
import { EquityChart } from "@/components/equity-chart"
import { computeMetrics } from "@/lib/metrics"
import { getAlignedTimeframeEquityCurve } from "@/lib/equity-curve"
import {
  formatSignedPct,
  formatPct,
  formatNum,
  formatSignedPctPoints,
  formatSignedNum,
} from "@/lib/format"
import type { DashboardMetric } from "@/lib/types"

// ── Temporary debug panel ──────────────────────────────────────────────────
// Renders a small diagnostics block below the metric cards.
// REMOVE this component and its usage after verifying metrics are correct.
function KpiDebugPanel({
  sliced,
  portfolio,
  benchmark,
}: {
  sliced: Array<{ date: string; portfolio: number; benchmark: number }>
  portfolio: { cagr: number | null; sharpe: number | null; maxDrawdown: number | null } | null
  benchmark: { cagr: number | null; sharpe: number | null; maxDrawdown: number | null } | null
}) {
  if (sliced.length === 0) return null
  const first = sliced[0]
  const last = sliced[sliced.length - 1]

  const cagrDelta =
    portfolio?.cagr != null && benchmark?.cagr != null
      ? portfolio.cagr - benchmark.cagr
      : null
  const sharpeDelta =
    portfolio?.sharpe != null && benchmark?.sharpe != null
      ? portfolio.sharpe - benchmark.sharpe
      : null
  const maxDDDelta =
    portfolio?.maxDrawdown != null && benchmark?.maxDrawdown != null
      ? portfolio.maxDrawdown - benchmark.maxDrawdown
      : null

  const fmt = (v: number | null, pct = false) =>
    v == null ? "—" : pct ? (v * 100).toFixed(2) + "%" : v.toFixed(4)
  const fmtPP = (v: number | null) =>
    v == null ? "—" : (v > 0 ? "+" : "") + (v * 100).toFixed(2) + " pp"

  return (
    <pre className="text-[10px] text-muted-foreground/60 bg-muted/20 rounded px-3 py-2 font-mono leading-relaxed overflow-x-auto">
      {`[DEBUG KPI alignment] ${sliced.length} pts  tf-start=${first.date}  tf-end=${last.date}
Portfolio  start=$${first.portfolio.toFixed(2)}  end=$${last.portfolio.toFixed(2)}
SPY        start=$${first.benchmark.toFixed(2)}  end=$${last.benchmark.toFixed(2)}
CAGR   port=${fmt(portfolio?.cagr ?? null, true)}  spy=${fmt(benchmark?.cagr ?? null, true)}  Δ=${fmtPP(cagrDelta)}
Sharpe port=${fmt(portfolio?.sharpe ?? null)}  spy=${fmt(benchmark?.sharpe ?? null)}  Δ=${sharpeDelta == null ? "—" : (sharpeDelta > 0 ? "+" : "") + sharpeDelta.toFixed(4)}
MaxDD  port=${fmt(portfolio?.maxDrawdown ?? null, true)}  spy=${fmt(benchmark?.maxDrawdown ?? null, true)}  Δ=${fmtPP(maxDDDelta)}`}
    </pre>
  )
}

interface EquityPoint {
  date: string
  portfolio: number
  benchmark: number
}

interface DashboardOverviewProps {
  equityCurve: EquityPoint[]
  /**
   * Annualized turnover fraction from run_metrics (e.g. 0.42 = 42%).
   * Null when not available; displayed as a static metric with no delta.
   */
  storedTurnover: number | null
  /**
   * Slot for the sidebar panel (e.g. <RecentRuns>).
   * Rendered in the left column of the equity-chart grid so the layout is preserved.
   */
  children?: ReactNode
}

export function DashboardOverview({
  equityCurve,
  storedTurnover,
  children,
}: DashboardOverviewProps) {
  const [selectedTf, setSelectedTf] = useState("1Y")

  const sliced = useMemo(() => {
    return getAlignedTimeframeEquityCurve(equityCurve, selectedTf)
  }, [equityCurve, selectedTf])

  // Compute all metrics from the same slice shown in the chart.
  const computed = useMemo(() => {
    if (sliced.length < 3) return null
    const dates = sliced.map((p) => p.date)
    const portfolio = sliced.map((p) => p.portfolio)
    const benchmark = sliced.map((p) => p.benchmark)
    return computeMetrics(dates, portfolio, benchmark)
  }, [sliced])

  const dashboardMetrics: DashboardMetric[] = useMemo(() => {
    const pm = computed?.portfolio ?? null
    const bm = computed?.benchmark ?? null
    const sp = computed?.sparklines

    // ── CAGR ──────────────────────────────────────────────────────────────
    const cagrDelta =
      pm?.cagr != null && bm?.cagr != null ? pm.cagr - bm.cagr : null

    // ── Sharpe ────────────────────────────────────────────────────────────
    const sharpeDelta =
      pm?.sharpe != null && bm?.sharpe != null ? pm.sharpe - bm.sharpe : null

    // ── Max Drawdown ───────────────────────────────────────────────────────
    // Both are positive fractions (lower is better).
    // Negative delta means portfolio drew down less → good.
    const maxDDDelta =
      pm?.maxDrawdown != null && bm?.maxDrawdown != null
        ? pm.maxDrawdown - bm.maxDrawdown
        : null

    return [
      {
        label: "CAGR",
        value: pm?.cagr != null ? formatSignedPct(pm.cagr) : "—",
        deltaRaw: cagrDelta,
        deltaFormatted: cagrDelta != null ? formatSignedPctPoints(cagrDelta) : null,
        deltaLabel: "vs SPY",
        lowerIsBetter: false,
        // Normalized equity: starts at 1.0, shape reflects growth trend.
        sparkline: sp?.equity ?? [],
      },
      {
        label: "Sharpe Ratio",
        value: pm?.sharpe != null ? formatNum(pm.sharpe) : "—",
        deltaRaw: sharpeDelta,
        deltaFormatted: sharpeDelta != null ? formatSignedNum(sharpeDelta) : null,
        deltaLabel: "vs SPY",
        lowerIsBetter: false,
        // Rolling 60-day Sharpe series (falls back to equity if data < 60 pts).
        sparkline: sp?.rollingSharpe ?? [],
      },
      {
        label: "Max Drawdown",
        value: pm?.maxDrawdown != null ? formatPct(pm.maxDrawdown) : "—",
        deltaRaw: maxDDDelta,
        deltaFormatted: maxDDDelta != null ? formatSignedPctPoints(maxDDDelta) : null,
        deltaLabel: "vs SPY",
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
    ]
  }, [computed, storedTurnover])

  return (
    <>
      <MetricCards metrics={dashboardMetrics} />
      {/* DEBUG: remove after verifying KPI values are correct */}
      <KpiDebugPanel
        sliced={sliced}
        portfolio={computed?.portfolio ?? null}
        benchmark={computed?.benchmark ?? null}
      />
      <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-4">
        {children}
        <EquityChart
          data={equityCurve}
          timeframe={selectedTf}
          onTimeframeChange={setSelectedTf}
        />
      </div>
    </>
  )
}
