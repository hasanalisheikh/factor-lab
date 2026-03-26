import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EquityChart } from "@/components/equity-chart";
import { DEFAULT_EQUITY_CHART_MAX_POINTS, downsampleEquityCurve } from "@/lib/equity-curve";

function makeTradingDaySeries(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const data = [];
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

describe("EquityChart", () => {
  it("renders the actual equity-curve last date, not a later run.end_date", () => {
    // Equity curve ends 2025-11-22; a run.end_date of 2026-03-13 is never passed to the chart
    const data = makeTradingDaySeries("2021-03-13", "2025-11-22");
    const lastDate = data[data.length - 1].date;

    render(<EquityChart data={data} benchmarkTicker="SPY" timeframe="ALL" />);

    expect(screen.getByTestId("chart-end-date")).toHaveTextContent(lastDate);
    expect(screen.queryByText("2026-03-13")).not.toBeInTheDocument();
  });

  it("renders the exact plotted start, mid, and end dates for ALL on long runs", () => {
    const data = makeTradingDaySeries("2021-03-01", "2026-03-13");
    const plotted = downsampleEquityCurve(data, DEFAULT_EQUITY_CHART_MAX_POINTS);
    const midDate = plotted[Math.floor((plotted.length - 1) / 2)]?.date;

    expect(data.length).toBeGreaterThan(1200);
    expect(plotted).toHaveLength(DEFAULT_EQUITY_CHART_MAX_POINTS);

    render(<EquityChart data={data} benchmarkTicker="SPY" timeframe="ALL" />);

    expect(screen.getByText("2021-03-01")).toBeInTheDocument();
    expect(screen.getByText(midDate ?? "")).toBeInTheDocument();
    expect(screen.getByText("2026-03-13")).toBeInTheDocument();
  });
});
