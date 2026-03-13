import { describe, expect, it } from "vitest"
import {
  buildRunPreflightResult,
  type MissingnessCoverageRow,
  type RunPreflightConstraints,
} from "@/lib/coverage-check"

function makeConstraints(overrides: Partial<RunPreflightConstraints> = {}): RunPreflightConstraints {
  return {
    dataCutoffDate: "2026-03-12",
    universeEarliestStart: "2014-04-03",
    universeValidFrom: "2014-04-03",
    minStartDate: "2014-04-03",
    maxEndDate: "2026-03-12",
    missingTickers: [],
    ...overrides,
  }
}

function makeUniverseRows(
  count: number,
  overrides: Record<number, Partial<MissingnessCoverageRow>> = {}
): MissingnessCoverageRow[] {
  return Array.from({ length: count }, (_, index) => ({
    symbol: `T${index}`,
    isBenchmark: false,
    firstDate: "2014-04-03",
    expectedDays: 100,
    actualDays: 100,
    trueMissingDays: 0,
    trueMissingRate: 0,
    ...overrides[index],
  }))
}

describe("buildRunPreflightResult", () => {
  it("blocks when the start date is before the minimum start date", () => {
    const result = buildRunPreflightResult({
      strategyId: "equal_weight",
      startDate: "2010-01-01",
      endDate: "2026-03-01",
      benchmark: "SPY",
      constraints: makeConstraints(),
      symbolRows: [
        {
          symbol: "SPY",
          isBenchmark: true,
          firstDate: "1993-01-29",
          expectedDays: 100,
          actualDays: 100,
          trueMissingDays: 0,
          trueMissingRate: 0,
        },
      ],
    })

    expect(result.status).toBe("block")
    expect(result.suggested_fixes).toContainEqual({
      kind: "clamp_start_date",
      value: "2014-04-03",
    })
  })

  it("warns for standard strategies when more than 5% of universe tickers exceed 2% true missingness", () => {
    const result = buildRunPreflightResult({
      strategyId: "equal_weight",
      startDate: "2015-01-01",
      endDate: "2026-03-01",
      benchmark: "SPY",
      constraints: makeConstraints(),
      symbolRows: [
        {
          symbol: "SPY",
          isBenchmark: true,
          firstDate: "1993-01-29",
          expectedDays: 100,
          actualDays: 100,
          trueMissingDays: 0,
          trueMissingRate: 0,
        },
        ...makeUniverseRows(20, {
          0: { trueMissingDays: 3, trueMissingRate: 0.03, actualDays: 97 },
          1: { trueMissingDays: 3, trueMissingRate: 0.03, actualDays: 97 },
        }),
      ],
    })

    expect(result.status).toBe("warn")
    expect(result.coverage.universe.status).toBe("warning")
  })

  it("blocks for ranking-sensitive strategies when more than 5% of universe tickers exceed 2% true missingness", () => {
    const result = buildRunPreflightResult({
      strategyId: "momentum_12_1",
      startDate: "2015-01-01",
      endDate: "2026-03-01",
      benchmark: "SPY",
      constraints: makeConstraints(),
      symbolRows: [
        {
          symbol: "SPY",
          isBenchmark: true,
          firstDate: "1993-01-29",
          expectedDays: 100,
          actualDays: 100,
          trueMissingDays: 0,
          trueMissingRate: 0,
        },
        ...makeUniverseRows(20, {
          0: { trueMissingDays: 3, trueMissingRate: 0.03, actualDays: 97 },
          1: { trueMissingDays: 3, trueMissingRate: 0.03, actualDays: 97 },
        }),
      ],
    })

    expect(result.status).toBe("block")
    expect(result.coverage.universe.status).toBe("blocked")
  })

  it("blocks when any ticker exceeds 10% true missingness", () => {
    const result = buildRunPreflightResult({
      strategyId: "equal_weight",
      startDate: "2015-01-01",
      endDate: "2026-03-01",
      benchmark: "SPY",
      constraints: makeConstraints(),
      symbolRows: [
        {
          symbol: "SPY",
          isBenchmark: true,
          firstDate: "1993-01-29",
          expectedDays: 100,
          actualDays: 100,
          trueMissingDays: 0,
          trueMissingRate: 0,
        },
        ...makeUniverseRows(20, {
          0: { trueMissingDays: 12, trueMissingRate: 0.12, actualDays: 88 },
        }),
      ],
    })

    expect(result.status).toBe("block")
    expect(result.coverage.universe.over10Percent).toEqual(["T0"])
  })
})
