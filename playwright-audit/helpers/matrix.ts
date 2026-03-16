import {
  STRATEGIES,
  UNIVERSES,
  BENCHMARKS,
  CANONICAL_START_DATE,
  CANONICAL_END_DATE,
  CANONICAL_COSTS_BPS,
  CANONICAL_TOP_N,
  CANONICAL_INITIAL_CAPITAL,
  FILTER_STRATEGY,
  FILTER_UNIVERSE,
  FILTER_BENCHMARK,
  type StrategyId,
  type UniverseId,
  type BenchmarkId,
} from "../audit.config"

export type MatrixCombo = {
  /** Unique key for this combination */
  key: string
  strategy: StrategyId
  universe: UniverseId
  benchmark: BenchmarkId
  canonicalStartDate: string
  canonicalEndDate: string
  costsBps: number
  topN: number
  initialCapital: number
  /** Human-readable run name that will be used in the app */
  runName: string
  /** Index in the full 162-run matrix (0-based) */
  index: number
}

export function generateMatrix(): MatrixCombo[] {
  const matrix: MatrixCombo[] = []
  let index = 0

  for (const strategy of STRATEGIES) {
    if (FILTER_STRATEGY && strategy !== FILTER_STRATEGY) continue

    for (const universe of UNIVERSES) {
      if (FILTER_UNIVERSE && universe !== FILTER_UNIVERSE) continue

      for (const benchmark of BENCHMARKS) {
        if (FILTER_BENCHMARK && benchmark !== FILTER_BENCHMARK) continue

        const key = `${strategy}__${universe}__${benchmark}`
        const runName = `AUDIT_${strategy}_${universe}_${benchmark}`

        matrix.push({
          key,
          strategy,
          universe,
          benchmark,
          canonicalStartDate: CANONICAL_START_DATE,
          canonicalEndDate: CANONICAL_END_DATE,
          costsBps: CANONICAL_COSTS_BPS,
          topN: CANONICAL_TOP_N[universe],
          initialCapital: CANONICAL_INITIAL_CAPITAL,
          runName,
          index: index++,
        })
      }
    }
  }

  return matrix
}

/** Full 162-run matrix (or filtered subset) */
export const FULL_MATRIX = generateMatrix()

/** Total planned combinations */
export const PLANNED_COUNT = (() => {
  let n = 0
  for (const _ of STRATEGIES) {
    if (FILTER_STRATEGY && _ !== FILTER_STRATEGY) continue
    for (const __ of UNIVERSES) {
      if (FILTER_UNIVERSE && __ !== FILTER_UNIVERSE) continue
      for (const ___ of BENCHMARKS) {
        if (FILTER_BENCHMARK && ___ !== FILTER_BENCHMARK) continue
        n++
      }
    }
  }
  return n
})()
