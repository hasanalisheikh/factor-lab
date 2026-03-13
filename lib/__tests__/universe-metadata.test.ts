import { describe, it, expect } from "vitest"
import {
  computeUniverseValidFrom,
  summarizeUniverseConstraints,
} from "@/lib/universe-config"
import type { TickerDateRange } from "@/lib/supabase/types"

// ETF8 tickers: SPY, QQQ, IWM, EFA, EEM, TLT, GLD, VNQ
// GLD launched 2004-11-18 — the latest in ETF8

const ETF8_RANGES: TickerDateRange[] = [
  { ticker: "SPY", firstDate: "1993-01-29", lastDate: "2026-01-02", actualDays: 8300 },
  { ticker: "QQQ", firstDate: "1999-03-10", lastDate: "2026-01-02", actualDays: 6700 },
  { ticker: "IWM", firstDate: "2000-05-26", lastDate: "2026-01-02", actualDays: 6400 },
  { ticker: "EFA", firstDate: "2001-08-17", lastDate: "2026-01-02", actualDays: 6100 },
  { ticker: "EEM", firstDate: "2003-04-14", lastDate: "2026-01-02", actualDays: 5800 },
  { ticker: "TLT", firstDate: "2002-07-30", lastDate: "2026-01-02", actualDays: 5900 },
  { ticker: "GLD", firstDate: "2004-11-18", lastDate: "2026-01-02", actualDays: 5400 },
  { ticker: "VNQ", firstDate: "2004-09-29", lastDate: "2026-01-02", actualDays: 5420 },
]

describe("computeUniverseValidFrom", () => {
  it("returns max(firstDate) across all ETF8 tickers", () => {
    const result = computeUniverseValidFrom("ETF8", ETF8_RANGES)
    // GLD (2004-11-18) is the latest-launching ETF8 member
    expect(result).toBe("2004-11-18")
  })

  it("returns null when ranges array is empty", () => {
    const result = computeUniverseValidFrom("ETF8", [])
    expect(result).toBeNull()
  })

  it("returns null when none of the universe tickers appear in ranges", () => {
    const unrelated: TickerDateRange[] = [
      { ticker: "AAPL", firstDate: "1980-12-12", lastDate: "2026-01-02", actualDays: 11000 },
    ]
    // ETF8 tickers are SPY/QQQ/etc. — AAPL is not in ETF8
    const result = computeUniverseValidFrom("ETF8", unrelated)
    expect(result).toBeNull()
  })

  it("handles partial data (subset of universe tickers in ranges)", () => {
    const partial: TickerDateRange[] = [
      { ticker: "SPY", firstDate: "1993-01-29", lastDate: "2026-01-02", actualDays: 8300 },
      { ticker: "GLD", firstDate: "2004-11-18", lastDate: "2026-01-02", actualDays: 5400 },
    ]
    const result = summarizeUniverseConstraints("ETF8", partial)
    expect(result.validFrom).toBeNull()
    expect(result.ready).toBe(false)
    expect(result.missingTickers).toContain("QQQ")
  })

  it("returns correct valid_from for NASDAQ100 (TSLA launched 2010-06-29)", () => {
    const nasdaq100Ranges: TickerDateRange[] = [
      { ticker: "AAPL",  firstDate: "1980-12-12", lastDate: "2026-01-02", actualDays: 11000 },
      { ticker: "MSFT",  firstDate: "1986-03-13", lastDate: "2026-01-02", actualDays: 10200 },
      { ticker: "TSLA",  firstDate: "2010-06-29", lastDate: "2026-01-02", actualDays: 3900 },
      { ticker: "AVGO",  firstDate: "2009-08-06", lastDate: "2026-01-02", actualDays: 4100 },
      // remaining NASDAQ100 tickers omitted — computeUniverseValidFrom only uses what's in ranges
      { ticker: "NVDA",  firstDate: "1999-01-22", lastDate: "2026-01-02", actualDays: 6700 },
      { ticker: "AMZN",  firstDate: "1997-05-16", lastDate: "2026-01-02", actualDays: 7200 },
      { ticker: "META",  firstDate: "2012-05-18", lastDate: "2026-01-02", actualDays: 3500 },
      { ticker: "GOOGL", firstDate: "2004-08-19", lastDate: "2026-01-02", actualDays: 5400 },
      { ticker: "GOOG",  firstDate: "2014-04-03", lastDate: "2026-01-02", actualDays: 3000 },
      { ticker: "COST",  firstDate: "1983-09-13", lastDate: "2026-01-02", actualDays: 10500 },
      { ticker: "NFLX",  firstDate: "2002-05-23", lastDate: "2026-01-02", actualDays: 5900 },
      { ticker: "AMD",   firstDate: "1972-01-07", lastDate: "2026-01-02", actualDays: 13500 },
      { ticker: "ADBE",  firstDate: "1986-08-14", lastDate: "2026-01-02", actualDays: 10100 },
      { ticker: "CSCO",  firstDate: "1990-02-16", lastDate: "2026-01-02", actualDays: 9100 },
      { ticker: "PEP",   firstDate: "1972-06-01", lastDate: "2026-01-02", actualDays: 13500 },
      { ticker: "INTC",  firstDate: "1972-01-07", lastDate: "2026-01-02", actualDays: 13500 },
      { ticker: "QCOM",  firstDate: "1991-12-13", lastDate: "2026-01-02", actualDays: 8600 },
      { ticker: "AMGN",  firstDate: "1983-06-17", lastDate: "2026-01-02", actualDays: 10700 },
      { ticker: "TXN",   firstDate: "1972-01-07", lastDate: "2026-01-02", actualDays: 13500 },
      { ticker: "CMCSA", firstDate: "1972-01-07", lastDate: "2026-01-02", actualDays: 13500 },
    ]
    const result = computeUniverseValidFrom("NASDAQ100", nasdaq100Ranges)
    // TSLA (2010-06-29) launches latest among all NASDAQ100 tickers above... except GOOG (2014-04-03)
    expect(result).toBe("2014-04-03")
  })
})
