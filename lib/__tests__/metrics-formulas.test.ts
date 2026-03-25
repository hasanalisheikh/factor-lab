/**
 * Deterministic formula tests for FactorLab metric calculations.
 *
 * These tests verify the EXACT formulas used by lib/metrics.ts with fixed
 * synthetic inputs and manually pre-computed expected outputs. Tolerances
 * are tight (≤6 decimal places) unless annotated otherwise.
 *
 * Convention reference (cross-check with Python engine in worker.py):
 *
 *   CAGR
 *     Formula:   (endValue / startValue) ^ (1 / years) − 1
 *     Years:     calendar_days / 365.25   ← NOT 252 trading days
 *     Note:      Python engine uses equity[-1]^(252/n) − 1 (trading-day basis).
 *                The two formulas differ by ≈0.2–0.5% on 5-year runs.
 *
 *   Max Drawdown
 *     TypeScript: POSITIVE fraction, e.g. 0.25 means 25% peak-to-trough decline.
 *     DB storage: NEGATIVE fraction (−0.25) — written by Python engine.
 *     Report HTML: Math.abs(metrics.max_drawdown) → always displayed positive.
 *     Formula:    max over all t of (running_peak_t − value_t) / running_peak_t
 *
 *   Sharpe
 *     Formula:   (mean(rets) / std(rets)) × √annFactor
 *     StdDev:    sample (ddof=1, denominator n−1)  ← NOT population (ddof=0)
 *     AnnFactor: inferred from data frequency — 252 daily, 52 weekly, 12 monthly
 *     Note:      Python engine uses population std (ddof=0); given n returns, values
 *                differ by factor √(n/(n−1)).
 *
 *   Volatility
 *     Formula:   std(rets, ddof=1) × √annFactor
 *     Same frequency inference as Sharpe.
 *
 *   Calmar / Win Rate / Profit Factor / Turnover
 *     Computed ONLY by the Python engine (_compute_metrics in worker.py).
 *     See services/engine/factorlab_engine/test_metrics_formulas.py for tests.
 */

import { describe, it, expect } from "vitest";
import { computeMetrics } from "@/lib/metrics";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build consecutive daily ISO date strings starting from startDate. */
function makeDates(startDate: string, n: number): string[] {
  const dates: string[] = [];
  const d = new Date(startDate + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

/** Calendar days between two ISO date strings (UTC, no DST). */
function calDays(start: string, end: string): number {
  return (
    (new Date(end + "T00:00:00Z").getTime() - new Date(start + "T00:00:00Z").getTime()) / 86_400_000
  );
}

// ── CAGR ─────────────────────────────────────────────────────────────────────

describe("CAGR: (end/start)^(1/years) − 1, years = calendarDays / 365.25", () => {
  /**
   * Case A — approximately 10% CAGR.
   *
   * 2022-01-01 → 2023-01-01 = 365 calendar days (2022 is not a leap year).
   * years = 365 / 365.25 = 0.99932…
   * CAGR = (110/100)^(1/0.99932) − 1 ≈ 10.007%  →  passes toBeCloseTo(0.1, 2)
   */
  it("Case A: start=100, end=110, 365 days → CAGR ≈ 10%", () => {
    // 3 values minimum required; CAGR only uses first and last.
    const dates = ["2022-01-01", "2022-07-02", "2023-01-01"];
    const values = [100, 105, 110];
    const { portfolio } = computeMetrics(dates, values);

    const years = calDays("2022-01-01", "2023-01-01") / 365.25;
    const expected = Math.pow(110 / 100, 1 / years) - 1;

    expect(portfolio.cagr).not.toBeNull();
    expect(portfolio.cagr!).toBeCloseTo(expected, 6); // exact formula match
    expect(portfolio.cagr!).toBeCloseTo(0.1, 2); // within 0.5pp of 10%
  });

  /**
   * Case B — flat series (start === end).
   * (1.0) ^ anything − 1 = 0 exactly regardless of years.
   */
  it("Case B: flat series start=end=100, any duration → CAGR = 0 exactly", () => {
    const dates = ["2022-01-01", "2022-07-02", "2023-01-01"];
    const values = [100, 100, 100];
    const { portfolio } = computeMetrics(dates, values);
    expect(portfolio.cagr).not.toBeNull();
    expect(portfolio.cagr!).toBe(0);
  });

  /**
   * Case C — negative CAGR, approximately −10%.
   *
   * start=100, end=90, 365 days. years = 365/365.25 ≈ 0.99932.
   * CAGR = (90/100)^(1/0.99932) − 1 ≈ −10.003%  →  passes toBeCloseTo(-0.1, 2)
   */
  it("Case C: start=100, end=90, 365 days → CAGR ≈ −10%", () => {
    const dates = ["2022-01-01", "2022-07-02", "2023-01-01"];
    const values = [100, 95, 90];
    const { portfolio } = computeMetrics(dates, values);

    const years = calDays("2022-01-01", "2023-01-01") / 365.25;
    const expected = Math.pow(90 / 100, 1 / years) - 1;

    expect(portfolio.cagr).not.toBeNull();
    expect(portfolio.cagr!).toBeCloseTo(expected, 6);
    expect(portfolio.cagr!).toBeCloseTo(-0.1, 2); // within 0.5pp of −10%
  });

  /**
   * Annualization test: same start/end NAV (100→110) but over 2× the time.
   * ~1 year: CAGR ≈ 10%.  ~2 years: CAGR ≈ √1.1 − 1 ≈ 4.88%.
   * Confirms the formula is actually annualizing, not just returning total return.
   */
  it("Annualization: same end NAV over 2× time span → ~half the CAGR", () => {
    const dates1y = ["2022-01-01", "2022-07-02", "2023-01-01"]; // ~1 year
    const dates2y = ["2022-01-01", "2023-01-01", "2024-01-01"]; // ~2 years
    const values = [100, 105, 110];

    const { portfolio: port1y } = computeMetrics(dates1y, values);
    const { portfolio: port2y } = computeMetrics(dates2y, values);

    // 2-year CAGR must be substantially less than 1-year CAGR for same end NAV
    expect(port2y.cagr!).toBeLessThan(port1y.cagr!);

    // 2-year CAGR ≈ √(1 + totalReturn) − 1 = √1.1 − 1 ≈ 4.88%
    const years2 = calDays("2022-01-01", "2024-01-01") / 365.25;
    const expected2y = Math.pow(1.1, 1 / years2) - 1;
    expect(port2y.cagr!).toBeCloseTo(expected2y, 4);
  });

  /**
   * Calendar-day vs trading-day annualization.
   *
   * Over 365 calendar days, years = 365/365.25 ≈ 0.9993, so the calendar-day
   * CAGR for 10% total growth is ≈ 10.007%.
   *
   * If the code wrongly used 252 trading days per year (years = 365/252 ≈ 1.448),
   * the CAGR would be (1.1)^(252/365) ≈ 6.6% — substantially lower.
   * Assert the answer is NOT near 6.6% to confirm calendar arithmetic is used.
   */
  it("Uses calendar days / 365.25 — not 252 trading days", () => {
    const dates = ["2022-01-01", "2022-07-02", "2023-01-01"];
    const values = [100, 105, 110];
    const { portfolio } = computeMetrics(dates, values);

    // Incorrect answer that would result from using 252 trading days as year length
    const wrongAnswer = Math.pow(1.1, 252 / 365) - 1; // ≈ 0.066

    // Correct answer (~0.1) must be substantially above the wrong answer (~0.066)
    expect(portfolio.cagr!).toBeGreaterThan(wrongAnswer + 0.02);
  });

  it("Returns null when start value is 0", () => {
    const dates = ["2022-01-01", "2022-07-02", "2023-01-01"];
    const values = [0, 5, 10];
    const { portfolio } = computeMetrics(dates, values);
    expect(portfolio.cagr).toBeNull();
  });

  it("Returns null for series shorter than 3 points", () => {
    const { portfolio } = computeMetrics(["2022-01-01", "2023-01-01"], [100, 110]);
    expect(portfolio.cagr).toBeNull();
  });
});

// ── Max Drawdown ──────────────────────────────────────────────────────────────

describe("Max Drawdown: max((peak − v) / peak), returned as positive fraction", () => {
  /**
   * The task-requested test case: [100, 120, 90, 95, 130].
   *
   * Peak sequence:     [100, 120, 120, 120, 130]
   * Drawdown at each:  [0,   0,   0.25, 0.2083…, 0]
   *   where 0.25 = (120 − 90) / 120 = 30 / 120
   * Max drawdown = 0.25 (25%).
   */
  it("Series [100,120,90,95,130] → maxDD = 0.25 (25% peak-to-trough)", () => {
    const dates = makeDates("2023-01-02", 5);
    const values = [100, 120, 90, 95, 130];
    const { portfolio } = computeMetrics(dates, values);

    expect(portfolio.maxDrawdown).not.toBeNull();
    expect(portfolio.maxDrawdown!).toBeCloseTo(0.25, 6);
  });

  /**
   * Sign convention: TypeScript returns POSITIVE fraction.
   * (DB stores NEGATIVE; report builder applies Math.abs for display.)
   * This test confirms TypeScript never returns a negative value.
   */
  it("Sign convention: maxDrawdown is always ≥ 0 (positive fraction)", () => {
    const dates = makeDates("2023-01-02", 5);
    const values = [100, 90, 80, 70, 60]; // monotonically declining
    const { portfolio } = computeMetrics(dates, values);

    expect(portfolio.maxDrawdown).not.toBeNull();
    expect(portfolio.maxDrawdown!).toBeGreaterThanOrEqual(0);
  });

  /**
   * 50% drop — minimum 3-value series using [100, 50, 60].
   * Peak = 100, trough = 50 → maxDD = (100 − 50) / 100 = 0.5.
   */
  it("Series [100,50,60] → maxDD = 0.5 (peak=100, trough=50)", () => {
    const dates = makeDates("2023-01-02", 3);
    const values = [100, 50, 60];
    const { portfolio } = computeMetrics(dates, values);
    expect(portfolio.maxDrawdown!).toBeCloseTo(0.5, 6);
  });

  /** Purely increasing series never falls from a peak → maxDD = 0. */
  it("Purely increasing [100,110,120,130,140] → maxDD = 0", () => {
    const dates = makeDates("2023-01-02", 5);
    const values = [100, 110, 120, 130, 140];
    const { portfolio } = computeMetrics(dates, values);
    expect(portfolio.maxDrawdown).toBe(0);
  });

  /**
   * Dip-and-full-recovery: [100, 200, 100, 250].
   * The dip to 100 (50% below peak of 200) is captured even though the
   * series ends at a new all-time high.
   * maxDD = (200 − 100) / 200 = 0.5.
   */
  it("Dip-and-recovery [100,200,100,250] → maxDD = 0.5 (captured at trough)", () => {
    const dates = makeDates("2023-01-02", 4);
    const values = [100, 200, 100, 250];
    const { portfolio } = computeMetrics(dates, values);
    expect(portfolio.maxDrawdown!).toBeCloseTo(0.5, 6);
  });

  /**
   * Intermediate peak then larger drawdown from a higher peak.
   * [100, 120, 110, 130, 80]:
   *   Peak seq: [100, 120, 120, 130, 130]
   *   DD seq:   [0,   0,   1/12≈0.083, 0, 50/130≈0.385]
   * maxDD = 50/130 ≈ 0.3846 (not from the first peak of 120).
   */
  it("Largest drawdown comes from later, higher peak [100,120,110,130,80] → maxDD ≈ 0.385", () => {
    const dates = makeDates("2023-01-02", 5);
    const values = [100, 120, 110, 130, 80];
    const { portfolio } = computeMetrics(dates, values);
    const expected = (130 - 80) / 130;
    expect(portfolio.maxDrawdown!).toBeCloseTo(expected, 6); // 50/130
  });

  /**
   * Drawdown sparkline uses NEGATIVE fraction convention (opposite of maxDrawdown).
   * At the trough in [100, 200, 200, 100, 150]:
   *   peak at index 3 = 200  →  dd = (100 − 200) / 200 = −0.5
   */
  it("Drawdown sparkline at trough = −0.5 (negative sign for underwater depth)", () => {
    const dates = makeDates("2023-01-02", 5);
    const values = [100, 200, 200, 100, 150];
    const { sparklines } = computeMetrics(dates, values);
    expect(sparklines.drawdown[3]).toBeCloseTo(-0.5, 6);
  });
});

// ── Sharpe ────────────────────────────────────────────────────────────────────

describe("Sharpe: (mean(rets) / std(rets, ddof=1)) × √252 for daily data", () => {
  /**
   * Exact deterministic test.
   *
   * Daily returns: [+2%, −1%, +3%, −2%] (4 returns, 5 equity values).
   * Constructed values (each = previous × (1 + return)):
   *   v = [100, 102, 100.98, 104.0094, 101.929212]
   *
   * Manual computation:
   *   mean = (0.02 − 0.01 + 0.03 − 0.02) / 4 = 0.005
   *   deviations from mean: [0.015, −0.015, 0.025, −0.025]
   *   sum_sq_dev = 2×(0.015² + 0.025²) = 2×(0.000225 + 0.000625) = 0.0017
   *   std(ddof=1) = √(0.0017 / 3) = 0.023804761…
   *   Sharpe = (0.005 / 0.023804761) × √252 ≈ 3.334
   */
  it("Exact: returns [+2%,−1%,+3%,−2%] → Sharpe = (0.005/std(ddof=1)) × √252 ≈ 3.334", () => {
    const dates = makeDates("2023-01-02", 5);
    const values = [100, 102, 100.98, 104.0094, 101.929212];
    const { portfolio } = computeMetrics(dates, values);

    // Pre-compute expected using the same formulation as the source code
    const rets = [0.02, -0.01, 0.03, -0.02];
    const m = rets.reduce((s, r) => s + r, 0) / rets.length; // = 0.005
    const sumSqDev = rets.reduce((s, r) => s + (r - m) ** 2, 0); // = 0.0017
    const std = Math.sqrt(sumSqDev / (rets.length - 1)); // ddof=1
    const expected = (m / std) * Math.sqrt(252);

    expect(portfolio.sharpe).not.toBeNull();
    expect(portfolio.sharpe!).toBeCloseTo(expected, 6); // exact match to 6dp
    expect(portfolio.sharpe!).toBeCloseTo(3.334, 2); // human-readable sanity
  });

  /**
   * Zero-volatility guard: all returns equal → std = 0 → must return null,
   * not Infinity or NaN. (Constant daily gain produces std(ddof=1) = 0.)
   */
  it("Zero-volatility (all returns equal) → Sharpe is null, not Infinity/NaN", () => {
    const n = 10;
    const dates = makeDates("2023-01-02", n);
    const values = new Array(n).fill(100); // all identical → dailyReturns = [0,0,...,0] → std = 0
    const { portfolio } = computeMetrics(dates, values);
    expect(portfolio.sharpe).toBeNull();
  });

  /**
   * Negative Sharpe: series with net negative drift.
   * Repeated pattern −1% / −1% / +0.5% → consistently negative mean return.
   */
  it("Net negative drift → Sharpe < 0", () => {
    const dates = makeDates("2023-01-02", 30);
    const values: number[] = [100];
    // Three-day cycle: down 1%, down 1%, up 0.5% → trend is negative
    const cycle = [0.99, 0.99, 1.005];
    for (let i = 1; i < 30; i++) {
      values.push(values[i - 1] * cycle[(i - 1) % 3]);
    }
    const { portfolio } = computeMetrics(dates, values);
    expect(portfolio.sharpe).not.toBeNull();
    expect(portfolio.sharpe!).toBeLessThan(0);
  });

  /**
   * TypeScript uses SAMPLE stddev (ddof=1), not population (ddof=0).
   *
   * For the 4-return series:
   *   std(ddof=1) = √(0.0017/3) ≈ 0.023805  →  Sharpe ≈ 3.334
   *   std(ddof=0) = √(0.0017/4) ≈ 0.020616  →  Sharpe ≈ 3.850  ← Python convention
   *
   * The Python engine uses ddof=0 (population). Verify TypeScript is closer to
   * 3.334 than 3.850 — the two differ by > 0.3.
   */
  it("Uses sample stddev (ddof=1), NOT population (ddof=0) used by Python engine", () => {
    const dates = makeDates("2023-01-02", 5);
    const values = [100, 102, 100.98, 104.0094, 101.929212];
    const { portfolio } = computeMetrics(dates, values);

    const rets = [0.02, -0.01, 0.03, -0.02];
    const m = rets.reduce((s, r) => s + r, 0) / rets.length;
    const sumSqDev = rets.reduce((s, r) => s + (r - m) ** 2, 0);

    const sharpeSample = (m / Math.sqrt(sumSqDev / (rets.length - 1))) * Math.sqrt(252); // ddof=1
    const sharpePopulation = (m / Math.sqrt(sumSqDev / rets.length)) * Math.sqrt(252); // ddof=0

    // TypeScript must match sample (ddof=1) and NOT match population (ddof=0)
    expect(portfolio.sharpe!).toBeCloseTo(sharpeSample, 4);
    expect(Math.abs(portfolio.sharpe! - sharpePopulation)).toBeGreaterThan(0.3);
  });

  it("Returns null for series shorter than 3 points (insufficient returns)", () => {
    const { portfolio } = computeMetrics(["2023-01-02", "2023-01-03"], [100, 102]);
    expect(portfolio.sharpe).toBeNull();
  });

  it("Returns null when returns array has fewer than 3 elements", () => {
    // 3 values → 2 returns < 3 minimum → null
    const dates = makeDates("2023-01-02", 3);
    const { portfolio } = computeMetrics(dates, [100, 102, 104]);
    expect(portfolio.sharpe).toBeNull();
  });
});

// ── Volatility ────────────────────────────────────────────────────────────────

describe("Volatility: std(rets, ddof=1) × √annFactor (daily → ×√252)", () => {
  /**
   * Exact deterministic test using the same synthetic series as the Sharpe tests.
   *
   * Daily returns: [+2%, −1%, +3%, −2%]
   * std(ddof=1) = √(0.0017/3)
   * annVol = √(0.0017/3) × √252 = √(0.0017 × 84) = √0.1428 ≈ 0.378
   */
  it("Exact: returns [+2%,−1%,+3%,−2%] → annVol = std(ddof=1) × √252 ≈ 0.378", () => {
    const dates = makeDates("2023-01-02", 5);
    const values = [100, 102, 100.98, 104.0094, 101.929212];
    const { portfolio } = computeMetrics(dates, values);

    const rets = [0.02, -0.01, 0.03, -0.02];
    const m = rets.reduce((s, r) => s + r, 0) / rets.length;
    const sumSqDev = rets.reduce((s, r) => s + (r - m) ** 2, 0);
    const std = Math.sqrt(sumSqDev / (rets.length - 1));
    const expected = std * Math.sqrt(252);

    expect(portfolio.annualizedVol).not.toBeNull();
    expect(portfolio.annualizedVol!).toBeCloseTo(expected, 6); // exact formula match
    expect(portfolio.annualizedVol!).toBeCloseTo(0.378, 2); // human sanity
  });

  /**
   * Higher return variance → higher annualized volatility (monotone relationship).
   */
  it("Higher-variance returns → larger annualizedVol", () => {
    const dates = makeDates("2023-01-02", 5);
    const lowVarValues = [100, 100.1, 100.0, 100.3, 100.1]; // tiny swings
    const highVarValues = [100, 105.0, 99.0, 108.0, 100.0]; // large swings
    const { portfolio: low } = computeMetrics(dates, lowVarValues);
    const { portfolio: high } = computeMetrics(dates, highVarValues);
    expect(high.annualizedVol!).toBeGreaterThan(low.annualizedVol!);
  });

  /**
   * Implied annualization factor = (annVol / perPeriodVol)² must equal 252
   * for daily data, confirming the √252 multiplier is applied.
   */
  it("Annualization factor for daily data is √252 (implied factor = 252)", () => {
    const dates = makeDates("2023-01-02", 5);
    const values = [100, 102, 100.98, 104.0094, 101.929212];
    const { portfolio } = computeMetrics(dates, values);

    const rets = [0.02, -0.01, 0.03, -0.02];
    const m = rets.reduce((s, r) => s + r, 0) / rets.length;
    const sumSqDev = rets.reduce((s, r) => s + (r - m) ** 2, 0);
    const perPeriodVol = Math.sqrt(sumSqDev / (rets.length - 1));

    const impliedFactor = (portfolio.annualizedVol! / perPeriodVol) ** 2;
    expect(impliedFactor).toBeCloseTo(252, 0); // within 0.5 of 252
  });

  /**
   * Sharpe and Volatility are computed from the same stddev.
   * Sharpe = (mean / std) × √252 and Vol = std × √252, so:
   *   Sharpe × Vol = mean × 252  →  Sharpe = mean × 252 / Vol
   * Verify this identity holds.
   */
  it("Identity: Sharpe = mean(rets) × 252 / annVol (Sharpe × Vol = annualizedMeanReturn)", () => {
    const dates = makeDates("2023-01-02", 5);
    const values = [100, 102, 100.98, 104.0094, 101.929212];
    const { portfolio } = computeMetrics(dates, values);

    const annualizedMean = 0.005 * 252; // mean(rets) × 252
    const expectedSharpe = annualizedMean / portfolio.annualizedVol!;

    expect(portfolio.sharpe!).toBeCloseTo(expectedSharpe, 4);
  });

  it("Returns null for series shorter than 3 points", () => {
    const { portfolio } = computeMetrics(["2023-01-02", "2023-01-03"], [100, 102]);
    expect(portfolio.annualizedVol).toBeNull();
  });
});

// ── Cross-metric consistency ──────────────────────────────────────────────────

describe("Cross-metric consistency checks", () => {
  /**
   * Consistently positive-trending series:
   *   CAGR > 0, Sharpe > 0 (or null for zero-vol), maxDD ≥ 0 and small.
   */
  it("Up-trending series: CAGR > 0, maxDD small, Sharpe > 0", () => {
    const n = 252;
    const dates = makeDates("2022-01-03", n);
    const values = Array.from({ length: n }, (_, i) => {
      const trend = 100_000 * Math.pow(1.0005, i); // +0.05%/day
      return trend * (i % 2 === 0 ? 1.001 : 0.999); // small alternating noise
    });
    const { portfolio } = computeMetrics(dates, values);

    expect(portfolio.cagr!).toBeGreaterThan(0);
    expect(portfolio.maxDrawdown!).toBeGreaterThanOrEqual(0);
    expect(portfolio.maxDrawdown!).toBeLessThan(0.05); // no deep drawdown on gentle uptrend
    expect(portfolio.sharpe!).toBeGreaterThan(0);
  });

  /**
   * Declining series:
   *   CAGR < 0, Sharpe < 0, maxDD > 0 (must have pulled from a peak).
   */
  it("Down-trending series: CAGR < 0, Sharpe < 0, maxDD > 0", () => {
    const n = 252;
    const dates = makeDates("2022-01-03", n);
    const values = Array.from({ length: n }, (_, i) => {
      const trend = 100_000 * Math.pow(0.9995, i); // −0.05%/day
      return trend * (i % 2 === 0 ? 1.001 : 0.999);
    });
    const { portfolio } = computeMetrics(dates, values);

    expect(portfolio.cagr!).toBeLessThan(0);
    expect(portfolio.sharpe!).toBeLessThan(0);
    expect(portfolio.maxDrawdown!).toBeGreaterThan(0);
  });

  /**
   * Benchmark comparison: the portfolio with higher daily growth must have
   * strictly higher CAGR and strictly higher Sharpe than the slower benchmark.
   */
  it("Faster-growing portfolio has higher CAGR and Sharpe than benchmark", () => {
    const n = 252;
    const dates = makeDates("2023-01-02", n);
    const portValues = Array.from({ length: n }, (_, i) => {
      const trend = 100_000 * Math.pow(1.0008, i);
      return trend * (i % 2 === 0 ? 1.001 : 0.999);
    });
    const benchValues = Array.from({ length: n }, (_, i) => {
      const trend = 100_000 * Math.pow(1.0004, i);
      return trend * (i % 2 === 0 ? 1.001 : 0.999);
    });
    const { portfolio, benchmark } = computeMetrics(dates, portValues, benchValues);

    expect(portfolio.cagr!).toBeGreaterThan(benchmark!.cagr!);
    expect(portfolio.sharpe!).toBeGreaterThan(benchmark!.sharpe!);
  });
});
