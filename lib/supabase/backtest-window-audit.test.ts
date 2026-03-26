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
          return {
            order: async (_column: string, _options: { ascending: boolean }) => ({
              data: runs,
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

  it("marks zero-row non-completed runs as skip instead of fail", async () => {
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

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      run_id: "run-running",
      status: "running",
      data_points: 0,
      audit_outcome: "skip",
    });
  });
});
