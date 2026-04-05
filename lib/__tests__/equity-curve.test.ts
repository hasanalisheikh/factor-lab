import { describe, expect, it } from "vitest";

import {
  DEFAULT_EQUITY_CHART_MAX_POINTS,
  alignEquityCurveByDate,
  downsampleEquityCurve,
  getAlignedTimeframeEquityCurve,
} from "@/lib/equity-curve";

function makePoint(index: number) {
  const date = new Date(Date.UTC(2023, 0, 1 + index));
  return {
    date: date.toISOString().slice(0, 10),
    portfolio: 100_000 + index,
    benchmark: 100_000 + index / 2,
  };
}

function makeTradingDaySeries(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const data = [];
  let index = 0;

  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    data.push(makePoint(index));
    data[index].date = day.toISOString().slice(0, 10);
    index += 1;
  }

  return data;
}

describe("downsampleEquityCurve", () => {
  it("always preserves the first and last visible dates", () => {
    const data = Array.from({ length: 1001 }, (_, index) => makePoint(index));

    const sampled = downsampleEquityCurve(data, 100);

    expect(sampled[0]?.date).toBe(data[0]?.date);
    expect(sampled.at(-1)?.date).toBe(data.at(-1)?.date);
  });

  it("spans the full 2021→2026 range with exactly 1000 plotted points", () => {
    const data = makeTradingDaySeries("2021-03-01", "2026-03-13");
    const sampled = downsampleEquityCurve(data, DEFAULT_EQUITY_CHART_MAX_POINTS);
    const midIndex = Math.floor((sampled.length - 1) / 2);
    const expectedMidSourceIndex = Math.round(
      (midIndex * (data.length - 1)) / (DEFAULT_EQUITY_CHART_MAX_POINTS - 1)
    );

    expect(data.length).toBeGreaterThan(1200);
    expect(sampled).toHaveLength(DEFAULT_EQUITY_CHART_MAX_POINTS);
    expect(sampled[0]?.date).toBe("2021-03-01");
    expect(sampled[midIndex]?.date).toBe(data[expectedMidSourceIndex]?.date);
    expect(sampled.at(-1)?.date).toBe("2026-03-13");
  });
});

describe("getAlignedTimeframeEquityCurve", () => {
  it("keeps the full run range when ALL is selected", () => {
    const data = Array.from({ length: 500 }, (_, index) => makePoint(index));

    const allRange = getAlignedTimeframeEquityCurve(data, "ALL");

    expect(allRange).toHaveLength(data.length);
    expect(allRange[0]?.date).toBe(data[0]?.date);
    expect(allRange.at(-1)?.date).toBe(data.at(-1)?.date);
  });
});

// ---------------------------------------------------------------------------
// Helpers for compare-overlay alignment tests
// ---------------------------------------------------------------------------

function makeSeriesA() {
  // Apr 2021 – Dec 2021 (trading days only)
  return makeTradingDaySeries("2021-04-01", "2021-12-31");
}

function makeSeriesB() {
  // Apr 2021 – Mar 2022 — extends two months beyond series A
  return makeTradingDaySeries("2021-04-01", "2022-03-31");
}

/** Simulates the compare-workbench intersection logic. */
function buildIntersection(
  rawA: ReturnType<typeof makeTradingDaySeries>,
  rawB: ReturnType<typeof makeTradingDaySeries>
) {
  const aClean = alignEquityCurveByDate(rawA);
  const bClean = alignEquityCurveByDate(rawB);
  const bDateSet = new Set(bClean.map((x) => x.date));
  const aDateSet = new Set(aClean.map((x) => x.date));
  const aIntersection = aClean.filter((x) => bDateSet.has(x.date));
  const bIntersection = bClean.filter((x) => aDateSet.has(x.date));
  return { aIntersection, bIntersection };
}

function normalizeSeries(series: ReturnType<typeof alignEquityCurveByDate>) {
  if (series.length === 0) return [];
  const firstP = series[0].portfolio;
  const firstB = series[0].benchmark;
  return series.map((pt) => ({
    date: pt.date,
    portfolio: firstP > 0 ? (pt.portfolio / firstP) * 100 : 100,
    benchmark: firstB > 0 ? (pt.benchmark / firstB) * 100 : 100,
  }));
}

describe("compare overlay alignment", () => {
  it("Test A — intersection of different-range series contains only shared dates, no nulls", () => {
    const rawA = makeSeriesA(); // ends Dec 2021
    const rawB = makeSeriesB(); // ends Mar 2022

    const { aIntersection, bIntersection } = buildIntersection(rawA, rawB);

    // All intersection dates must be present in both cleaned series
    const aDateSet = new Set(alignEquityCurveByDate(rawA).map((x) => x.date));
    const bDateSet = new Set(alignEquityCurveByDate(rawB).map((x) => x.date));

    for (const pt of aIntersection) {
      expect(aDateSet.has(pt.date)).toBe(true);
      expect(bDateSet.has(pt.date)).toBe(true);
    }
    for (const pt of bIntersection) {
      expect(aDateSet.has(pt.date)).toBe(true);
      expect(bDateSet.has(pt.date)).toBe(true);
    }

    // No dates beyond the shorter series' end should appear
    const lastA = rawA.at(-1)!.date;
    for (const pt of aIntersection) {
      expect(pt.date <= lastA).toBe(true);
    }
    for (const pt of bIntersection) {
      expect(pt.date <= lastA).toBe(true);
    }
  });

  it("Test B — both normalized series start at exactly 100 on the same calendar date", () => {
    const rawA = makeSeriesA();
    const rawB = makeSeriesB();

    const { aIntersection, bIntersection } = buildIntersection(rawA, rawB);
    const aNorm = normalizeSeries(aIntersection);
    const bNorm = normalizeSeries(bIntersection);

    // First point of each normalized series is 100
    expect(aNorm[0]?.portfolio).toBeCloseTo(100, 10);
    expect(bNorm[0]?.portfolio).toBeCloseTo(100, 10);

    // Both start on the same calendar date
    expect(aNorm[0]?.date).toBe(bNorm[0]?.date);
  });

  it("Test C — alignEquityCurveByDate drops invalid first value; no NaN propagates to chart", () => {
    const raw = [
      { date: "2021-04-01", portfolio: 0, benchmark: 100_000 }, // invalid portfolio (zero)
      { date: "2021-04-02", portfolio: 100_010, benchmark: 100_005 },
      { date: "2021-04-05", portfolio: 100_020, benchmark: 100_010 },
    ];

    const cleaned = alignEquityCurveByDate(raw);

    // The zero-portfolio row should be dropped
    expect(cleaned.every((pt) => pt.portfolio > 0)).toBe(true);

    // Normalizing the cleaned series must never produce NaN
    const norm = normalizeSeries(cleaned);
    for (const pt of norm) {
      expect(Number.isFinite(pt.portfolio)).toBe(true);
      expect(Number.isFinite(pt.benchmark)).toBe(true);
    }
  });

  it("Test D — two series with identical date sets: all dates preserved, no data lost", () => {
    const rawA = makeTradingDaySeries("2021-04-01", "2021-12-31");
    const rawB = makeTradingDaySeries("2021-04-01", "2021-12-31");

    const { aIntersection, bIntersection } = buildIntersection(rawA, rawB);

    expect(aIntersection).toHaveLength(alignEquityCurveByDate(rawA).length);
    expect(bIntersection).toHaveLength(alignEquityCurveByDate(rawB).length);
  });

  it("Test E — benchmark gap in middle is forward-filled; no synthetic flat benchmark segment", () => {
    const raw = [
      { date: "2021-04-01", portfolio: 100_000, benchmark: 100_000 },
      { date: "2021-04-02", portfolio: 100_100, benchmark: 0 }, // missing benchmark (zero)
      { date: "2021-04-05", portfolio: 100_200, benchmark: 100_200 },
    ];

    const aligned = alignEquityCurveByDate(raw);

    // All three portfolio rows survive
    expect(aligned).toHaveLength(3);

    // The gap row should use the previous valid benchmark (100_000), not 0
    const gapRow = aligned.find((pt) => pt.date === "2021-04-02")!;
    expect(gapRow.benchmark).toBe(100_000);
  });
});
