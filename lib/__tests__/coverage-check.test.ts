import { describe, expect, it } from "vitest";
import {
  buildRunPreflightResult,
  computeBenchmarkCoverage,
  type MissingnessCoverageRow,
  type RunPreflightConstraints,
} from "@/lib/coverage-check";

function makeConstraints(
  overrides: Partial<RunPreflightConstraints> = {}
): RunPreflightConstraints {
  return {
    dataCutoffDate: "2026-03-12",
    universeEarliestStart: "2014-04-03",
    universeValidFrom: "2014-04-03",
    minStartDate: "2014-04-03",
    maxEndDate: "2026-03-12",
    missingTickers: [],
    warmupStart: "2014-01-01",
    requiredStart: "2014-04-03",
    requiredEnd: "2026-03-12",
    ...overrides,
  };
}

function makeUniverseRows(
  count: number,
  overrides: Record<number, Partial<MissingnessCoverageRow>> = {}
): MissingnessCoverageRow[] {
  return Array.from({ length: count }, (_, index) => ({
    symbol: `T${index}`,
    isBenchmark: false,
    firstDate: "2014-04-03",
    lastDate: "2026-03-12",
    windowStart: "2014-04-03",
    expectedDays: 100,
    actualDays: 100,
    trueMissingDays: 0,
    trueMissingRate: 0,
    ...overrides[index],
  }));
}

describe("buildRunPreflightResult", () => {
  it("computes zero benchmark missingness when expected and actual benchmark dates match", () => {
    const result = computeBenchmarkCoverage({
      benchmarkTicker: "SPY",
      windowStart: "2021-01-04",
      windowEnd: "2021-01-08",
      cutoffDate: "2021-01-08",
      stats: {
        firstDate: "1993-01-29",
        lastDate: "2026-03-12",
      },
      benchmarkDates: ["2021-01-04", "2021-01-05", "2021-01-06", "2021-01-07", "2021-01-08"],
    });

    expect(result).toMatchObject({
      windowStartUsed: "2021-01-04",
      windowEndUsed: "2021-01-08",
      expectedDays: 5,
      actualDays: 5,
      missingDays: 0,
      trueMissingRate: 0,
      status: "good",
    });
  });

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
          lastDate: "2026-03-12",
          windowStart: "2014-01-01",
          expectedDays: 100,
          actualDays: 100,
          trueMissingDays: 0,
          trueMissingRate: 0,
        },
      ],
    });

    expect(result.status).toBe("block");
    expect(result.suggested_fixes).toContainEqual({
      kind: "clamp_start_date",
      value: "2014-04-03",
    });
  });

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
          lastDate: "2026-03-12",
          windowStart: "2014-01-01",
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
    });

    expect(result.status).toBe("warn");
    expect(result.coverage.universe.status).toBe("warning");
  });

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
          lastDate: "2026-03-12",
          windowStart: "2014-01-01",
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
    });

    expect(result.status).toBe("block");
    expect(result.coverage.universe.status).toBe("blocked");
  });

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
          lastDate: "2026-03-12",
          windowStart: "2014-01-01",
          expectedDays: 100,
          actualDays: 100,
          trueMissingDays: 0,
          trueMissingRate: 0,
        },
        ...makeUniverseRows(20, {
          0: { trueMissingDays: 12, trueMissingRate: 0.12, actualDays: 88 },
        }),
      ],
    });

    expect(result.status).toBe("block");
    expect(result.coverage.universe.over10Percent).toEqual(["T0"]);
  });

  it("warns when benchmark true missingness is between 3% and 5%", () => {
    const result = buildRunPreflightResult({
      strategyId: "equal_weight",
      startDate: "2021-01-04",
      endDate: "2026-03-01",
      benchmark: "SPY",
      constraints: makeConstraints({
        warmupStart: "2021-01-04",
        requiredStart: "2021-01-04",
        requiredEnd: "2026-03-01",
      }),
      symbolRows: [
        {
          symbol: "SPY",
          isBenchmark: true,
          firstDate: "1993-01-29",
          lastDate: "2026-03-01",
          windowStart: "2021-01-04",
          expectedDays: 100,
          actualDays: 96,
          trueMissingDays: 4,
          trueMissingRate: 0.04,
        },
        ...makeUniverseRows(8),
      ],
    });

    expect(result.status).toBe("warn");
    expect(result.coverage.benchmark.status).toBe("warning");
    expect(result.reasons[0]).toContain("4.0%");
    expect(result.reasons[0]).toContain("2021-01-04 -> 2026-03-01");
    expect(result.coverage.benchmark).toMatchObject({
      metricSourceUsed: "run_window",
      windowStartUsed: "2021-01-04",
      windowEndUsed: "2026-03-01",
      expectedDays: 100,
      actualDays: 96,
      missingDays: 4,
      trueMissingRate: 0.04,
    });
  });
});
