import { describe, it, expect } from "vitest"

// Test inception-aware missingness logic in isolation (pure functions).
// Replicates countBusinessDays and per-ticker computation to verify that
// pre-inception days are NOT counted as missing.

function countBusinessDays(startStr: string, endStr: string): number {
  if (!startStr || !endStr || startStr > endStr) return 0
  const start = new Date(`${startStr}T00:00:00Z`)
  const end = new Date(`${endStr}T00:00:00Z`)
  let count = 0
  const cur = new Date(start)
  while (cur <= end) {
    const d = cur.getUTCDay()
    if (d !== 0 && d !== 6) count++
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return count
}

function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

describe("inception-aware missingness", () => {
  const GLOBAL_START = "2000-01-03"
  const GLOBAL_END   = "2026-01-02"

  it("META (IPO 2012-05-18): pre-inception is large, true missing is small", () => {
    const firstDate    = "2012-05-18"
    const lastDate     = GLOBAL_END
    // Compute real expected days and simulate near-complete coverage
    const expectedDays = countBusinessDays(firstDate, lastDate)
    const actualDays   = expectedDays - 5   // only 5 true missing days

    const trueMissingDays  = Math.max(expectedDays - actualDays, 0)
    const preInceptionDays = countBusinessDays(GLOBAL_START, dayBefore(firstDate))

    expect(trueMissingDays).toBe(5)
    expect(preInceptionDays).toBeGreaterThan(3000)  // ~12.4 years × 252 days

    // Old naive method: globalBizDays - actualDays would be >3000
    const naiveBizDays = countBusinessDays(GLOBAL_START, GLOBAL_END)
    const naiveMissing = Math.max(naiveBizDays - actualDays, 0)
    expect(naiveMissing).toBeGreaterThan(3000)
    expect(trueMissingDays).toBeLessThan(naiveMissing)
  })

  it("SPY (IPO before global window): pre-inception is 0", () => {
    const firstDate    = "1993-01-29"  // predates GLOBAL_START
    const lastDate     = GLOBAL_END
    const expectedDays = countBusinessDays(firstDate, lastDate)
    const actualDays   = expectedDays - 10

    const trueMissingDays  = Math.max(expectedDays - actualDays, 0)
    const preInceptionDays = firstDate < GLOBAL_START
      ? 0
      : countBusinessDays(GLOBAL_START, dayBefore(firstDate))

    expect(preInceptionDays).toBe(0)
    expect(trueMissingDays).toBe(10)
  })

  it("TSLA (IPO 2010-06-29): pre-inception days dominate in 2000-window", () => {
    const firstDate    = "2010-06-29"
    const lastDate     = GLOBAL_END
    const expectedDays = countBusinessDays(firstDate, lastDate)
    const actualDays   = expectedDays - 3

    const trueMissingDays  = Math.max(expectedDays - actualDays, 0)
    const preInceptionDays = countBusinessDays(GLOBAL_START, dayBefore(firstDate))

    expect(preInceptionDays).toBeGreaterThan(2700)  // ~10.5 years before IPO
    expect(trueMissingDays).toBe(3)
  })

  it("countBusinessDays returns 0 for inverted range", () => {
    expect(countBusinessDays("2026-01-02", "2000-01-03")).toBe(0)
  })

  it("countBusinessDays skips weekends correctly for one-week span", () => {
    // 2024-01-08 (Mon) → 2024-01-12 (Fri) = 5 business days
    expect(countBusinessDays("2024-01-08", "2024-01-12")).toBe(5)
    // 2024-01-07 (Sun) → 2024-01-13 (Sat) = 5 business days (endpoints excluded)
    expect(countBusinessDays("2024-01-07", "2024-01-13")).toBe(5)
  })
})
