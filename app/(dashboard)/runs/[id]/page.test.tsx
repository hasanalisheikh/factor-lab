import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReactNode } from "react";

const queryMocks = vi.hoisted(() => ({
  getBenchmarkOverlapStateForRunMock: vi.fn(),
  getEquityCurveMock: vi.fn(),
  getIngestProgressForRunMock: vi.fn(),
  getJobByRunIdMock: vi.fn(),
  getModelMetadataByRunIdMock: vi.fn(),
  getModelPredictionsByRunIdMock: vi.fn(),
  getPositionsByRunIdMock: vi.fn(),
  getReportByRunIdMock: vi.fn(),
  getRunByIdMock: vi.fn(),
}));

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));

vi.mock("@/components/status-badge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("@/components/run-detail/overview-tab", () => ({
  OverviewTab: () => <div>Overview tab</div>,
}));

vi.mock("@/components/run-detail/holdings-tab", () => ({
  HoldingsTab: () => <div>Holdings tab</div>,
}));

vi.mock("@/components/run-detail/trades-tab", () => ({
  TradesTab: () => <div>Trades tab</div>,
}));

vi.mock("@/components/run-detail/ml-insights-tab", () => ({
  MlInsightsTab: () => <div>ML insights tab</div>,
}));

vi.mock("@/components/run-detail/job-status-panel", () => ({
  JobStatusPanel: () => <div>Job status</div>,
}));

vi.mock("@/components/run-detail/run-status-poller", () => ({
  RunStatusPoller: () => <div>Poller</div>,
}));

vi.mock("@/components/run-detail/generate-report-button", () => ({
  GenerateReportButton: () => <button>Generate Report</button>,
}));

vi.mock("@/components/benchmark-overlap-warning", () => ({
  BenchmarkOverlapWarning: () => <div>Benchmark overlap</div>,
}));

vi.mock("@/components/run-delete-button", () => ({
  RunDeleteButton: () => <button>Delete</button>,
}));

vi.mock("@/components/run-detail/rerun-button", () => ({
  RerunButton: () => <button>Rerun</button>,
}));

vi.mock("@/lib/benchmark", () => ({
  getRunBenchmark: () => "SPY",
}));

vi.mock("@/lib/run-preflight-snapshot", () => ({
  getRunPreflightSnapshot: () => ({
    benchmarkCoverageHealth: null,
    dataCutoffUsed: null,
    universeEarliestStart: null,
  }),
}));

vi.mock("@/lib/supabase/queries", () => ({
  getBenchmarkOverlapStateForRun: queryMocks.getBenchmarkOverlapStateForRunMock,
  getEquityCurve: queryMocks.getEquityCurveMock,
  getIngestProgressForRun: queryMocks.getIngestProgressForRunMock,
  getJobByRunId: queryMocks.getJobByRunIdMock,
  getModelMetadataByRunId: queryMocks.getModelMetadataByRunIdMock,
  getModelPredictionsByRunId: queryMocks.getModelPredictionsByRunIdMock,
  getPositionsByRunId: queryMocks.getPositionsByRunIdMock,
  getReportByRunId: queryMocks.getReportByRunIdMock,
  getRunById: queryMocks.getRunByIdMock,
}));

import RunDetailPage from "@/app/(dashboard)/runs/[id]/page";

const RUN_ID = "123e4567-e89b-12d3-a456-426614174000";

function makeRun(status: string) {
  return {
    id: RUN_ID,
    name: `${status} run`,
    status,
    strategy_id: "equal_weight",
    benchmark: "SPY",
    benchmark_ticker: "SPY",
    universe: "ETF8",
    universe_symbols: ["SPY"],
    costs_bps: 10,
    top_n: 5,
    run_params: {},
    run_metadata: {},
    start_date: "2021-01-01",
    end_date: "2026-01-01",
    run_metrics: null,
  };
}

async function renderPage(status: string) {
  queryMocks.getRunByIdMock.mockResolvedValue(makeRun(status));
  render(await RunDetailPage({ params: Promise.resolve({ id: RUN_ID }) }));
}

describe("RunDetailPage artifact loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMocks.getBenchmarkOverlapStateForRunMock.mockResolvedValue({
      confirmed: false,
      possible: false,
    });
    queryMocks.getEquityCurveMock.mockResolvedValue([]);
    queryMocks.getIngestProgressForRunMock.mockResolvedValue(null);
    queryMocks.getJobByRunIdMock.mockResolvedValue(null);
    queryMocks.getModelMetadataByRunIdMock.mockResolvedValue(null);
    queryMocks.getModelPredictionsByRunIdMock.mockResolvedValue([]);
    queryMocks.getPositionsByRunIdMock.mockResolvedValue([]);
    queryMocks.getReportByRunIdMock.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps active run refreshes off the heavy artifact tables", async () => {
    await renderPage("running");

    expect(screen.getAllByText("running run")).toHaveLength(2);
    expect(queryMocks.getRunByIdMock).toHaveBeenCalledWith(RUN_ID);
    expect(queryMocks.getJobByRunIdMock).toHaveBeenCalledWith(RUN_ID);
    expect(queryMocks.getEquityCurveMock).not.toHaveBeenCalled();
    expect(queryMocks.getModelMetadataByRunIdMock).not.toHaveBeenCalled();
    expect(queryMocks.getModelPredictionsByRunIdMock).not.toHaveBeenCalled();
    expect(queryMocks.getPositionsByRunIdMock).not.toHaveBeenCalled();
    expect(queryMocks.getReportByRunIdMock).not.toHaveBeenCalled();
    expect(queryMocks.getBenchmarkOverlapStateForRunMock).not.toHaveBeenCalled();
  });

  it("loads full artifacts for completed runs", async () => {
    await renderPage("completed");

    expect(queryMocks.getEquityCurveMock).toHaveBeenCalledWith(RUN_ID);
    expect(queryMocks.getModelMetadataByRunIdMock).toHaveBeenCalledWith(RUN_ID);
    expect(queryMocks.getModelPredictionsByRunIdMock).toHaveBeenCalledWith(RUN_ID);
    expect(queryMocks.getPositionsByRunIdMock).toHaveBeenCalledWith(RUN_ID);
    expect(queryMocks.getReportByRunIdMock).toHaveBeenCalledWith(RUN_ID);
    expect(queryMocks.getBenchmarkOverlapStateForRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: RUN_ID })
    );
  });
});
