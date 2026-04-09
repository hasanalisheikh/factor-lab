import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getJobsMock, getRunsBacktestWindowSummaryMock } = vi.hoisted(() => ({
  getJobsMock: vi.fn(),
  getRunsBacktestWindowSummaryMock: vi.fn(),
}));

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="app-shell">
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock("@/components/status-badge", () => ({
  StatusBadge: ({ status }: { status: string }) => (
    <span data-testid="run-status-badge">{status}</span>
  ),
}));

vi.mock("@/lib/supabase/queries", () => ({
  getJobs: getJobsMock,
  getRunsBacktestWindowSummary: getRunsBacktestWindowSummaryMock,
  BACKTEST_MIN_SPAN_DAYS: 365,
  BACKTEST_MIN_DATA_POINTS: 252,
  BACKTEST_END_DATE_TOLERANCE_TRADING_DAYS: 3,
}));

import JobsPage from "@/app/(dashboard)/jobs/page";

const ORIGINAL_SHOW_BACKTEST_WINDOW_AUDIT = process.env.SHOW_BACKTEST_WINDOW_AUDIT;

function setAuditFlag(value: string | undefined) {
  if (value === undefined) {
    delete process.env.SHOW_BACKTEST_WINDOW_AUDIT;
    return;
  }
  process.env.SHOW_BACKTEST_WINDOW_AUDIT = value;
}

async function renderJobsPage() {
  render(await JobsPage());
}

function makeJob() {
  return {
    id: "job-1",
    name: "Nightly backtest",
    status: "completed",
    stage: "persist",
    started_at: "2026-04-09T00:00:00Z",
    duration: 12,
    progress: 100,
    error_message: null,
  };
}

function makeAuditRow() {
  return {
    run_id: "run-1",
    name: "Audit run",
    strategy_id: "equal_weight",
    status: "completed",
    start_date: "2021-03-01",
    end_date: "2026-03-13",
    span_days: 1824,
    requested_span_days: 1838,
    equity_start_date: "2021-03-15",
    equity_end_date: "2026-03-13",
    equity_span_days: 1824,
    end_gap_trading_days: 0,
    data_points: 1256,
    meets_min_span: true,
    meets_min_points: true,
    meets_end_tolerance: true,
    audit_outcome: "pass",
  };
}

describe("JobsPage backtest window audit gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getJobsMock.mockResolvedValue([makeJob()]);
    getRunsBacktestWindowSummaryMock.mockResolvedValue([makeAuditRow()]);
  });

  afterEach(() => {
    cleanup();
    if (ORIGINAL_SHOW_BACKTEST_WINDOW_AUDIT === undefined) {
      delete process.env.SHOW_BACKTEST_WINDOW_AUDIT;
    } else {
      process.env.SHOW_BACKTEST_WINDOW_AUDIT = ORIGINAL_SHOW_BACKTEST_WINDOW_AUDIT;
    }
  });

  it("hides the audit panel and skips fetching when the flag is undefined", async () => {
    setAuditFlag(undefined);

    await renderJobsPage();

    expect(screen.getByText("Job Queue")).toBeInTheDocument();
    expect(screen.queryByText("Backtest Window Audit")).not.toBeInTheDocument();
    expect(getJobsMock).toHaveBeenCalledTimes(1);
    expect(getRunsBacktestWindowSummaryMock).not.toHaveBeenCalled();
  });

  it("hides the audit panel and skips fetching when the flag is empty", async () => {
    setAuditFlag("");

    await renderJobsPage();

    expect(screen.queryByText("Backtest Window Audit")).not.toBeInTheDocument();
    expect(getRunsBacktestWindowSummaryMock).not.toHaveBeenCalled();
  });

  it("hides the audit panel and skips fetching when the flag is false", async () => {
    setAuditFlag("false");

    await renderJobsPage();

    expect(screen.queryByText("Backtest Window Audit")).not.toBeInTheDocument();
    expect(getRunsBacktestWindowSummaryMock).not.toHaveBeenCalled();
  });

  it("renders the audit panel and fetches audit rows when the flag is true", async () => {
    setAuditFlag("true");

    await renderJobsPage();

    expect(screen.getByText("Backtest Window Audit")).toBeInTheDocument();
    expect(screen.getByText("Audit run")).toBeInTheDocument();
    expect(getRunsBacktestWindowSummaryMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the audit panel hidden when the flag is true but no audit rows exist", async () => {
    setAuditFlag("true");
    getRunsBacktestWindowSummaryMock.mockResolvedValueOnce([]);

    await renderJobsPage();

    expect(screen.queryByText("Backtest Window Audit")).not.toBeInTheDocument();
    expect(getRunsBacktestWindowSummaryMock).toHaveBeenCalledTimes(1);
  });
});
