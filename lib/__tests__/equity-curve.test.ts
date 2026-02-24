import { describe, expect, it } from "vitest"
import {
  alignEquityCurveByDate,
  getAlignedTimeframeEquityCurve,
  type EquityCurvePoint,
} from "@/lib/equity-curve"

describe("alignEquityCurveByDate", () => {
  it("keeps only dates where both portfolio and benchmark are valid positive values", () => {
    const rows: EquityCurvePoint[] = [
      { date: "2025-01-01", portfolio: 100, benchmark: 100 },
      { date: "2025-01-02", portfolio: 101, benchmark: 0 }, // invalid benchmark
      { date: "2025-01-03", portfolio: Number.NaN, benchmark: 101 }, // invalid portfolio
      { date: "2025-01-04", portfolio: 102, benchmark: 102 },
    ]

    expect(alignEquityCurveByDate(rows)).toEqual([
      { date: "2025-01-01", portfolio: 100, benchmark: 100 },
      { date: "2025-01-04", portfolio: 102, benchmark: 102 },
    ])
  })
})

describe("getAlignedTimeframeEquityCurve", () => {
  it("applies timeframe filter before alignment", () => {
    const rows: EquityCurvePoint[] = [
      { date: "2025-01-01", portfolio: 100, benchmark: 100 },
      { date: "2025-12-20", portfolio: 110, benchmark: 110 },
      { date: "2025-12-25", portfolio: 111, benchmark: 0 },
      { date: "2025-12-31", portfolio: 112, benchmark: 112 },
    ]

    // 1W from 2025-12-31 includes 2025-12-24 onward.
    expect(getAlignedTimeframeEquityCurve(rows, "1W")).toEqual([
      { date: "2025-12-31", portfolio: 112, benchmark: 112 },
    ])
  })
})
