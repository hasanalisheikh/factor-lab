export interface EquityCurvePoint {
  date: string;
  portfolio: number;
  benchmark: number;
}

export const DEFAULT_EQUITY_CHART_MAX_POINTS = 1000;

export const dashboardTimeframes = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "ALL", days: null },
] as const;

export type DashboardTimeframeLabel = (typeof dashboardTimeframes)[number]["label"];

/** Returns "ALL" when the run spans more than 365 days, otherwise "1Y". */
export function getDefaultTimeframe(data: EquityCurvePoint[]): string {
  if (data.length < 2) return "1Y";
  const first = data[0].date;
  const last = data[data.length - 1].date;
  const diffDays =
    (new Date(`${last}T00:00:00Z`).getTime() - new Date(`${first}T00:00:00Z`).getTime()) / 86400000;
  return diffDays > 365 ? "ALL" : "1Y";
}

/**
 * Deterministic index-based downsampling that spans the full range and always
 * preserves the final point.
 */
export function getDownsampleIndices(
  length: number,
  maxPoints = DEFAULT_EQUITY_CHART_MAX_POINTS
): number[] {
  if (length <= 0 || maxPoints <= 0) return [];

  const k = Math.min(length, maxPoints);
  if (k === length) {
    return Array.from({ length }, (_, index) => index);
  }
  if (k === 1) {
    return [length - 1];
  }

  return Array.from({ length: k }, (_, index) => Math.round((index * (length - 1)) / (k - 1)));
}

export function pickByIndices<T>(data: T[], indices: number[]): T[] {
  return indices.map((index) => data[index]).filter((value): value is T => value != null);
}

export function downsampleEquityCurve(
  data: EquityCurvePoint[],
  maxPoints = DEFAULT_EQUITY_CHART_MAX_POINTS
): EquityCurvePoint[] {
  return pickByIndices(data, getDownsampleIndices(data.length, maxPoints));
}

export function sliceEquityCurveByTimeframe(
  data: EquityCurvePoint[],
  timeframe: string
): EquityCurvePoint[] {
  if (timeframe === "ALL" || data.length === 0) return data;

  const tf = dashboardTimeframes.find((t) => t.label === timeframe);
  if (!tf || tf.days == null) return data;

  const last = data[data.length - 1]?.date;
  if (!last) return [];

  const cutoff = new Date(`${last}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - tf.days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return data.filter((p) => p.date >= cutoffStr);
}

function isValidEquityValue(x: number): boolean {
  return Number.isFinite(x) && x > 0;
}

/**
 * Explicit inner join on date after splitting portfolio/benchmark series.
 * This guards KPI math against malformed rows (missing/invalid values) and
 * ensures portfolio + SPY use the exact same date set.
 *
 * Benchmark gaps (missing/invalid values) are forward-filled from the last
 * known valid benchmark value so recent dates are not silently dropped when
 * the benchmark price feed lags by a day or two.
 */
export function alignEquityCurveByDate(data: EquityCurvePoint[]): EquityCurvePoint[] {
  const portfolioByDate = new Map<string, number>();
  const benchmarkByDate = new Map<string, number>();
  const orderedDates: string[] = [];
  const seen = new Set<string>();

  for (const row of data) {
    if (!seen.has(row.date)) {
      orderedDates.push(row.date);
      seen.add(row.date);
    }
    if (isValidEquityValue(row.portfolio)) {
      portfolioByDate.set(row.date, row.portfolio);
    }
    if (isValidEquityValue(row.benchmark)) {
      benchmarkByDate.set(row.date, row.benchmark);
    }
  }

  const aligned: EquityCurvePoint[] = [];
  let lastBenchmark: number | undefined;
  for (const date of orderedDates) {
    const portfolio = portfolioByDate.get(date);
    if (portfolio == null) continue;
    const benchmarkRaw = benchmarkByDate.get(date);
    const benchmark = benchmarkRaw ?? lastBenchmark;
    if (benchmark == null) continue;
    lastBenchmark = benchmark;
    aligned.push({ date, portfolio, benchmark });
  }
  return aligned;
}

export function getAlignedTimeframeEquityCurve(
  data: EquityCurvePoint[],
  timeframe: string
): EquityCurvePoint[] {
  return alignEquityCurveByDate(sliceEquityCurveByTimeframe(data, timeframe));
}

export type ChartDateLabels = {
  start: string;
  mid: string;
  end: string;
};

export function getChartDateLabels<T extends { date: string }>(data: T[]): ChartDateLabels {
  if (data.length === 0) {
    return { start: "", mid: "", end: "" };
  }

  const lastIndex = data.length - 1;
  return {
    start: data[0].date,
    mid: data[Math.floor(lastIndex / 2)].date,
    end: data[lastIndex].date,
  };
}

export function prepareTimeframeEquityCurve(
  data: EquityCurvePoint[],
  timeframe: string,
  maxPoints = DEFAULT_EQUITY_CHART_MAX_POINTS
) {
  const raw = getAlignedTimeframeEquityCurve(data, timeframe);
  const plottedIndices = getDownsampleIndices(raw.length, maxPoints);
  const plotted = pickByIndices(raw, plottedIndices);

  return {
    raw,
    plotted,
    plottedIndices,
    rawCount: raw.length,
    plottedCount: plotted.length,
    dateLabels: getChartDateLabels(plotted),
  };
}
