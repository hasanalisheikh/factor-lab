import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RunsTable } from "@/components/runs-table"
import type { RunWithMetrics } from "@/lib/supabase/queries"

const mockRuns: RunWithMetrics[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Momentum Test",
    strategy_id: "momentum_12_1",
    status: "completed",
    benchmark: "SPY",
    benchmark_ticker: "SPY",
    universe: "ETF8",
    universe_symbols: null,
    costs_bps: 10,
    top_n: 10,
    run_params: {},
    start_date: "2023-01-01",
    end_date: "2023-12-31",
    created_at: "2026-02-01T00:00:00Z",
    run_metrics: {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      run_id: "11111111-1111-1111-1111-111111111111",
      cagr: 0.12,
      sharpe: 1.1,
      max_drawdown: -0.09,
      turnover: 0.2,
      volatility: 0.14,
      win_rate: 0.56,
      profit_factor: 1.4,
      calmar: 1.3,
    },
  },
]

describe("RunsTable", () => {
  it("renders rows and links to run detail", () => {
    render(<RunsTable runs={mockRuns} />)
    expect(screen.getByText("Momentum Test")).toBeInTheDocument()
    const link = screen.getByRole("link", { name: "Momentum Test" })
    expect(link).toHaveAttribute("href", "/runs/11111111-1111-1111-1111-111111111111")
  })
})
