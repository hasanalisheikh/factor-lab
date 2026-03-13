import { describe, expect, it } from "vitest"

import {
  assessDataHealth,
  calendarGapToTradingDays,
  summarizeInceptionAwareCoverage,
} from "@/lib/data-health"

describe("summarizeInceptionAwareCoverage", () => {
  it("aggregates completeness across all ticker ranges", () => {
    const summary = summarizeInceptionAwareCoverage({
      globalStart: "2026-01-05",
      globalEnd: "2026-01-09",
      ranges: [
        {
          ticker: "AAA",
          firstDate: "2026-01-05",
          lastDate: "2026-01-09",
          actualDays: 5,
        },
        {
          ticker: "BBB",
          firstDate: "2026-01-05",
          lastDate: "2026-01-09",
          actualDays: 4,
        },
      ],
    })

    expect(summary.totalExpected).toBe(10)
    expect(summary.totalActual).toBe(9)
    expect(summary.totalTrueMissing).toBe(1)
    expect(summary.trueMissingRate).toBeCloseTo(0.1)
    expect(summary.completeness).toBeCloseTo(90)
  })
})

describe("calendarGapToTradingDays", () => {
  it("maps the stored calendar-day gap scale onto trading-day thresholds", () => {
    expect(calendarGapToTradingDays(0)).toBe(0)
    expect(calendarGapToTradingDays(7)).toBe(5)
    expect(calendarGapToTradingDays(28)).toBe(20)
  })
})

describe("assessDataHealth", () => {
  it("returns GOOD when all good thresholds pass", () => {
    const assessment = assessDataHealth({
      completeness: 99.6,
      requiredNotIngested: 0,
      trueMissingRate: 0.004,
      maxGapDays: 2,
      benchmarkTicker: "SPY",
      benchmarkTrueMissingRate: 0.002,
      benchmarkMaxGapDays: 1,
    })

    expect(assessment.status).toBe("GOOD")
    expect(assessment.reason).toContain("benchmark SPY")
  })

  it("returns WARNING for a completeness-aligned overall missing rate", () => {
    const assessment = assessDataHealth({
      completeness: 96.4,
      requiredNotIngested: 0,
      trueMissingRate: 0.036,
      maxGapDays: 3,
      benchmarkTicker: "SPY",
      benchmarkTrueMissingRate: 0.004,
      benchmarkMaxGapDays: 2,
    })

    expect(assessment.status).toBe("WARNING")
    expect(assessment.reason).toBe(
      "Reason: overall true missing rate is 3.6% (good threshold 1.5%)."
    )
  })

  it("returns DEGRADED when the selected benchmark breaches the gap threshold", () => {
    const assessment = assessDataHealth({
      completeness: 99.4,
      requiredNotIngested: 0,
      trueMissingRate: 0.006,
      maxGapDays: 3,
      benchmarkTicker: "SPY",
      benchmarkTrueMissingRate: 0.004,
      benchmarkMaxGapDays: 12,
    })

    expect(assessment.status).toBe("DEGRADED")
    expect(assessment.reason).toBe(
      "Reason: benchmark SPY max gap is 12 trading days (degraded above 10)."
    )
  })

  it("returns WARNING when the benchmark missing rate breaches the good threshold", () => {
    const assessment = assessDataHealth({
      completeness: 99.8,
      requiredNotIngested: 0,
      trueMissingRate: 0.002,
      maxGapDays: 1,
      benchmarkTicker: "SPY",
      benchmarkTrueMissingRate: 0.011,
      benchmarkMaxGapDays: 1,
    })

    expect(assessment.status).toBe("WARNING")
    expect(assessment.reason).toBe(
      "Reason: benchmark SPY true missing rate is 1.1% (good threshold 1.0%)."
    )
  })

  it("returns DEGRADED when required universe tickers are not ingested", () => {
    const assessment = assessDataHealth({
      completeness: 98.2,
      requiredNotIngested: 2,
      trueMissingRate: 0.018,
      maxGapDays: 4,
      benchmarkTicker: "SPY",
      benchmarkTrueMissingRate: 0.005,
      benchmarkMaxGapDays: 2,
    })

    expect(assessment.status).toBe("DEGRADED")
    expect(assessment.reason).toBe("Reason: 2 required tickers are not ingested.")
  })
})
