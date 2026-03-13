import { afterEach, describe, expect, it } from "vitest"

import {
  buildScheduledRefreshWindow,
  getLastCompleteTradingDayUtc,
  getNextMonthStartUtc,
  isDailyUpdatesEnabled,
  subtractTradingDays,
} from "@/lib/data-cutoff"

describe("getLastCompleteTradingDayUtc", () => {
  it("returns the previous weekday for a mid-week timestamp", () => {
    expect(getLastCompleteTradingDayUtc(new Date("2026-03-12T15:00:00Z"))).toBe("2026-03-11")
  })

  it("rolls back to Friday when called on Monday UTC", () => {
    expect(getLastCompleteTradingDayUtc(new Date("2026-03-16T00:00:00Z"))).toBe("2026-03-13")
  })
})

describe("getNextMonthStartUtc", () => {
  it("returns the first day of the next month in UTC", () => {
    expect(getNextMonthStartUtc(new Date("2026-03-12T08:30:00Z"))).toBe("2026-04-01")
  })
})

describe("subtractTradingDays", () => {
  it("skips weekends", () => {
    expect(subtractTradingDays("2026-03-16", 1)).toBe("2026-03-13")
  })
})

describe("buildScheduledRefreshWindow", () => {
  it("uses the larger monthly repair window when the ticker is current", () => {
    expect(
      buildScheduledRefreshWindow({
        existingLastDate: "2026-03-10",
        inceptionDate: "1993-01-22",
        targetCutoffDate: "2026-03-11",
        requestMode: "monthly",
      })
    ).toEqual({
      startDate: "2026-01-28",
      endDate: "2026-03-11",
    })
  })

  it("extends farther back when the ticker is stale", () => {
    expect(
      buildScheduledRefreshWindow({
        existingLastDate: "2026-01-15",
        inceptionDate: "1993-01-22",
        targetCutoffDate: "2026-03-11",
        requestMode: "monthly",
      })
    ).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-03-11",
    })
  })

  it("keeps daily refreshes tight", () => {
    expect(
      buildScheduledRefreshWindow({
        existingLastDate: "2026-03-10",
        inceptionDate: "1993-01-22",
        targetCutoffDate: "2026-03-11",
        requestMode: "daily",
      })
    ).toEqual({
      startDate: "2026-02-25",
      endDate: "2026-03-11",
    })
  })
})

describe("isDailyUpdatesEnabled", () => {
  const original = process.env.ENABLE_DAILY_UPDATES

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ENABLE_DAILY_UPDATES
    } else {
      process.env.ENABLE_DAILY_UPDATES = original
    }
  })

  it("defaults daily patching to enabled", () => {
    delete process.env.ENABLE_DAILY_UPDATES
    expect(isDailyUpdatesEnabled()).toBe(true)
  })

  it("honours an explicit false override", () => {
    process.env.ENABLE_DAILY_UPDATES = "false"
    expect(isDailyUpdatesEnabled()).toBe(false)
  })
})
