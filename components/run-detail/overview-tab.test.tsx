import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverviewTab, type RunConfig } from "@/components/run-detail/overview-tab";
import type { EquityCurveRow, RunMetricsRow } from "@/lib/supabase/types";

function makeCurve(startDate: string, endDate: string): EquityCurveRow[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const rows: EquityCurveRow[] = [];
  let nav = 100_000;
  let bench = 100_000;

  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const date = day.toISOString().slice(0, 10);
    nav += 75;
    bench += 50;
    rows.push({ id: `eq-${date}`, run_id: "run-1", date, portfolio: nav, benchmark: bench });
  }
  return rows;
}

const METRICS: RunMetricsRow = {
  id: "m-1",
  run_id: "run-1",
  cagr: 0.1,
  sharpe: 1.0,
  max_drawdown: -0.2,
  turnover: 0.1,
  volatility: 0.15,
  win_rate: 0.55,
  profit_factor: 1.3,
  calmar: 0.5,
};

const BASE_CONFIG: RunConfig = {
  strategyLabel: "Equal Weight",
  universe: "ETF8",
  universeCount: 8,
  benchmark: "SPY",
  startDate: "2021-03-01",
  endDate: "2026-03-13",
  costsBps: 10,
  topN: null,
  rebalanceFreq: "Monthly",
};

// ---------------------------------------------------------------------------
// Regression: no stale warning banner is ever rendered by OverviewTab.
// The stored equity curve is the authoritative record — no "(requested:...)"
// annotation and no "Prices have been updated" message.
// ---------------------------------------------------------------------------

describe("OverviewTab - regression: no stale warning for completed runs", () => {
  it("renders no stale warning when curve ends before runConfig.endDate", () => {
    // Equity curve stored through 2025-03-06; run requested 2026-03-13
    const curve = makeCurve("2021-03-01", "2025-03-06");

    render(
      <OverviewTab
        metrics={METRICS}
        equityCurve={curve}
        benchmarkTicker="SPY"
        runConfig={{ ...BASE_CONFIG, endDate: "2026-03-13" }}
      />
    );

    expect(screen.queryByText(/Prices have been updated/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Re-run to Latest/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/requested:/i)).not.toBeInTheDocument();
  });

  it("Period card shows effective stored dates, not the requested end date", () => {
    const curve = makeCurve("2021-03-01", "2025-03-06");

    render(
      <OverviewTab
        metrics={METRICS}
        equityCurve={curve}
        benchmarkTicker="SPY"
        runConfig={{ ...BASE_CONFIG, endDate: "2026-03-13" }}
      />
    );

    // Period card shows stored effective window (use getAllByText — container elements also match)
    expect(screen.getAllByText(/2021-03 – 2025-03/).length).toBeGreaterThan(0);
    // The requested end date "2026-03" must not appear as an annotation anywhere
    expect(screen.queryByText(/requested:/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("2026-03");
  });

  it("renders no stale warning even when curve ends exactly at run endDate", () => {
    const curve = makeCurve("2021-03-01", "2026-03-13");

    render(
      <OverviewTab
        metrics={METRICS}
        equityCurve={curve}
        benchmarkTicker="SPY"
        runConfig={BASE_CONFIG}
      />
    );

    expect(screen.queryByText(/Prices have been updated/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Re-run to Latest/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/requested:/i)).not.toBeInTheDocument();
  });
});
