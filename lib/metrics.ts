/**
 * Financial metrics computation from equity curve series.
 *
 * All monetary inputs are raw dollar values (e.g. portfolio_value).
 * All output metrics are fractions unless noted:
 *   - cagr: 0.224  (not 22.4)
 *   - maxDrawdown: 0.083  (positive fraction, peak-to-trough)
 *   - annualizedVol: 0.15  (fraction)
 *   - sharpe: dimensionless ratio
 */

export interface SeriesMetrics {
  cagr: number | null
  sharpe: number | null
  /** Positive fraction, e.g. 0.083 means 8.3% peak-to-trough */
  maxDrawdown: number | null
  annualizedVol: number | null
}

export interface ComputedMetrics {
  portfolio: SeriesMetrics
  benchmark: SeriesMetrics | null
  sparklines: {
    /** Normalized equity: portValues[i] / portValues[0], starts at 1.0 */
    equity: number[]
    /** Drawdown series: 0 at peak, negative fraction when underwater */
    drawdown: number[]
    /**
     * Rolling annualized Sharpe from portfolio returns.
     * Window scales with detected data frequency (60 trading days / 13 weeks / 12 months).
     * Falls back to `equity` when fewer than one window of return observations.
     */
    rollingSharpe: number[]
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function hasValidEquityLevels(values: number[]): boolean {
  return values.length >= 2 && values.every((v) => Number.isFinite(v) && v > 0)
}

function dailyReturns(values: number[]): number[] {
  const ret: number[] = []
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]
    const curr = values[i]
    ret.push(curr / prev - 1)
  }
  return ret
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(variance)
}

/**
 * Infer the annualization factor for Sharpe/vol from the average calendar-day
 * interval between consecutive dates in the series.
 *
 *   avg interval   → periods/year  → annualization factor
 *   ≤ 2 days       →  252 (daily)  → √252 ≈ 15.87
 *   3–10 days      →   52 (weekly) → √52  ≈  7.21
 *   11–45 days     →   12 (monthly)→ √12  ≈  3.46
 *   46–100 days    →    4 (quarterly)→ √4 =  2.00
 *   > 100 days     →    1 (annual) → √1  =  1.00
 */
export function inferAnnualizationFactor(dates: string[]): number {
  if (dates.length < 2) return 252
  const totalMs =
    new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()
  const avgDays = totalMs / 86_400_000 / (dates.length - 1)
  if (avgDays <= 2) return 252
  if (avgDays <= 10) return 52
  if (avgDays <= 45) return 12
  if (avgDays <= 100) return 4
  return 1
}

function cagr(
  startValue: number,
  endValue: number,
  startDate: string,
  endDate: string,
): number | null {
  if (startValue <= 0 || endValue <= 0) return null
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime()
  const days = ms / 86_400_000
  if (days < 1) return null
  const years = days / 365.25
  const result = Math.pow(endValue / startValue, 1 / years) - 1
  return isFinite(result) ? result : null
}

function sharpe(rets: number[], annFactor = 252): number | null {
  if (rets.length < 3) return null
  const m = mean(rets)
  const s = stddev(rets)
  if (s === 0 || !isFinite(s)) return null
  const annualized = (m / s) * Math.sqrt(annFactor)
  return isFinite(annualized) ? annualized : null
}

function maxDrawdown(values: number[]): number | null {
  if (values.length < 2) return null
  let peak = values[0]
  let maxDD = 0
  for (const v of values) {
    if (v > peak) peak = v
    if (peak > 0) {
      const dd = (peak - v) / peak
      if (dd > maxDD) maxDD = dd
    }
  }
  return maxDD
}

function drawdownSeries(values: number[]): number[] {
  let peak = values[0] ?? 0
  return values.map((v) => {
    if (v > peak) peak = v
    return peak > 0 ? (v - peak) / peak : 0
  })
}

function rollingSharpe(rets: number[], window = 60, annFactor = 252): number[] {
  const result: number[] = []
  for (let i = window; i <= rets.length; i++) {
    const s = sharpe(rets.slice(i - window, i), annFactor)
    result.push(s ?? 0)
  }
  return result
}

function seriesMetrics(
  dates: string[],
  values: number[],
  annFactor: number,
): SeriesMetrics {
  if (values.length < 3 || !hasValidEquityLevels(values)) {
    return { cagr: null, sharpe: null, maxDrawdown: null, annualizedVol: null }
  }
  const rets = dailyReturns(values)
  const c = cagr(values[0], values[values.length - 1], dates[0], dates[dates.length - 1])
  const sh = sharpe(rets, annFactor)
  const md = maxDrawdown(values)
  const vol = rets.length >= 2 ? stddev(rets) * Math.sqrt(annFactor) : null
  return {
    cagr: c,
    sharpe: sh,
    maxDrawdown: md,
    annualizedVol: vol !== null && isFinite(vol) ? vol : null,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute all dashboard metrics and sparkline series from a sliced equity curve.
 *
 * @param dates           Ascending date strings, same length as portfolioValues.
 * @param portfolioValues Dollar values of the portfolio (e.g. 100000, 102400, …).
 * @param benchmarkValues Dollar values of the benchmark (optional, same length).
 */
export function computeMetrics(
  dates: string[],
  portfolioValues: number[],
  benchmarkValues?: number[],
): ComputedMetrics {
  // Detect data frequency once; apply consistently to both series and sparklines.
  const annFactor = inferAnnualizationFactor(dates)

  const portfolio = seriesMetrics(dates, portfolioValues, annFactor)

  const benchmark =
    benchmarkValues && benchmarkValues.length >= 3
      ? seriesMetrics(dates, benchmarkValues, annFactor)
      : null

  // Sparklines
  const startVal =
    portfolioValues.length > 0 && Number.isFinite(portfolioValues[0]) && portfolioValues[0] !== 0
      ? portfolioValues[0]
      : 1
  const equity =
    portfolioValues.length >= 1 ? portfolioValues.map((v) => v / startVal) : []

  const drawdown =
    portfolioValues.length >= 2 ? drawdownSeries(portfolioValues) : []

  const portRets = dailyReturns(portfolioValues)
  // Rolling window scales with frequency so it always covers ~3 months of data.
  const rsWindow = annFactor === 252 ? 60 : annFactor === 52 ? 13 : 12
  const rs = portRets.length >= rsWindow ? rollingSharpe(portRets, rsWindow, annFactor) : equity

  return {
    portfolio,
    benchmark,
    sparklines: { equity, drawdown, rollingSharpe: rs },
  }
}
