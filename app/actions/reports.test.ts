import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REPORT_URL = "https://reports.example/run-1/tearsheet.html";

const {
  buildReportHtmlMock,
  buildReportStoragePathMock,
  buildTurnoverSummaryFromPositionsMock,
  createAdminClientMock,
  createClientMock,
  fetchAllEquityCurveMock,
  getBenchmarkOverlapStateForRunMock,
  getPositionsByRunIdMock,
  getPublicUrlMock,
  getRunBenchmarkMock,
  getTurnoverPeriodsPerYearMock,
  metricsMaybeSingleMock,
  parseRunMetadataMock,
  positionsLimitMock,
  reportsMaybeSingleMock,
  resolveReportsBucketNameMock,
  revalidatePathMock,
  runMaybeSingleMock,
  uploadMock,
  upsertMock,
} = vi.hoisted(() => ({
  buildReportHtmlMock: vi.fn(),
  buildReportStoragePathMock: vi.fn(),
  buildTurnoverSummaryFromPositionsMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  createClientMock: vi.fn(),
  fetchAllEquityCurveMock: vi.fn(),
  getBenchmarkOverlapStateForRunMock: vi.fn(),
  getPositionsByRunIdMock: vi.fn(),
  getPublicUrlMock: vi.fn(),
  getRunBenchmarkMock: vi.fn(),
  getTurnoverPeriodsPerYearMock: vi.fn(),
  metricsMaybeSingleMock: vi.fn(),
  parseRunMetadataMock: vi.fn(),
  positionsLimitMock: vi.fn(),
  reportsMaybeSingleMock: vi.fn(),
  resolveReportsBucketNameMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  runMaybeSingleMock: vi.fn(),
  uploadMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

vi.mock("@/lib/supabase/queries", () => ({
  fetchAllEquityCurve: fetchAllEquityCurveMock,
  getBenchmarkOverlapStateForRun: getBenchmarkOverlapStateForRunMock,
  getPositionsByRunId: getPositionsByRunIdMock,
}));

vi.mock("@/lib/benchmark", () => ({
  getRunBenchmark: getRunBenchmarkMock,
}));

vi.mock("@/lib/report-builder", () => ({
  buildReportHtml: buildReportHtmlMock,
  parseRunMetadata: parseRunMetadataMock,
}));

vi.mock("@/lib/storage", () => ({
  buildReportStoragePath: buildReportStoragePathMock,
  resolveReportsBucketName: resolveReportsBucketNameMock,
}));

vi.mock("@/lib/turnover", () => ({
  buildTurnoverSummaryFromPositions: buildTurnoverSummaryFromPositionsMock,
  getTurnoverPeriodsPerYear: getTurnoverPeriodsPerYearMock,
}));

import { ensureRunReport, generateRunReport } from "@/app/actions/reports";

type ServerClientOptions = {
  reportRow?: { url: string } | null;
  user?: { id: string } | null;
};

function makeFormData(runId = "run-1") {
  const formData = new FormData();
  formData.set("runId", runId);
  return formData;
}

function makeServerClient(options?: ServerClientOptions) {
  const reportRow = options?.reportRow ?? null;
  const user = options?.user === undefined ? { id: "user-1" } : options.user;

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
    },
    from(table: string) {
      if (table === "reports") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: reportsMaybeSingleMock.mockResolvedValueOnce({
                    data: reportRow,
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }

      if (table === "runs") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: runMaybeSingleMock,
                };
              },
            };
          },
        };
      }

      if (table === "run_metrics") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: metricsMaybeSingleMock,
                };
              },
            };
          },
        };
      }

      if (table === "positions") {
        const query = {
          eq: vi.fn(() => query),
          gt: vi.fn(() => query),
          limit: positionsLimitMock,
        };

        return {
          select() {
            return query;
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function makeAdminClient() {
  return {
    storage: {
      from() {
        return {
          upload: uploadMock,
          getPublicUrl: getPublicUrlMock,
        };
      },
    },
    from(table: string) {
      if (table === "reports") {
        return {
          upsert: upsertMock,
        };
      }

      throw new Error(`Unexpected admin table: ${table}`);
    },
  };
}

function makeRunRow() {
  return {
    id: "run-1",
    name: "Momentum run",
    strategy_id: "equal_weight",
    start_date: "2021-01-01",
    end_date: "2021-12-31",
    universe: "ETF8",
    universe_symbols: ["SPY", "QQQ"],
    costs_bps: 10,
    top_n: 10,
    run_params: {},
    run_metadata: {},
    status: "completed",
  };
}

function makeMetricsRow() {
  return {
    run_id: "run-1",
    cagr: 0.1,
    sharpe: 1.1,
  };
}

describe("reports actions", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    createClientMock.mockResolvedValue(makeServerClient());
    createAdminClientMock.mockReturnValue(makeAdminClient());

    runMaybeSingleMock.mockResolvedValue({
      data: makeRunRow(),
      error: null,
    });
    metricsMaybeSingleMock.mockResolvedValue({
      data: makeMetricsRow(),
      error: null,
    });
    positionsLimitMock.mockResolvedValue({
      data: [],
      error: null,
    });
    fetchAllEquityCurveMock.mockResolvedValue([
      { id: "eq-1", run_id: "run-1", date: "2021-01-04", portfolio: 100000, benchmark: 100000 },
    ]);
    getPositionsByRunIdMock.mockResolvedValue([]);
    getBenchmarkOverlapStateForRunMock.mockResolvedValue({ confirmed: false });
    getRunBenchmarkMock.mockReturnValue("SPY");
    buildTurnoverSummaryFromPositionsMock.mockReturnValue({ turnoverAnnualizedOneWay: null });
    getTurnoverPeriodsPerYearMock.mockReturnValue(12);
    parseRunMetadataMock.mockReturnValue({});
    buildReportHtmlMock.mockReturnValue("<html>report</html>");
    resolveReportsBucketNameMock.mockReturnValue("reports");
    buildReportStoragePathMock.mockReturnValue("run-1/tearsheet.html");
    uploadMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({
      data: { publicUrl: REPORT_URL },
    });
    upsertMock.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("returns an existing report URL without rebuilding", async () => {
    createClientMock.mockResolvedValue(
      makeServerClient({
        reportRow: { url: REPORT_URL },
      })
    );

    const result = await ensureRunReport("run-1");

    expect(result).toBe(REPORT_URL);
    expect(runMaybeSingleMock).not.toHaveBeenCalled();
    expect(metricsMaybeSingleMock).not.toHaveBeenCalled();
    expect(fetchAllEquityCurveMock).not.toHaveBeenCalled();
    expect(buildReportHtmlMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("returns success with the report URL and revalidates the runs pages", async () => {
    const result = await generateRunReport(null, makeFormData("run-1"));

    expect(result).toEqual({ success: true, url: REPORT_URL });
    expect(buildReportHtmlMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith(
      "run-1/tearsheet.html",
      expect.any(Blob),
      expect.objectContaining({
        upsert: true,
        contentType: "text/html; charset=utf-8",
      })
    );
    expect(upsertMock).toHaveBeenCalledWith(
      {
        run_id: "run-1",
        storage_path: "run-1/tearsheet.html",
        url: REPORT_URL,
      },
      { onConflict: "run_id" }
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/runs");
    expect(revalidatePathMock).toHaveBeenCalledWith("/runs/run-1");
  });

  it("returns failure state when report generation throws", async () => {
    createClientMock.mockResolvedValue(
      makeServerClient({
        user: null,
      })
    );

    const result = await generateRunReport(null, makeFormData("run-1"));

    expect(result).toEqual({
      success: false,
      error: "Authentication required.",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
