export const BENCHMARK_OPTIONS = [
  "SPY",
  "QQQ",
  "IWM",
  "VTI",
  "EFA",
  "EEM",
  "TLT",
  "GLD",
  "VNQ",
] as const

type StrategyId = "equal_weight" | "momentum_12_1" | "ml_ridge" | "ml_lightgbm" | "low_vol" | "trend_filter"

type PositionSnapshot = {
  date: string
  symbol: string
  weight: number
}

export type BenchmarkOverlapState = {
  confirmed: boolean
  possible: boolean
}

export function normalizeBenchmark(value: unknown): string {
  if (typeof value !== "string") return "SPY"
  const normalized = value.trim().toUpperCase()
  return normalized || "SPY"
}

export function getRunBenchmark(run: {
  benchmark?: string | null
  benchmark_ticker?: string | null
}): string {
  return normalizeBenchmark(run.benchmark ?? run.benchmark_ticker ?? "SPY")
}

export function isBenchmarkHeldAtLatestRebalance(
  positions: PositionSnapshot[],
  benchmark: string
): boolean {
  if (positions.length === 0) return false
  const benchmarkSymbol = normalizeBenchmark(benchmark)
  let latestDate = ""
  for (const row of positions) {
    if (row.date > latestDate) latestDate = row.date
  }
  if (!latestDate) return false
  return positions.some(
    (row) =>
      row.date === latestDate &&
      row.symbol.toUpperCase() === benchmarkSymbol &&
      row.weight > 0
  )
}

export function inferPossibleOverlapFromUniverse(params: {
  benchmark: string
  strategyId?: string | null
  universeSymbols?: string[] | null
}): boolean {
  const benchmark = normalizeBenchmark(params.benchmark)
  const universe = new Set((params.universeSymbols ?? []).map((s) => s.toUpperCase()))
  if (!universe.has(benchmark)) return false

  // All six strategies select from the universe (risk-on mode for trend_filter),
  // so if the benchmark ticker is in the universe it may be held.
  const strategyId = params.strategyId as StrategyId | null | undefined
  return (
    strategyId === "equal_weight" ||
    strategyId === "momentum_12_1" ||
    strategyId === "ml_ridge" ||
    strategyId === "ml_lightgbm" ||
    strategyId === "low_vol" ||
    strategyId === "trend_filter"
  )
}

