import { describe, expect, it } from "vitest";

import {
  DEFAULT_EQUITY_CHART_MAX_POINTS,
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
