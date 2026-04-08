import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RecentRuns } from "@/components/recent-runs";
import type { RunWithMetrics } from "@/lib/supabase/types";

afterEach(() => {
  cleanup();
});

function makeRun(index: number): RunWithMetrics {
  const id = `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
  return {
    id,
    name: `Run ${index}`,
    strategy_id: "momentum_12_1",
    status: "completed",
    benchmark: "SPY",
    benchmark_ticker: "SPY",
    universe: "ETF8",
    universe_symbols: null,
    costs_bps: 10,
    top_n: 10,
    run_params: {},
    run_metadata: {},
    start_date: "2023-01-01",
    end_date: "2023-12-31",
    executed_start_date: null,
    executed_end_date: null,
    created_at: "2026-02-01T00:00:00Z",
    user_id: null,
    executed_with_missing_data: false,
    run_metrics: {
      id: `11111111-1111-1111-1111-${String(index).padStart(12, "0")}`,
      run_id: id,
      cagr: 0.12,
      sharpe: 1 + index / 10,
      max_drawdown: -0.09,
      turnover: 0.2,
      volatility: 0.14,
      win_rate: 0.56,
      profit_factor: 1.4,
      calmar: 1.3,
    },
  };
}

describe("RecentRuns", () => {
  it("renders all fetched runs inside the scroll area instead of truncating at six", () => {
    const runs = Array.from({ length: 8 }, (_, index) => makeRun(index + 1));

    render(<RecentRuns runs={runs} total={20} />);

    const scrollArea = screen.getByTestId("recent-runs-scroll-area");
    expect(scrollArea).toBeInTheDocument();
    expect(scrollArea.className).toContain("lg:overflow-y-auto");
    expect(scrollArea.className).toContain("lg:max-h-[22.5rem]");
    expect(within(scrollArea).getByText("Run 8")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(8);
    expect(screen.getByText("20 total")).toBeInTheDocument();
  });

  it("keeps the header outside the scroll area and preserves selected row styling", () => {
    const runs = Array.from({ length: 7 }, (_, index) => makeRun(index + 1));
    const selectedRunId = runs[6].id;

    render(<RecentRuns runs={runs} total={7} selectedRunId={selectedRunId} />);

    const scrollArea = screen.getByTestId("recent-runs-scroll-area");
    expect(screen.getByText("Recent Runs")).toBeInTheDocument();
    expect(within(scrollArea).queryByText("Recent Runs")).not.toBeInTheDocument();
    expect(screen.getByText("Selected")).toBeInTheDocument();

    const selectedLink = screen.getByRole("link", { name: /Run 7/i });
    expect(selectedLink).toHaveAttribute("href", `/dashboard?run=${selectedRunId}`);
    expect(selectedLink.className).toContain("ring-1");
    expect(selectedLink.className).toContain("bg-primary/8");
  });

  it("shows the empty state without rendering the scroll area", () => {
    render(<RecentRuns runs={[]} total={0} />);

    expect(screen.getByText("No runs yet")).toBeInTheDocument();
    expect(screen.queryByTestId("recent-runs-scroll-area")).not.toBeInTheDocument();
  });
});
