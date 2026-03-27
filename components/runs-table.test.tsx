import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunsTable } from "@/components/runs-table";
import type { RunWithMetrics } from "@/lib/supabase/types";

const BASE_RUN: RunWithMetrics = {
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
  run_metadata: {},
  start_date: "2023-01-01",
  end_date: "2023-12-31",
  executed_start_date: null,
  executed_end_date: null,
  created_at: "2026-02-01T00:00:00Z",
  user_id: null,
  executed_with_missing_data: false,
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
};

describe("RunsTable", () => {
  it("renders the desktop table and mobile cards with run actions", () => {
    render(<RunsTable runs={[BASE_RUN]} />);
    expect(screen.getAllByText("Momentum Test")).not.toHaveLength(0);
    const link = screen.getByRole("link", { name: "Momentum Test" });
    expect(link).toHaveAttribute("href", "/runs/11111111-1111-1111-1111-111111111111");
    expect(screen.getAllByRole("button", { name: "Open actions for Momentum Test" })).toHaveLength(
      2
    );
    expect(screen.getByRole("combobox", { name: "Sort runs" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Regression: Period column uses executed window, not requested window
// ---------------------------------------------------------------------------

describe("RunsTable - Period column executed window truthfulness", () => {
  it("shows executed_end_date when it differs from end_date", () => {
    const run: RunWithMetrics = {
      ...BASE_RUN,
      id: "run-exec",
      name: "Stale Run",
      end_date: "2026-03-13",
      executed_start_date: "2021-03-15",
      executed_end_date: "2025-03-06",
    };

    render(<RunsTable runs={[run]} />);

    // Executed end (2025-03) must appear; requested end (2026-03) must not
    expect(document.body.textContent).toContain("2025-03");
    expect(document.body.textContent).not.toContain("2026-03");
  });

  it("shows executed_start_date when it differs from start_date", () => {
    const run: RunWithMetrics = {
      ...BASE_RUN,
      id: "run-exec-start",
      name: "Warmup Run",
      start_date: "2021-01-01",
      end_date: "2026-03-13",
      executed_start_date: "2021-03-15",
      executed_end_date: "2026-03-13",
    };

    render(<RunsTable runs={[run]} />);

    // Executed start (2021-03) must appear; requested start (2021-01) must not
    expect(document.body.textContent).toContain("2021-03");
    expect(document.body.textContent).not.toContain("2021-01");
  });

  it("falls back to start_date/end_date when executed dates are null (pre-migration run)", () => {
    const run: RunWithMetrics = {
      ...BASE_RUN,
      id: "run-legacy",
      name: "Legacy Run",
      start_date: "2021-03-01",
      end_date: "2026-03-13",
      executed_start_date: null,
      executed_end_date: null,
    };

    render(<RunsTable runs={[run]} />);

    // Falls back gracefully to the requested window (both dates visible)
    expect(document.body.textContent).toContain("2021-03");
    expect(document.body.textContent).toContain("2026-03");
  });
});
