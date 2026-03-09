// Central source of truth for universe presets.
// Previously duplicated in app/actions/runs.ts, components/run-form.tsx,
// and components/settings-form.tsx — all now import from here.
// Must stay in sync with UNIVERSE_PRESETS in services/engine/factorlab_engine/worker.py.

export const UNIVERSE_PRESETS = {
  ETF8: ["SPY", "QQQ", "IWM", "EFA", "EEM", "TLT", "GLD", "VNQ"],
  SP100: [
    "AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "META", "NVDA", "BRK.B",
    "JPM", "XOM", "UNH", "JNJ", "PG", "V", "MA", "HD", "COST", "ABBV",
    "PEP", "MRK",
  ],
  NASDAQ100: [
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "GOOG", "AVGO",
    "COST", "TSLA", "NFLX", "AMD", "ADBE", "CSCO", "PEP", "INTC",
    "QCOM", "AMGN", "TXN", "CMCSA",
  ],
} as const satisfies Record<string, readonly string[]>

export type UniverseId = keyof typeof UNIVERSE_PRESETS

export const ALL_UNIVERSES = Object.keys(UNIVERSE_PRESETS) as [UniverseId, ...UniverseId[]]

export const UNIVERSE_SIZES: Record<UniverseId, number> = {
  ETF8: 8,
  SP100: 20,
  NASDAQ100: 20,
}

export const UNIVERSE_LABELS: Record<UniverseId, string> = {
  ETF8: "ETF8 (8 ETFs)",
  SP100: "S&P 100 Subset (20 stocks)",
  NASDAQ100: "NASDAQ 100 Subset (20 stocks)",
}

/** Shape returned by getTickerDateRanges — duplicated here to avoid server-only import */
export type TickerDateRangeLike = {
  ticker: string
  firstDate: string
}

/**
 * Pure function: returns max(firstDate) among tickers in the given universe
 * that appear in the provided ranges array. Returns null if none matched.
 * Lives here (not in queries.ts) so it can be imported by client components and tests.
 */
export function computeUniverseValidFrom(
  universe: UniverseId,
  ranges: TickerDateRangeLike[]
): string | null {
  const tickers = UNIVERSE_PRESETS[universe] as readonly string[]
  const rangeMap = new Map(ranges.map((r) => [r.ticker, r.firstDate]))
  let latest: string | null = null
  for (const t of tickers) {
    const d = rangeMap.get(t)
    if (d && (!latest || d > latest)) latest = d
  }
  return latest
}
