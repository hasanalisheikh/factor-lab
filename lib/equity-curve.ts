export interface EquityCurvePoint {
  date: string
  portfolio: number
  benchmark: number
}

export const dashboardTimeframes = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "ALL", days: null },
] as const

export type DashboardTimeframeLabel = (typeof dashboardTimeframes)[number]["label"]

/** Returns "ALL" when the run spans more than 365 days, otherwise "1Y". */
export function getDefaultTimeframe(data: EquityCurvePoint[]): string {
  if (data.length < 2) return "1Y"
  const first = data[0].date
  const last = data[data.length - 1].date
  const diffDays =
    (new Date(`${last}T00:00:00Z`).getTime() - new Date(`${first}T00:00:00Z`).getTime()) /
    86400000
  return diffDays > 365 ? "ALL" : "1Y"
}

/**
 * Stride-based downsampling that always preserves the first and last point.
 * Applied automatically when the series exceeds maxPoints (default 500).
 */
export function downsampleEquityCurve(
  data: EquityCurvePoint[],
  maxPoints = 500,
): EquityCurvePoint[] {
  if (data.length <= maxPoints) return data
  const stride = Math.ceil(data.length / maxPoints)
  const result: EquityCurvePoint[] = []
  for (let i = 0; i < data.length; i++) {
    if (i === 0 || i === data.length - 1 || i % stride === 0) {
      result.push(data[i])
    }
  }
  return result
}

export function sliceEquityCurveByTimeframe(
  data: EquityCurvePoint[],
  timeframe: string,
): EquityCurvePoint[] {
  if (timeframe === "ALL" || data.length === 0) return data

  const tf = dashboardTimeframes.find((t) => t.label === timeframe)
  if (!tf || tf.days == null) return data

  const last = data[data.length - 1]?.date
  if (!last) return []

  const cutoff = new Date(`${last}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - tf.days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  return data.filter((p) => p.date >= cutoffStr)
}

function isValidEquityValue(x: number): boolean {
  return Number.isFinite(x) && x > 0
}

/**
 * Explicit inner join on date after splitting portfolio/benchmark series.
 * This guards KPI math against malformed rows (missing/invalid values) and
 * ensures portfolio + SPY use the exact same date set.
 */
export function alignEquityCurveByDate(data: EquityCurvePoint[]): EquityCurvePoint[] {
  const portfolioByDate = new Map<string, number>()
  const benchmarkByDate = new Map<string, number>()
  const orderedDates: string[] = []
  const seen = new Set<string>()

  for (const row of data) {
    if (!seen.has(row.date)) {
      orderedDates.push(row.date)
      seen.add(row.date)
    }
    if (isValidEquityValue(row.portfolio)) {
      portfolioByDate.set(row.date, row.portfolio)
    }
    if (isValidEquityValue(row.benchmark)) {
      benchmarkByDate.set(row.date, row.benchmark)
    }
  }

  const aligned: EquityCurvePoint[] = []
  for (const date of orderedDates) {
    const portfolio = portfolioByDate.get(date)
    const benchmark = benchmarkByDate.get(date)
    if (portfolio == null || benchmark == null) continue
    aligned.push({ date, portfolio, benchmark })
  }
  return aligned
}

export function getAlignedTimeframeEquityCurve(
  data: EquityCurvePoint[],
  timeframe: string,
): EquityCurvePoint[] {
  return alignEquityCurveByDate(sliceEquityCurveByTimeframe(data, timeframe))
}
