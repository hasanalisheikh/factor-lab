import type { ChartConfig } from "@/components/ui/chart";
import { alignEquityCurveByDate, type EquityCurvePoint } from "@/lib/equity-curve";

export type MetricDef = {
  key: "cagr" | "sharpe" | "max_drawdown" | "turnover";
  label: string;
  higherIsBetter: boolean;
  format: (value: number) => string;
};

export type SharedComparisonPoint = {
  date: string;
  runA: EquityCurvePoint;
  runB: EquityCurvePoint;
};

export const METRICS: MetricDef[] = [
  { key: "cagr", label: "CAGR", higherIsBetter: true, format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "sharpe", label: "Sharpe", higherIsBetter: true, format: (v) => v.toFixed(2) },
  {
    key: "max_drawdown",
    label: "Max Drawdown",
    higherIsBetter: false,
    format: (v) => `${(Math.abs(v) * 100).toFixed(1)}%`,
  },
  {
    key: "turnover",
    label: "Turnover (Ann., drift-adj.)",
    higherIsBetter: false,
    format: (v) => `${(v * 100).toFixed(1)}%`,
  },
];

export const RUN_COMPARE_CONFIG = {
  runA: { label: "Run A", color: "var(--color-chart-1)" },
  runB: { label: "Run B", color: "var(--color-chart-5)" },
} satisfies ChartConfig;

export function formatCompareAxisDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export function formatCompareTooltipDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function getSharedComparisonPoints(
  runAEquity: EquityCurvePoint[],
  runBEquity: EquityCurvePoint[]
): SharedComparisonPoint[] {
  const aClean = alignEquityCurveByDate(runAEquity);
  const bClean = alignEquityCurveByDate(runBEquity);

  if (aClean.length === 0 || bClean.length === 0) return [];

  const aByDate = new Map(aClean.map((point) => [point.date, point]));
  const bByDate = new Map(bClean.map((point) => [point.date, point]));
  const sharedDates = aClean.map((point) => point.date).filter((date) => bByDate.has(date));

  return sharedDates.map((date) => ({
    date,
    runA: aByDate.get(date)!,
    runB: bByDate.get(date)!,
  }));
}

export function buildDrawdownChartData(points: SharedComparisonPoint[]) {
  let peakA = Number.NEGATIVE_INFINITY;
  let peakB = Number.NEGATIVE_INFINITY;

  return points.map(({ date, runA, runB }) => {
    peakA = Math.max(peakA, runA.portfolio);
    peakB = Math.max(peakB, runB.portfolio);

    return {
      date,
      runA: peakA > 0 ? ((runA.portfolio - peakA) / peakA) * 100 : 0,
      runB: peakB > 0 ? ((runB.portfolio - peakB) / peakB) * 100 : 0,
    };
  });
}
