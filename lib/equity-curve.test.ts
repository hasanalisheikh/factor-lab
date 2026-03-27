import { describe, expect, it } from "vitest";

import {
  alignEquityCurveByDate,
  getChartDateLabels,
  getDefaultTimeframe,
  getDownsampleIndices,
  pickByIndices,
  prepareTimeframeEquityCurve,
  sliceEquityCurveByTimeframe,
} from "@/lib/equity-curve";
import type { EquityCurvePoint } from "@/lib/equity-curve";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTradingDaySeries(startDate: string, endDate: string): EquityCurvePoint[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const data: EquityCurvePoint[] = [];
  let nav = 100_000;
  let bench = 100_000;

  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const date = day.toISOString().slice(0, 10);
    nav += 75;
    bench += 50;
    data.push({ date, portfolio: nav, benchmark: bench });
  }
  return data;
}

// ---------------------------------------------------------------------------
// getDownsampleIndices
// ---------------------------------------------------------------------------

describe("getDownsampleIndices", () => {
  it("always produces index 0 as first element", () => {
    for (const [n, k] of [
      [10, 5],
      [1000, 100],
      [1500, 1000],
      [500, 500],
    ] as [number, number][]) {
      const indices = getDownsampleIndices(n, k);
      expect(indices[0]).toBe(0);
    }
  });

  it("always produces index n-1 as last element", () => {
    for (const [n, k] of [
      [10, 5],
      [1000, 100],
      [1500, 1000],
      [500, 500],
    ] as [number, number][]) {
      const indices = getDownsampleIndices(n, k);
      expect(indices[indices.length - 1]).toBe(n - 1);
    }
  });

  it("returns all indices when length <= maxPoints", () => {
    const indices = getDownsampleIndices(50, 1000);
    expect(indices).toHaveLength(50);
    expect(indices[0]).toBe(0);
    expect(indices[49]).toBe(49);
  });

  it("returns empty array for zero or negative inputs", () => {
    expect(getDownsampleIndices(0, 100)).toHaveLength(0);
    expect(getDownsampleIndices(100, 0)).toHaveLength(0);
  });

  it("returns [n-1] when maxPoints is 1", () => {
    expect(getDownsampleIndices(500, 1)).toEqual([499]);
  });
});

// ---------------------------------------------------------------------------
// sliceEquityCurveByTimeframe
// ---------------------------------------------------------------------------

describe("sliceEquityCurveByTimeframe", () => {
  it('returns data unchanged for "ALL"', () => {
    const data = makeTradingDaySeries("2021-01-04", "2026-03-13");
    const result = sliceEquityCurveByTimeframe(data, "ALL");
    expect(result).toBe(data); // exact same reference
    expect(result.length).toBe(data.length);
  });

  it("returns empty array unchanged for empty input", () => {
    expect(sliceEquityCurveByTimeframe([], "ALL")).toHaveLength(0);
    expect(sliceEquityCurveByTimeframe([], "1Y")).toHaveLength(0);
  });

  it("1Y slice end date equals actual equity-curve last date (not some future date)", () => {
    const data = makeTradingDaySeries("2021-01-04", "2025-11-22");
    const sliced = sliceEquityCurveByTimeframe(data, "1Y");
    // End of the 1Y slice must equal the last date of the full equity curve
    expect(sliced[sliced.length - 1].date).toBe(data[data.length - 1].date);
  });

  it("1Y slice drops points older than 365 days from the last data point", () => {
    const data = makeTradingDaySeries("2021-01-04", "2026-03-13");
    const sliced = sliceEquityCurveByTimeframe(data, "1Y");
    expect(sliced.length).toBeGreaterThan(0);
    expect(sliced.length).toBeLessThan(data.length);
    // All dates in the slice must be within 365 days of the last date
    const lastDate = new Date(`${data[data.length - 1].date}T00:00:00Z`);
    const cutoff = new Date(lastDate);
    cutoff.setUTCDate(cutoff.getUTCDate() - 365);
    for (const pt of sliced) {
      expect(new Date(`${pt.date}T00:00:00Z`) >= cutoff).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// alignEquityCurveByDate
// ---------------------------------------------------------------------------

describe("alignEquityCurveByDate", () => {
  it("preserves all rows when both portfolio and benchmark are valid", () => {
    const data = makeTradingDaySeries("2022-01-03", "2022-06-30");
    const aligned = alignEquityCurveByDate(data);
    expect(aligned.length).toBe(data.length);
    expect(aligned[0].date).toBe(data[0].date);
    expect(aligned[aligned.length - 1].date).toBe(data[data.length - 1].date);
  });

  it("forward-fills missing benchmark values, preserving trailing portfolio dates", () => {
    const data = makeTradingDaySeries("2022-01-03", "2022-03-31");
    // Null out benchmark for the last 5 rows
    const withGap = data.map((pt, i) => (i >= data.length - 5 ? { ...pt, benchmark: NaN } : pt));
    const aligned = alignEquityCurveByDate(withGap);
    // All rows should be present (forward-fill fills the gaps)
    expect(aligned.length).toBe(data.length);
    // Last date must still be the actual last date
    expect(aligned[aligned.length - 1].date).toBe(data[data.length - 1].date);
    // Forward-filled benchmark must equal the last known valid benchmark
    const lastValidBench = data[data.length - 6].benchmark;
    for (const pt of aligned.slice(aligned.length - 5)) {
      expect(pt.benchmark).toBe(lastValidBench);
    }
  });

  it("drops rows where portfolio is invalid (NaN or zero)", () => {
    const data = makeTradingDaySeries("2022-01-03", "2022-02-28");
    const withBadPortfolio = data.map((pt, i) => (i === 2 ? { ...pt, portfolio: NaN } : pt));
    const aligned = alignEquityCurveByDate(withBadPortfolio);
    expect(aligned.length).toBe(data.length - 1);
  });
});

// ---------------------------------------------------------------------------
// getChartDateLabels
// ---------------------------------------------------------------------------

describe("getChartDateLabels", () => {
  it("returns empty strings for empty input", () => {
    const labels = getChartDateLabels([]);
    expect(labels).toEqual({ start: "", mid: "", end: "" });
  });

  it("end label equals the last date in the input array", () => {
    const data = makeTradingDaySeries("2021-01-04", "2026-03-13");
    const labels = getChartDateLabels(data);
    expect(labels.end).toBe(data[data.length - 1].date);
    expect(labels.start).toBe(data[0].date);
  });

  it("end label of downsampled data equals the true last date of the source", () => {
    const data = makeTradingDaySeries("2021-01-04", "2026-03-13");
    expect(data.length).toBeGreaterThan(1000);
    const indices = getDownsampleIndices(data.length, 1000);
    const plotted = pickByIndices(data, indices);
    const labels = getChartDateLabels(plotted);
    // Downsampling preserves last index, so end label must match source last date
    expect(labels.end).toBe(data[data.length - 1].date);
  });
});

// ---------------------------------------------------------------------------
// prepareTimeframeEquityCurve
// ---------------------------------------------------------------------------

describe("prepareTimeframeEquityCurve", () => {
  it('"ALL": plotted last date equals raw data last date', () => {
    const data = makeTradingDaySeries("2021-01-04", "2026-03-13");
    const { plotted, dateLabels } = prepareTimeframeEquityCurve(data, "ALL");
    expect(dateLabels.end).toBe(data[data.length - 1].date);
    expect(plotted[plotted.length - 1].date).toBe(data[data.length - 1].date);
  });

  it('"ALL": plotted first date equals raw data first date', () => {
    const data = makeTradingDaySeries("2021-01-04", "2026-03-13");
    const { plotted, dateLabels } = prepareTimeframeEquityCurve(data, "ALL");
    expect(dateLabels.start).toBe(data[0].date);
    expect(plotted[0].date).toBe(data[0].date);
  });

  it('"1Y": end label equals equity-curve actual last date (not a future date)', () => {
    const data = makeTradingDaySeries("2021-01-04", "2025-11-22");
    const { dateLabels } = prepareTimeframeEquityCurve(data, "1Y");
    expect(dateLabels.end).toBe(data[data.length - 1].date);
  });

  it("downsamples large series to at most DEFAULT_EQUITY_CHART_MAX_POINTS", () => {
    const data = makeTradingDaySeries("2021-01-04", "2026-03-13");
    expect(data.length).toBeGreaterThan(1000);
    const { plotted } = prepareTimeframeEquityCurve(data, "ALL");
    expect(plotted.length).toBeLessThanOrEqual(1000);
  });

  it("chart KPI window: start NAV from plotted[0] and end NAV from plotted[-1] match source boundaries", () => {
    const data = makeTradingDaySeries("2021-01-04", "2026-03-13");
    const { plotted } = prepareTimeframeEquityCurve(data, "ALL");
    // Start NAV must be the first portfolio value (100,075 for our generator)
    expect(plotted[0].portfolio).toBe(data[0].portfolio);
    // End NAV must be the last portfolio value
    expect(plotted[plotted.length - 1].portfolio).toBe(data[data.length - 1].portfolio);
  });
});

// ---------------------------------------------------------------------------
// getDefaultTimeframe
// ---------------------------------------------------------------------------

describe("getDefaultTimeframe", () => {
  it('returns "ALL" for runs spanning more than 365 days', () => {
    const data = makeTradingDaySeries("2021-01-04", "2026-03-13");
    expect(getDefaultTimeframe(data)).toBe("ALL");
  });

  it('returns "1Y" for short runs under 365 days', () => {
    const data = makeTradingDaySeries("2025-01-02", "2025-06-30");
    expect(getDefaultTimeframe(data)).toBe("1Y");
  });

  it('returns "1Y" for empty data', () => {
    expect(getDefaultTimeframe([])).toBe("1Y");
  });
});

// ---------------------------------------------------------------------------
// Regression: stored run history renders fully — no truncation by live-data
// cutoff, run.end_date, or "today". The stored equity_curve is authoritative.
// ---------------------------------------------------------------------------

describe("regression: stored run history renders fully without truncation", () => {
  it("ALL: chart end date equals the last stored date, not run.end_date", () => {
    // Equity curve stored through 2025-03-06; run.end_date is 2026-03-13 (never passed here)
    const stored = makeTradingDaySeries("2021-03-13", "2025-03-06");
    const { plotted, dateLabels } = prepareTimeframeEquityCurve(stored, "ALL");
    expect(dateLabels.end).toBe("2025-03-06");
    expect(plotted[plotted.length - 1].date).toBe("2025-03-06");
    // The requested end_date is never injected into the pure chart functions
    expect(plotted.some((p) => p.date === "2026-03-13")).toBe(false);
  });

  it("ALL: chart start date equals the first stored date", () => {
    const stored = makeTradingDaySeries("2021-03-13", "2025-03-06");
    const { plotted, dateLabels } = prepareTimeframeEquityCurve(stored, "ALL");
    // Use the actual first element (2021-03-13 is Saturday, so first weekday is 2021-03-15)
    expect(dateLabels.start).toBe(stored[0].date);
    expect(plotted[0].date).toBe(stored[0].date);
  });

  it("stored data beyond today renders fully without any date clamping", () => {
    // Future dates pass through unchanged — no comparison against "today"
    const stored = makeTradingDaySeries("2021-01-04", "2099-12-28");
    const { plotted, dateLabels } = prepareTimeframeEquityCurve(stored, "ALL");
    expect(dateLabels.end).toBe("2099-12-28");
    expect(plotted[plotted.length - 1].date).toBe("2099-12-28");
    // 2021-01-04 is a Monday so it is the first element
    expect(dateLabels.start).toBe(stored[0].date);
  });

  it("benchmark forward-fill preserves all trailing portfolio dates (benchmark not truncated)", () => {
    const data = makeTradingDaySeries("2022-01-03", "2025-03-14");
    // Null out benchmark for the last 30 rows (simulates benchmark lagging portfolio)
    const withLag = data.map((pt, i) => (i >= data.length - 30 ? { ...pt, benchmark: NaN } : pt));
    const aligned = alignEquityCurveByDate(withLag);
    // All rows must be present — benchmark lag must not drop trailing portfolio dates
    expect(aligned.length).toBe(data.length);
    expect(aligned[aligned.length - 1].date).toBe(data[data.length - 1].date);
  });

  it("ALL range spans exactly first→last stored point with no extra filtering", () => {
    const stored = makeTradingDaySeries("2021-03-13", "2026-03-13");
    const sliced = sliceEquityCurveByTimeframe(stored, "ALL");
    expect(sliced.length).toBe(stored.length);
    expect(sliced[0].date).toBe(stored[0].date);
    expect(sliced[sliced.length - 1].date).toBe(stored[stored.length - 1].date);
  });
});
