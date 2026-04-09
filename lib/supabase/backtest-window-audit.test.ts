import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, createAdminClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import { getRunsBacktestWindowSummary } from "@/lib/supabase/queries";

type RunRow = {
  id: string;
  name: string;
  strategy_id: string;
  status: "queued" | "running" | "completed" | "failed" | "blocked" | "waiting_for_data";
  start_date: string;
  end_date: string;
};

function makeRunsClient(runs: RunRow[]) {
  return {
    from(table: string) {
      if (table !== "runs") {
        throw new Error(`Unexpected table access: ${table}`);
      }

      return {
        select(_columns: string) {
          let filteredRuns = [...runs];
          return {
            eq(column: string, value: string) {
              if (column === "status") {
                filteredRuns = filteredRuns.filter((run) => run.status === value);
              }
              return this;
            },
            order: async (_column: string, _options: { ascending: boolean }) => ({
              data: filteredRuns,
              error: null,
            }),
          };
        },
      };
    },
  };
}

/**
 * Generates synthetic equity_curve rows for the batch `.in()` query.
 * Each run gets `count` rows with the correct min/max dates in position 0 and count-1.
 */
function makeEquityCurveRows(
  statsByRunId: Record<string, { count: number; minDate: string | null; maxDate: string | null }>
) {
  const rows: Array<{ run_id: string; date: string }> = [];
  for (const [runId, stats] of Object.entries(statsByRunId)) {
    if (stats.count === 0 || stats.minDate === null || stats.maxDate === null) continue;
    rows.push({ run_id: runId, date: stats.minDate });
    for (let i = 1; i < stats.count - 1; i++) {
      // Middle rows — date value is not meaningful for the test, just needs to sort between min/max.
      rows.push({ run_id: runId, date: "2023-06-01" });
    }
    if (stats.count > 1) {
      rows.push({ run_id: runId, date: stats.maxDate });
    }
  }
  return rows;
}

function makeAuditAdminClient(
  statsByRunId: Record<
    string,
    {
      count: number;
      minDate: string | null;
      maxDate: string | null;
    }
  >
) {
  const allRows = makeEquityCurveRows(statsByRunId);

  return {
    from(table: string) {
      if (table !== "equity_curve") {
        throw new Error(`Unexpected table access: ${table}`);
      }

      return {
        select(_columns: string) {
          return {
            in: async (_column: string, _runIds: string[]) => ({
              data: allRows,
              error: null,
            }),
          };
        },
      };
    },
  };
}

describe("getRunsBacktestWindowSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts persisted equity rows for completed runs instead of returning 0 pts", async () => {
    createClientMock.mockResolvedValue(
      makeRunsClient([
        {
          id: "run-completed",
          name: "Completed run",
          strategy_id: "equal_weight",
          status: "completed",
          start_date: "2021-03-01",
          end_date: "2026-03-13",
        },
      ])
    );
    createAdminClientMock.mockReturnValue(
      makeAuditAdminClient({
        "run-completed": {
          count: 1256,
          minDate: "2021-03-15",
          maxDate: "2026-03-13",
        },
      })
    );

    const rows = await getRunsBacktestWindowSummary();

    expect(createAdminClientMock).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      run_id: "run-completed",
      status: "completed",
      data_points: 1256,
      equity_start_date: "2021-03-15",
      equity_end_date: "2026-03-13",
      meets_min_points: true,
      meets_min_span: true,
      audit_outcome: "pass",
    });
    expect(rows[0].data_points).toBeGreaterThan(0);
  });

  it("excludes non-completed runs from the audit summary", async () => {
    createClientMock.mockResolvedValue(
      makeRunsClient([
        {
          id: "run-running",
          name: "Running run",
          strategy_id: "equal_weight",
          status: "running",
          start_date: "2024-01-01",
          end_date: "2026-03-13",
        },
      ])
    );
    createAdminClientMock.mockReturnValue(
      makeAuditAdminClient({
        "run-running": {
          count: 0,
          minDate: null,
          maxDate: null,
        },
      })
    );

    const rows = await getRunsBacktestWindowSummary();

    expect(rows).toHaveLength(0);
  });

  it("keeps completed legacy zero-row runs as internal failures", async () => {
    createClientMock.mockResolvedValue(
      makeRunsClient([
        {
          id: "run-legacy",
          name: "Legacy run",
          strategy_id: "equal_weight",
          status: "completed",
          start_date: "2021-03-01",
          end_date: "2026-03-13",
        },
      ])
    );
    createAdminClientMock.mockReturnValue(
      makeAuditAdminClient({
        "run-legacy": {
          count: 0,
          minDate: null,
          maxDate: null,
        },
      })
    );

    const rows = await getRunsBacktestWindowSummary();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      run_id: "run-legacy",
      status: "completed",
      data_points: 0,
      requested_span_days: 1838,
      span_days: 0,
      equity_span_days: null,
      audit_outcome: "fail",
    });
  });

  it("uses actual equity coverage span for truncated completed runs", async () => {
    createClientMock.mockResolvedValue(
      makeRunsClient([
        {
          id: "run-truncated",
          name: "Truncated run",
          strategy_id: "equal_weight",
          status: "completed",
          start_date: "2021-03-01",
          end_date: "2026-03-13",
        },
      ])
    );
    createAdminClientMock.mockReturnValue(
      makeAuditAdminClient({
        "run-truncated": {
          count: 1044,
          minDate: "2021-03-15",
          maxDate: "2025-03-28",
        },
      })
    );

    const rows = await getRunsBacktestWindowSummary();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      run_id: "run-truncated",
      status: "completed",
      requested_span_days: 1838,
      span_days: 1474,
      equity_span_days: 1474,
      equity_end_date: "2025-03-28",
      meets_min_points: true,
      meets_min_span: true,
      meets_end_tolerance: false,
      audit_outcome: "fail",
    });
    expect(rows[0].requested_span_days).toBeGreaterThan(rows[0].span_days);
  });
});
