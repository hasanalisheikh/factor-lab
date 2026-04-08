import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompareWorkbench } from "@/components/compare/compare-workbench";
import type { CompareRunBundle, EquityCurveRow, RunMetricsRow, RunRow } from "@/lib/supabase/types";

vi.mock("recharts", async () => {
  const ReactModule = await import("react");

  type LegendPayloadItem = {
    dataKey: string;
    value: string;
    color: string;
  };

  type LegendContentProps = {
    payload?: LegendPayloadItem[];
    verticalAlign?: "top" | "bottom";
  };

  function ResponsiveContainer({ children }: { children?: React.ReactNode }) {
    return <div data-testid="responsive-container">{children}</div>;
  }

  function LineChart({ children, data }: { children?: React.ReactNode; data?: unknown }) {
    return (
      <div data-testid="line-chart" data-points={JSON.stringify(data ?? [])}>
        {children}
      </div>
    );
  }

  function Line({ dataKey }: { dataKey?: string }) {
    return <div data-testid={`line-${dataKey ?? "unknown"}`} />;
  }

  function CartesianGrid() {
    return <div data-testid="cartesian-grid" />;
  }

  function XAxis() {
    return <div data-testid="x-axis" />;
  }

  function YAxis() {
    return <div data-testid="y-axis" />;
  }

  function Tooltip() {
    return <div data-testid="tooltip" />;
  }

  function Legend({ content }: { content?: React.ReactNode }) {
    const payload: LegendPayloadItem[] = [
      { dataKey: "runA", value: "runA", color: "var(--color-chart-1)" },
      { dataKey: "runB", value: "runB", color: "var(--color-chart-5)" },
    ];

    return (
      <div data-testid="legend">
        {ReactModule.isValidElement<LegendContentProps>(content)
          ? ReactModule.cloneElement(content, { payload, verticalAlign: "top" })
          : null}
      </div>
    );
  }

  return {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
  };
});

function makeRun(runId: string, name: string): RunRow {
  return {
    id: runId,
    name,
    strategy_id: "equal_weight",
    status: "completed",
    benchmark: "SPY",
    benchmark_ticker: "SPY",
    universe: "ETF8",
    universe_symbols: ["SPY", "QQQ"],
    costs_bps: 10,
    top_n: 5,
    run_params: {},
    run_metadata: {},
    start_date: "2024-01-01",
    end_date: "2024-01-05",
    executed_start_date: "2024-01-01",
    executed_end_date: "2024-01-05",
    created_at: "2026-04-09T00:00:00Z",
    user_id: "user-1",
    executed_with_missing_data: false,
  };
}

function makeMetrics(runId: string, overrides: Partial<RunMetricsRow> = {}): RunMetricsRow {
  return {
    id: `metrics-${runId}`,
    run_id: runId,
    cagr: 0.12,
    sharpe: 1.1,
    max_drawdown: -0.18,
    turnover: 0.22,
    volatility: 0.16,
    win_rate: 0.55,
    profit_factor: 1.4,
    calmar: 0.67,
    ...overrides,
  };
}

function makeEquityRows(
  runId: string,
  points: Array<{ date: string; portfolio: number; benchmark: number }>
): EquityCurveRow[] {
  return points.map((point, index) => ({
    id: `eq-${runId}-${index}`,
    run_id: runId,
    ...point,
  }));
}

function makeBundle(params: {
  runId: string;
  name: string;
  cagr: number;
  sharpe: number;
  maxDrawdown: number;
  turnover: number;
  points: Array<{ date: string; portfolio: number; benchmark: number }>;
}): CompareRunBundle {
  return {
    run: makeRun(params.runId, params.name),
    metrics: makeMetrics(params.runId, {
      cagr: params.cagr,
      sharpe: params.sharpe,
      max_drawdown: params.maxDrawdown,
      turnover: params.turnover,
    }),
    equity: makeEquityRows(params.runId, params.points),
  };
}

function readChartData<T>(chartIndex: number): T[] {
  const charts = screen.getAllByTestId("line-chart");
  const raw = charts[chartIndex]?.getAttribute("data-points");

  expect(raw).not.toBeNull();

  return JSON.parse(raw ?? "[]") as T[];
}

describe("CompareWorkbench", () => {
  afterEach(() => {
    cleanup();
  });

  const bundleA = makeBundle({
    runId: "run-a",
    name: "Run A",
    cagr: 0.12,
    sharpe: 1.1,
    maxDrawdown: -0.25,
    turnover: 0.11,
    points: [
      { date: "2024-01-01", portfolio: 100, benchmark: 100 },
      { date: "2024-01-02", portfolio: 120, benchmark: 101 },
      { date: "2024-01-03", portfolio: 90, benchmark: 102 },
      { date: "2024-01-04", portfolio: 110, benchmark: 103 },
    ],
  });

  const bundleB = makeBundle({
    runId: "run-b",
    name: "Run B",
    cagr: 0.19,
    sharpe: 1.2,
    maxDrawdown: -0.05,
    turnover: 0.13,
    points: [
      { date: "2024-01-02", portfolio: 100, benchmark: 100 },
      { date: "2024-01-03", portfolio: 95, benchmark: 101 },
      { date: "2024-01-04", portfolio: 105, benchmark: 102 },
      { date: "2024-01-05", portfolio: 80, benchmark: 103 },
    ],
  });

  const bundleC = makeBundle({
    runId: "run-c",
    name: "Run C",
    cagr: 0.31,
    sharpe: 1.35,
    maxDrawdown: -0.3,
    turnover: 0.09,
    points: [
      { date: "2024-01-02", portfolio: 100, benchmark: 100 },
      { date: "2024-01-03", portfolio: 80, benchmark: 99 },
      { date: "2024-01-04", portfolio: 70, benchmark: 98 },
      { date: "2024-01-05", portfolio: 75, benchmark: 97 },
    ],
  });

  it("removes the leaderboard and renders compare sections in the intended order", () => {
    render(<CompareWorkbench bundles={[bundleA, bundleB, bundleC]} />);

    expect(screen.queryByText("Strategy Leaderboard")).not.toBeInTheDocument();
    expect(screen.getAllByText("Run A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Run B").length).toBeGreaterThan(0);
    expect(screen.getByText("Overlay Drawdown")).toBeInTheDocument();
    expect(screen.getByText("Metric Diff")).toBeInTheDocument();

    const text = document.body.textContent ?? "";
    expect(text.indexOf("Select Runs")).toBeLessThan(
      text.indexOf("Overlay Equity (Indexed to 100)")
    );
    expect(text.indexOf("Overlay Equity (Indexed to 100)")).toBeLessThan(
      text.indexOf("Overlay Drawdown")
    );
    expect(text.indexOf("Overlay Drawdown")).toBeLessThan(text.indexOf("Metric Diff"));

    const drawdownData = readChartData<{ date: string; runA: number; runB: number }>(1);
    expect(drawdownData.map((point) => point.date)).toEqual([
      "2024-01-02",
      "2024-01-03",
      "2024-01-04",
    ]);
    expect(drawdownData[0]?.runA).toBeCloseTo(0, 6);
    expect(drawdownData[0]?.runB).toBeCloseTo(0, 6);
    expect(drawdownData[1]?.runA).toBeCloseTo(-25, 6);
    expect(drawdownData[1]?.runB).toBeCloseTo(-5, 6);
    expect(drawdownData[2]?.runA).toBeCloseTo(-8.333333, 5);
    expect(drawdownData[2]?.runB).toBeCloseTo(0, 6);
  });

  it("updates the drawdown overlay and metric diff when the selected run changes", () => {
    render(<CompareWorkbench bundles={[bundleA, bundleB, bundleC]} />);

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[1], { target: { value: "run-c" } });

    const drawdownData = readChartData<{ date: string; runA: number; runB: number }>(1);
    expect(drawdownData.map((point) => point.date)).toEqual([
      "2024-01-02",
      "2024-01-03",
      "2024-01-04",
    ]);
    expect(drawdownData[0]?.runB).toBeCloseTo(0, 6);
    expect(drawdownData[1]?.runB).toBeCloseTo(-20, 6);
    expect(drawdownData[2]?.runB).toBeCloseTo(-30, 6);

    const metricDiffTitle = screen.getAllByText("Metric Diff").at(-1) ?? null;
    const metricDiffCard = metricDiffTitle?.closest('[data-slot="card"]') ?? null;
    expect(metricDiffCard).not.toBeNull();

    if (!metricDiffCard) {
      throw new Error("Metric Diff card not found");
    }

    expect(within(metricDiffCard).getByText("31.0%")).toBeInTheDocument();
    expect(within(metricDiffCard).getByText("Run A")).toBeInTheDocument();
    expect(within(metricDiffCard).getByText("Run B")).toBeInTheDocument();
  });
});
