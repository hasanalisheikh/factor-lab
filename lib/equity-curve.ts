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
] as const

export type DashboardTimeframeLabel = (typeof dashboardTimeframes)[number]["label"]

export function sliceEquityCurveByTimeframe(
  data: EquityCurvePoint[],
  timeframe: string,
): EquityCurvePoint[] {
  const tf = dashboardTimeframes.find((t) => t.label === timeframe)
  if (!tf || data.length === 0) return data

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
