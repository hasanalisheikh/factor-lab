import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TradesTab } from "@/components/run-detail/trades-tab";
import type { PositionRow } from "@/lib/supabase/types";

function positionsForDate(date: string, symbols: string[]): PositionRow[] {
  return symbols.map((symbol) => ({
    run_id: "run-1",
    date,
    symbol,
    weight: 0.2,
  }));
}

describe("TradesTab", () => {
  it("labels the chart truthfully and renders the rebalance log from positions", () => {
    const positions = [
      ...positionsForDate("2026-03-10", ["AAA", "BBB", "CCC", "DDD", "EEE"]),
      ...positionsForDate("2026-03-11", ["AAA", "BBB", "CCC", "DDD", "FFF"]),
    ];

    render(<TradesTab positions={positions} />);

    expect(screen.getByText("Per-rebalance constituent turnover")).toBeInTheDocument();
    expect(screen.getByText(/weight changes when holdings enter/i)).toBeInTheDocument();
    expect(screen.getByText("Rebalance Log")).toBeInTheDocument();
    expect(screen.getByText("2 rebalances")).toBeInTheDocument();
    expect(screen.getByText("2026-03-11")).toBeInTheDocument();
    expect(screen.getByText("FFF")).toBeInTheDocument();
    expect(screen.getAllByText("EEE")).toHaveLength(2);
    expect(screen.getByText("5 (init)")).toBeInTheDocument();
  });
});
