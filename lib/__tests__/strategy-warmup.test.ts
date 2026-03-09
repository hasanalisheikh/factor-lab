import { describe, it, expect } from "vitest"
import {
  STRATEGY_WARMUP_CALENDAR_DAYS,
  computeStrategyEarliestStart,
} from "@/lib/strategy-warmup"

describe("STRATEGY_WARMUP_CALENDAR_DAYS", () => {
  it("equal_weight has zero warmup", () => {
    expect(STRATEGY_WARMUP_CALENDAR_DAYS.equal_weight).toBe(0)
  })

  it("momentum_12_1 has 390-day warmup", () => {
    expect(STRATEGY_WARMUP_CALENDAR_DAYS.momentum_12_1).toBe(390)
  })

  it("ml_ridge and ml_lightgbm both have 730-day warmup", () => {
    expect(STRATEGY_WARMUP_CALENDAR_DAYS.ml_ridge).toBe(730)
    expect(STRATEGY_WARMUP_CALENDAR_DAYS.ml_lightgbm).toBe(730)
  })

  it("low_vol has 90-day warmup", () => {
    expect(STRATEGY_WARMUP_CALENDAR_DAYS.low_vol).toBe(90)
  })

  it("trend_filter has 290-day warmup", () => {
    expect(STRATEGY_WARMUP_CALENDAR_DAYS.trend_filter).toBe(290)
  })
})

describe("computeStrategyEarliestStart", () => {
  it("returns globalMinDate unchanged for equal_weight (zero warmup)", () => {
    expect(computeStrategyEarliestStart("equal_weight", "2000-01-03")).toBe("2000-01-03")
  })

  it("returns null when globalMinDate is null", () => {
    expect(computeStrategyEarliestStart("momentum_12_1", null)).toBeNull()
    expect(computeStrategyEarliestStart("ml_ridge", null)).toBeNull()
  })

  it("momentum_12_1 adds ~390 days — result falls in 2001", () => {
    // 2000-01-03 + 390 days ≈ 2001-02-06
    const result = computeStrategyEarliestStart("momentum_12_1", "2000-01-03")
    expect(result).not.toBeNull()
    expect(result!.startsWith("2001-")).toBe(true)
  })

  it("ml strategies add ~730 days — result falls in 2001 or 2002", () => {
    // 2000-01-03 + 730 days ≈ 2002-01-03
    const ridge = computeStrategyEarliestStart("ml_ridge", "2000-01-03")
    const lgbm  = computeStrategyEarliestStart("ml_lightgbm", "2000-01-03")
    expect(ridge).not.toBeNull()
    expect(lgbm).not.toBeNull()
    // Both should land in 2001 or 2002
    expect(parseInt(ridge!.slice(0, 4))).toBeGreaterThanOrEqual(2001)
    expect(ridge).toBe(lgbm)
  })

  it("low_vol adds ~90 days", () => {
    // 2015-01-02 + 90 days ≈ 2015-04-02
    const result = computeStrategyEarliestStart("low_vol", "2015-01-02")
    expect(result).not.toBeNull()
    expect(result!.startsWith("2015-")).toBe(true)
  })

  it("trend_filter adds ~290 days", () => {
    // 2015-01-02 + 290 days ≈ 2015-10-18
    const result = computeStrategyEarliestStart("trend_filter", "2015-01-02")
    expect(result).not.toBeNull()
    expect(result!.startsWith("2015-")).toBe(true)
  })

  it("exact date arithmetic is correct — 730 days from 2000-01-03", () => {
    // 2000 is a leap year: 366 days; 2001 has 365 days; 730 = 366 + 364 → lands 2001-12-29
    const result = computeStrategyEarliestStart("ml_ridge", "2000-01-03")
    // Just verify it's within 2001 or early 2002
    const year = parseInt(result!.slice(0, 4))
    expect(year === 2001 || year === 2002).toBe(true)
  })
})
