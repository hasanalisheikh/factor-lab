import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getActiveScheduledRefreshActivityMock,
  getAllTickerStatsMock,
  getDataHealthSummaryMock,
  getDataStateMock,
  getLatestDataIngestJobsMock,
  getMonitoredBenchmarkCoverageMock,
  getNotIngestedUniverseTickersMock,
  getRecentDataIngestJobHistoryMock,
  getRequiredTickerResearchSummaryMock,
  assessDataHealthMock,
  summarizeInceptionAwareCoverageMock,
} = vi.hoisted(() => ({
  getActiveScheduledRefreshActivityMock: vi.fn(),
  getAllTickerStatsMock: vi.fn(),
  getDataHealthSummaryMock: vi.fn(),
  getDataStateMock: vi.fn(),
  getLatestDataIngestJobsMock: vi.fn(),
  getMonitoredBenchmarkCoverageMock: vi.fn(),
  getNotIngestedUniverseTickersMock: vi.fn(),
  getRecentDataIngestJobHistoryMock: vi.fn(),
  getRequiredTickerResearchSummaryMock: vi.fn(),
  assessDataHealthMock: vi.fn(),
  summarizeInceptionAwareCoverageMock: vi.fn(),
}));

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({
    title,
    children,
    showDataDiagnosticsToggle = true,
  }: {
    title: string;
    children: React.ReactNode;
    showDataDiagnosticsToggle?: boolean;
  }) => (
    <div
      data-testid="app-shell"
      data-show-data-diagnostics-toggle={String(showDataDiagnosticsToggle)}
    >
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock("@/components/data/universe-tier-summary", () => ({
  UniverseTierSummary: () => <div>Universe Tier Summary</div>,
}));

vi.mock("@/components/data/top-missing-table", () => ({
  TopMissingTable: () => <div>Top Missing Table</div>,
}));

vi.mock("@/components/data/benchmark-coverage-card", () => ({
  BenchmarkCoverageCard: () => <div>Benchmark Coverage Card</div>,
}));

vi.mock("@/components/data/info-tooltip", () => ({
  InfoTooltip: () => null,
}));

vi.mock("@/lib/supabase/queries", () => ({
  getActiveScheduledRefreshActivity: getActiveScheduledRefreshActivityMock,
  getAllTickerStats: getAllTickerStatsMock,
  getDataHealthSummary: getDataHealthSummaryMock,
  getDataState: getDataStateMock,
  getLatestDataIngestJobs: getLatestDataIngestJobsMock,
  getMonitoredBenchmarkCoverage: getMonitoredBenchmarkCoverageMock,
  getNotIngestedUniverseTickers: getNotIngestedUniverseTickersMock,
  getRecentDataIngestJobHistory: getRecentDataIngestJobHistoryMock,
  getRequiredTickerResearchSummary: getRequiredTickerResearchSummaryMock,
}));

vi.mock("@/lib/data-health", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data-health")>("@/lib/data-health");
  return {
    ...actual,
    assessDataHealth: assessDataHealthMock,
    summarizeInceptionAwareCoverage: summarizeInceptionAwareCoverageMock,
  };
});

import DataPage from "@/app/(dashboard)/data/page";

const ORIGINAL_SHOW_INTERNAL_DATA_DIAGNOSTICS = process.env.SHOW_INTERNAL_DATA_DIAGNOSTICS;

function setDiagnosticsGate(value: string | undefined) {
  if (value === undefined) {
    delete process.env.SHOW_INTERNAL_DATA_DIAGNOSTICS;
    return;
  }
  process.env.SHOW_INTERNAL_DATA_DIAGNOSTICS = value;
}

async function renderDataPage(searchParams: Record<string, string | undefined> = {}) {
  render(await DataPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("DataPage diagnostics gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDataStateMock.mockResolvedValue({
      dataCutoffDate: "2026-04-08",
      nextMonthlyRefresh: "2026-05-01",
      dailyUpdatesEnabled: true,
      lastNoopCheckAt: null,
      lastUpdateAt: null,
    });
    getAllTickerStatsMock.mockResolvedValue([
      { ticker: "SPY", firstDate: "1993-01-29", lastDate: "2026-04-08", actualDays: 100 },
      { ticker: "QQQ", firstDate: "1999-03-10", lastDate: "2026-04-08", actualDays: 100 },
    ]);
    getActiveScheduledRefreshActivityMock.mockResolvedValue({
      monthlyActiveJobs: 0,
      dailyActiveJobs: 0,
    });
    getDataHealthSummaryMock.mockResolvedValue({
      tickersCount: 2,
      dateStart: "1993-01-29",
      dateEnd: "2026-04-08",
      businessDaysInWindow: 100,
      expectedTickerDays: 200,
      actualTickerDays: 200,
      missingTickerDays: 0,
      completenessPercent: 100,
      lastUpdatedAt: null,
    });
    getRequiredTickerResearchSummaryMock.mockResolvedValue({
      rows: [
        {
          ticker: "SPY",
          researchStart: "2004-11-18",
          researchEnd: "2026-04-08",
          expectedDays: 100,
          actualDays: 100,
          trueMissingDays: 0,
          coveragePercent: 100,
          maxGapDays: 0,
          firstObservedDate: "2004-11-18",
          lastObservedDate: "2026-04-08",
          isBenchmark: true,
          isIngested: true,
        },
      ],
      requiredTickers: ["SPY"],
      notIngestedTickers: [],
      ingestedTickers: 1,
      completeness: 100,
      totalExpected: 100,
      totalActual: 100,
      totalTrueMissing: 0,
      trueMissingRate: 0,
      marketCalendarDays: 100,
    });
    getMonitoredBenchmarkCoverageMock.mockResolvedValue([
      {
        ticker: "SPY",
        actualDays: 100,
        expectedDays: 100,
        missingDays: 0,
        coveragePercent: 100,
        trueMissingRate: 0,
        windowStart: "2004-11-18",
        windowEnd: "2026-04-08",
        latestDate: "2026-04-08",
        earliestDate: "1993-01-29",
        needsHistoricalBackfill: false,
        status: "ok",
      },
    ]);
    getNotIngestedUniverseTickersMock.mockResolvedValue([]);
    getLatestDataIngestJobsMock.mockResolvedValue({});
    getRecentDataIngestJobHistoryMock.mockResolvedValue([]);
    assessDataHealthMock.mockReturnValue({
      status: "GOOD",
      reason: "Reason: all monitored metrics are within good thresholds.",
    });
    summarizeInceptionAwareCoverageMock.mockReturnValue({
      rows: [],
      completeness: 100,
      totalExpected: 100,
      totalActual: 100,
      totalTrueMissing: 0,
      totalPreInception: 0,
      trueMissingRate: 0,
    });
  });

  afterEach(() => {
    cleanup();
    if (ORIGINAL_SHOW_INTERNAL_DATA_DIAGNOSTICS === undefined) {
      delete process.env.SHOW_INTERNAL_DATA_DIAGNOSTICS;
    } else {
      process.env.SHOW_INTERNAL_DATA_DIAGNOSTICS = ORIGINAL_SHOW_INTERNAL_DATA_DIAGNOSTICS;
    }
  });

  it("forces the public data page into backtest-ready mode when the gate is off", async () => {
    setDiagnosticsGate(undefined);

    await renderDataPage({ mode: "full", diagnostics: "1" });

    expect(screen.getByTestId("app-shell")).toHaveAttribute(
      "data-show-data-diagnostics-toggle",
      "false"
    );
    expect(screen.queryByText("Advanced")).not.toBeInTheDocument();
    expect(screen.queryByText("Ingestion Job History")).not.toBeInTheDocument();
    expect(screen.queryByText("Benchmark Coverage Card")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Backtest-ready: required tickers are fully covered/i)
    ).toBeInTheDocument();
    expect(summarizeInceptionAwareCoverageMock).not.toHaveBeenCalled();
    expect(getLatestDataIngestJobsMock).not.toHaveBeenCalled();
    expect(getRecentDataIngestJobHistoryMock).not.toHaveBeenCalled();
  });

  it("preserves advanced diagnostics when the internal gate is on", async () => {
    setDiagnosticsGate("true");

    await renderDataPage({ mode: "full", diagnostics: "1" });

    expect(screen.getByTestId("app-shell")).toHaveAttribute(
      "data-show-data-diagnostics-toggle",
      "true"
    );
    expect(screen.getByText(/Advanced expands into DB-wide coverage/i)).toBeInTheDocument();
    expect(screen.getByText("Ingestion Job History")).toBeInTheDocument();
    expect(screen.getByText("Benchmark Coverage Card")).toBeInTheDocument();
    expect(summarizeInceptionAwareCoverageMock).toHaveBeenCalledTimes(1);
    expect(getLatestDataIngestJobsMock).toHaveBeenCalledTimes(1);
    expect(getRecentDataIngestJobHistoryMock).toHaveBeenCalledTimes(1);
  });
});
