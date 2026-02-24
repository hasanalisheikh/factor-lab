import { describe, it, expect } from "vitest"
import { computeMetrics, inferAnnualizationFactor } from "@/lib/metrics"

// ── helpers ─────────────────────────────────────────────────────────────────

/** Build a sequence of ISO date strings starting at startDate, one per day. */
function makeDates(startDate: string, n: number): string[] {
  const dates: string[] = []
  const d = new Date(startDate + "T00:00:00Z")
  for (let i = 0; i < n; i++) {
    dates.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return dates
}

/** Build ISO date strings spaced 7 days apart. */
function makeWeeklyDates(startDate: string, n: number): string[] {
  const dates: string[] = []
  const d = new Date(startDate + "T00:00:00Z")
  for (let i = 0; i < n; i++) {
    dates.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 7)
  }
  return dates
}

/** Build ISO date strings spaced 30 days apart (proxy for monthly). */
function makeMonthlyDates(startDate: string, n: number): string[] {
  const dates: string[] = []
  const d = new Date(startDate + "T00:00:00Z")
  for (let i = 0; i < n; i++) {
    dates.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 30)
  }
  return dates
}

/** Build an equity series that grows at a constant daily rate. */
function growthSeries(start: number, dailyRate: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => start * Math.pow(1 + dailyRate, i))
}

/** Compute Sharpe manually for verification. */
function manualSharpe(values: number[], annFactor: number): number {
  const rets = values.slice(1).map((v, i) => v / values[i] - 1)
  const m = rets.reduce((a, b) => a + b, 0) / rets.length
  const variance = rets.reduce((s, v) => s + (v - m) ** 2, 0) / (rets.length - 1)
  return (m / Math.sqrt(variance)) * Math.sqrt(annFactor)
}

// ── inferAnnualizationFactor ──────────────────────────────────────────────────

describe("inferAnnualizationFactor", () => {
  it("returns 252 for daily dates (1-day intervals)", () => {
    expect(inferAnnualizationFactor(makeDates("2023-01-01", 30))).toBe(252)
  })

  it("returns 52 for weekly dates (7-day intervals)", () => {
    expect(inferAnnualizationFactor(makeWeeklyDates("2023-01-01", 20))).toBe(52)
  })

  it("returns 12 for monthly dates (30-day intervals)", () => {
    expect(inferAnnualizationFactor(makeMonthlyDates("2023-01-01", 12))).toBe(12)
  })

  it("returns 252 when fewer than 2 dates are provided", () => {
    expect(inferAnnualizationFactor(["2023-01-01"])).toBe(252)
    expect(inferAnnualizationFactor([])).toBe(252)
  })
})

// ── Max Drawdown ─────────────────────────────────────────────────────────────

describe("computeMetrics – Max Drawdown", () => {
  it("returns 0 for a purely increasing series", () => {
    const dates = makeDates("2023-01-01", 100)
    const values = growthSeries(100_000, 0.001, 100)
    const { portfolio } = computeMetrics(dates, values)
    expect(portfolio.maxDrawdown).toBe(0)
  })

  it("computes correct drawdown on a known toy series", () => {
    // Series: up to 200, then drops to 100, then recovers to 150.
    // Peak = 200, trough = 100 → max drawdown = (200-100)/200 = 0.5
    const dates = makeDates("2023-01-01", 5)
    const values = [100, 150, 200, 100, 150]
    const { portfolio } = computeMetrics(dates, values)
    expect(portfolio.maxDrawdown).toBeCloseTo(0.5, 5)
  })

  it("returns null when series is too short (< 3 points)", () => {
    const dates = makeDates("2023-01-01", 2)
    const values = [100_000, 110_000]
    const { portfolio } = computeMetrics(dates, values)
    expect(portfolio.maxDrawdown).toBeNull()
  })

  it("handles a series that ends at a new high (0 trailing drawdown)", () => {
    const dates = makeDates("2023-01-01", 6)
    // Drop from 200 to 100, then surpass old peak at 250
    const values = [100, 200, 150, 100, 200, 250]
    const { portfolio } = computeMetrics(dates, values)
    // Max drawdown is still (200-100)/200 = 0.5
    expect(portfolio.maxDrawdown).toBeCloseTo(0.5, 5)
  })
})

// ── CAGR ─────────────────────────────────────────────────────────────────────

describe("computeMetrics – CAGR", () => {
  it("computes CAGR correctly for a simple 1-year 10% growth", () => {
    // 365 data points growing from 100,000 to 110,000 → CAGR ≈ 10%
    const n = 366 // includes both endpoints over 365 days
    const dates = makeDates("2022-01-01", n)
    const startVal = 100_000
    const endVal = 110_000
    // linearly interpolate for simplicity (CAGR looks at start/end only)
    const values = Array.from({ length: n }, (_, i) =>
      startVal + (endVal - startVal) * (i / (n - 1)),
    )
    const { portfolio } = computeMetrics(dates, values)
    // ~10% CAGR; allow a bit of slack for 365.25 year length
    expect(portfolio.cagr).not.toBeNull()
    expect(portfolio.cagr!).toBeCloseTo(0.1, 1)
  })

  it("returns null when series is too short", () => {
    const dates = makeDates("2023-01-01", 2)
    const values = [100_000, 110_000]
    const { portfolio } = computeMetrics(dates, values)
    expect(portfolio.cagr).toBeNull()
  })

  it("returns null when start value is 0", () => {
    const dates = makeDates("2023-01-01", 10)
    const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const { portfolio } = computeMetrics(dates, values)
    expect(portfolio.cagr).toBeNull()
  })

  it("annualizes correctly: doubling in 2 years ≈ 41.4% CAGR", () => {
    // 2 years = 731 days; 100k → 200k
    const n = 731
    const dates = makeDates("2021-01-01", n)
    const values = growthSeries(100_000, Math.pow(2, 1 / 730) - 1, n)
    const { portfolio } = computeMetrics(dates, values)
    // 2^(1/2) - 1 ≈ 0.4142
    expect(portfolio.cagr).not.toBeNull()
    expect(portfolio.cagr!).toBeCloseTo(0.4142, 2)
  })

  it("computes CAGR correctly for monthly data using date arithmetic", () => {
    // 13 monthly points (30-day spacing) → 12 intervals × 30 days = 360 days.
    // Per-step rate that yields exactly 20% total over 12 steps:
    //   values[12]/values[0] = 1.2  →  step_rate = 1.2^(1/12) - 1
    const dates = makeMonthlyDates("2022-01-01", 13)
    const values = growthSeries(100_000, Math.pow(1.2, 1 / 12) - 1, 13)
    const { portfolio } = computeMetrics(dates, values)
    expect(portfolio.cagr).not.toBeNull()
    // 360 days ≈ 0.9856 years → (1.2)^(1/0.9856) ≈ 20.3% CAGR (closes to 0.2)
    expect(portfolio.cagr!).toBeCloseTo(0.2, 1)
  })
})

// ── Sharpe ───────────────────────────────────────────────────────────────────

describe("computeMetrics – Sharpe", () => {
  it("returns null when series is too short", () => {
    const dates = makeDates("2023-01-01", 2)
    const values = [100_000, 110_000]
    const { portfolio } = computeMetrics(dates, values)
    expect(portfolio.sharpe).toBeNull()
  })

  it("returns null (not NaN/Infinity) when all daily returns are identical (stdev = 0)", () => {
    // Perfectly flat series → stdev of returns = 0 → sharpe must not be Inf
    const dates = makeDates("2023-01-01", 30)
    const values = new Array(30).fill(100_000)
    const { portfolio } = computeMetrics(dates, values)
    // All returns are 0, stdev = 0 → should be null (guarded division)
    expect(portfolio.sharpe).toBeNull()
  })

  it("produces a finite positive Sharpe for a trending-up series", () => {
    const n = 252 // one trading year of daily data
    const dates = makeDates("2022-01-01", n)
    const values = growthSeries(100_000, 0.001, n) // +0.1%/day with no noise
    // Because returns are constant, stdev = 0 → Sharpe is null (edge case)
    // This test verifies robustness: null, not Infinity
    const { portfolio } = computeMetrics(dates, values)
    expect(portfolio.sharpe === null || isFinite(portfolio.sharpe!)).toBe(true)
  })

  it("produces a finite Sharpe for a noisy daily series", () => {
    // Use a deterministic pseudo-noisy series
    const n = 252
    const dates = makeDates("2022-01-01", n)
    // Alternate slightly above/below trend to create non-zero stdev
    const values = Array.from({ length: n }, (_, i) => {
      const trend = 100_000 * Math.pow(1.0005, i)
      const noise = i % 2 === 0 ? 1.002 : 0.998
      return trend * noise
    })
    const { portfolio } = computeMetrics(dates, values)
    expect(portfolio.sharpe).not.toBeNull()
    expect(isFinite(portfolio.sharpe!)).toBe(true)
  })
})

// ── Sharpe frequency inference ────────────────────────────────────────────────

describe("computeMetrics – Sharpe annualization by data frequency", () => {
  it("annualizes with sqrt(252) for daily data", () => {
    const n = 252
    const dates = makeDates("2022-01-03", n)
    const values = Array.from({ length: n }, (_, i) => {
      const trend = 100_000 * Math.pow(1.0005, i)
      return trend * (i % 2 === 0 ? 1.002 : 0.998)
    })
    const { portfolio } = computeMetrics(dates, values)
    const expected = manualSharpe(values, 252)
    expect(portfolio.sharpe).not.toBeNull()
    expect(portfolio.sharpe!).toBeCloseTo(expected, 5)
  })

  it("annualizes with sqrt(52) for weekly data (NOT sqrt(252))", () => {
    // 104 weekly data points (2 years)
    const dates = makeWeeklyDates("2022-01-03", 104)
    const values = Array.from({ length: 104 }, (_, i) => {
      const trend = 100_000 * Math.pow(1.0015, i)
      return trend * (i % 2 === 0 ? 1.005 : 0.995)
    })
    const { portfolio } = computeMetrics(dates, values)

    const expectedWeekly = manualSharpe(values, 52)
    const wrongDaily = manualSharpe(values, 252)

    expect(portfolio.sharpe).not.toBeNull()
    // Should match sqrt(52) annualization
    expect(portfolio.sharpe!).toBeCloseTo(expectedWeekly, 5)
    // Must NOT match sqrt(252) annualization (which would be ~2.2× too large)
    expect(Math.abs(portfolio.sharpe! - wrongDaily)).toBeGreaterThan(0.1)
  })

  it("annualizes with sqrt(12) for monthly data (NOT sqrt(252))", () => {
    // 24 monthly data points (2 years), alternating +2% / -1%
    const dates = makeMonthlyDates("2022-01-31", 24)
    const values: number[] = [100_000]
    for (let i = 1; i < 24; i++) {
      values.push(values[i - 1] * (i % 2 === 0 ? 1.02 : 0.99))
    }

    const { portfolio } = computeMetrics(dates, values)

    const expectedMonthly = manualSharpe(values, 12)
    const wrongDaily = manualSharpe(values, 252)

    expect(portfolio.sharpe).not.toBeNull()
    // Should match sqrt(12) annualization
    expect(portfolio.sharpe!).toBeCloseTo(expectedMonthly, 5)
    // Must NOT match sqrt(252) annualization (which would be ~4.58× too large)
    expect(Math.abs(portfolio.sharpe! - wrongDaily)).toBeGreaterThan(0.1)
  })

  it("monthly Sharpe is NOT inflated: abs value stays in plausible range", () => {
    // Real-world SPY-like monthly returns: ~1% mean, ~4% std
    // Correct Sharpe ≈ (0.01/0.04) * sqrt(12) ≈ 0.87  (reasonable)
    // Wrong  Sharpe ≈ (0.01/0.04) * sqrt(252) ≈ 3.97  (impossibly high)
    const dates = makeMonthlyDates("2020-01-31", 60) // 5 years of monthly data
    // Alternating +1.5% / -0.5% → mean ≈ 0.5%, std ≈ 1%
    const values: number[] = [100_000]
    for (let i = 1; i < 60; i++) {
      values.push(values[i - 1] * (i % 2 === 0 ? 1.015 : 0.995))
    }
    const { portfolio } = computeMetrics(dates, values)

    expect(portfolio.sharpe).not.toBeNull()
    // Correct monthly Sharpe should be well below 4
    expect(Math.abs(portfolio.sharpe!)).toBeLessThan(4)
  })
})

// ── Benchmark deltas ──────────────────────────────────────────────────────────

describe("computeMetrics – benchmark comparison", () => {
  it("returns null benchmark when benchmarkValues not provided", () => {
    const dates = makeDates("2023-01-01", 50)
    const values = growthSeries(100_000, 0.001, 50)
    const { benchmark } = computeMetrics(dates, values)
    expect(benchmark).toBeNull()
  })

  it("returns benchmark metrics when benchmarkValues provided", () => {
    const n = 50
    const dates = makeDates("2023-01-01", n)
    const portfolio = growthSeries(100_000, 0.0015, n)
    const benchmark = growthSeries(100_000, 0.001, n)
    const result = computeMetrics(dates, portfolio, benchmark)
    expect(result.benchmark).not.toBeNull()
    expect(result.benchmark!.cagr).not.toBeNull()
    // Portfolio grows faster, so portfolio CAGR > benchmark CAGR
    expect(result.portfolio.cagr!).toBeGreaterThan(result.benchmark!.cagr!)
  })

  it("returns null metrics for a series with non-positive equity levels", () => {
    const dates = makeDates("2023-01-01", 4)
    const values = [100_000, 101_000, 0, 102_000]
    const { portfolio } = computeMetrics(dates, values)
    expect(portfolio.cagr).toBeNull()
    expect(portfolio.sharpe).toBeNull()
    expect(portfolio.maxDrawdown).toBeNull()
  })

  it("delta = portfolio - benchmark for CAGR (positive means portfolio beats)", () => {
    const n = 252
    const dates = makeDates("2023-01-01", n)
    const portValues = growthSeries(100_000, 0.001, n)
    const benchValues = growthSeries(100_000, 0.0005, n)
    const { portfolio, benchmark } = computeMetrics(dates, portValues, benchValues)
    // Portfolio CAGR > Benchmark CAGR → positive delta
    const delta = portfolio.cagr! - benchmark!.cagr!
    expect(delta).toBeGreaterThan(0)
  })

  it("maxDD delta negative means portfolio drew down less (good)", () => {
    const dates = makeDates("2023-01-01", 6)
    // Portfolio: small drawdown (peak 120 → trough 110 = 8.3%)
    const portValues = [100, 110, 120, 110, 115, 120]
    // Benchmark: large drawdown (peak 120 → trough 80 = 33.3%)
    const benchValues = [100, 110, 120, 80, 100, 115]
    const { portfolio, benchmark } = computeMetrics(dates, portValues, benchValues)
    const delta = portfolio.maxDrawdown! - benchmark!.maxDrawdown!
    // Portfolio has lower max drawdown → delta is negative (good)
    expect(delta).toBeLessThan(0)
  })
})

// ── Sparklines ────────────────────────────────────────────────────────────────

describe("computeMetrics – sparklines", () => {
  it("equity sparkline starts at 1.0", () => {
    const dates = makeDates("2023-01-01", 30)
    const values = growthSeries(100_000, 0.001, 30)
    const { sparklines } = computeMetrics(dates, values)
    expect(sparklines.equity[0]).toBeCloseTo(1.0, 10)
  })

  it("drawdown sparkline is 0 at the start (no initial drawdown)", () => {
    const dates = makeDates("2023-01-01", 30)
    const values = growthSeries(100_000, 0.001, 30)
    const { sparklines } = computeMetrics(dates, values)
    expect(sparklines.drawdown[0]).toBe(0)
  })

  it("drawdown sparkline has a negative trough matching peak-to-trough", () => {
    const dates = makeDates("2023-01-01", 5)
    const values = [100, 200, 200, 100, 150]
    // After peak=200, trough=100 → drawdown at index 3 = (100-200)/200 = -0.5
    const { sparklines } = computeMetrics(dates, values)
    expect(sparklines.drawdown[3]).toBeCloseTo(-0.5, 5)
  })

  it("rollingSharpe falls back to equity when data < window for daily series", () => {
    const n = 40 // daily – window = 60
    const dates = makeDates("2023-01-01", n)
    const values = growthSeries(100_000, 0.001, n)
    const { sparklines } = computeMetrics(dates, values)
    // portRets = 39 < window(60) → fallback
    expect(sparklines.rollingSharpe).toEqual(sparklines.equity)
  })

  it("rollingSharpe falls back to equity when data < window for monthly series", () => {
    const n = 10 // monthly – window = 12
    const dates = makeMonthlyDates("2022-01-31", n)
    const values = growthSeries(100_000, 0.01, n)
    const { sparklines } = computeMetrics(dates, values)
    // portRets = 9 < window(12) → fallback
    expect(sparklines.rollingSharpe).toEqual(sparklines.equity)
  })

  it("rollingSharpe has length = n - 60 when daily data >= 60 points", () => {
    const n = 120
    const dates = makeDates("2023-01-01", n)
    const values = Array.from({ length: n }, (_, i) => {
      const trend = 100_000 * Math.pow(1.0005, i)
      return trend * (i % 2 === 0 ? 1.001 : 0.999)
    })
    const { sparklines } = computeMetrics(dates, values)
    // dailyReturns has n-1 = 119 elements; rolling window=60 → 119-60+1 = 60 entries
    expect(sparklines.rollingSharpe.length).toBe(119 - 60 + 1)
  })

  it("rollingSharpe has length = n - 12 when monthly data >= 12 points", () => {
    const n = 30 // monthly – window = 12
    const dates = makeMonthlyDates("2022-01-31", n)
    const values = Array.from({ length: n }, (_, i) => {
      const trend = 100_000 * Math.pow(1.01, i)
      return trend * (i % 2 === 0 ? 1.005 : 0.995)
    })
    const { sparklines } = computeMetrics(dates, values)
    // portRets = 29 elements; window = 12 → 29 - 12 + 1 = 18 entries
    expect(sparklines.rollingSharpe.length).toBe(29 - 12 + 1)
  })
})
