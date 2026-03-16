import { beforeEach, describe, expect, it, vi } from "vitest"

const { createClientMock, createAdminClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}))

import { getRunsBacktestWindowSummary } from "@/lib/supabase/queries"

type RunRow = {
  id: string
  name: string
  strategy_id: string
  status: "queued" | "running" | "completed" | "failed" | "blocked" | "waiting_for_data"
  start_date: string
  end_date: string
}

function makeRunsClient(runs: RunRow[]) {
  return {
    from(table: string) {
      if (table !== "runs") {
        throw new Error(`Unexpected table access: ${table}`)
      }

      return {
        select(_columns: string) {
          return {
            order: async (_column: string, _options: { ascending: boolean }) => ({
              data: runs,
              error: null,
            }),
          }
        },
      }
    },
  }
}

function makeAuditAdminClient(statsByRunId: Record<string, {
  count: number
  minDate: string | null
  maxDate: string | null
}>) {
  return {
    from(table: string) {
      if (table !== "equity_curve") {
        throw new Error(`Unexpected table access: ${table}`)
      }

      return {
        select(_columns: string, options?: { count?: string; head?: boolean }) {
          if (options?.head) {
            return {
              eq: async (_column: string, runId: string) => ({
                count: statsByRunId[runId]?.count ?? 0,
                error: null,
              }),
            }
          }

          const state = {
            runId: "",
            ascending: true,
          }

          const builder = {
            eq(_column: string, runId: string) {
              state.runId = runId
              return builder
            },
            order(_column: string, options: { ascending: boolean }) {
              state.ascending = options.ascending
              return builder
            },
            async limit(_limit: number) {
              const stats = statsByRunId[state.runId] ?? {
                count: 0,
                minDate: null,
                maxDate: null,
              }
              const date = state.ascending ? stats.minDate : stats.maxDate
              return {
                data: date ? [{ date }] : [],
                error: null,
              }
            },
          }

          return builder
        },
      }
    },
  }
}

describe("getRunsBacktestWindowSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("counts persisted equity rows for completed runs instead of returning 0 pts", async () => {
    createClientMock.mockResolvedValue(makeRunsClient([
      {
        id: "run-completed",
        name: "Completed run",
        strategy_id: "equal_weight",
        status: "completed",
        start_date: "2021-03-01",
        end_date: "2026-03-13",
      },
    ]))
    createAdminClientMock.mockReturnValue(makeAuditAdminClient({
      "run-completed": {
        count: 1256,
        minDate: "2021-03-15",
        maxDate: "2026-03-13",
      },
    }))

    const rows = await getRunsBacktestWindowSummary()

    expect(createAdminClientMock).toHaveBeenCalledTimes(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      run_id: "run-completed",
      status: "completed",
      data_points: 1256,
      equity_start_date: "2021-03-15",
      equity_end_date: "2026-03-13",
      meets_min_points: true,
      meets_min_span: true,
      audit_outcome: "pass",
    })
    expect(rows[0].data_points).toBeGreaterThan(0)
  })

  it("marks zero-row non-completed runs as skip instead of fail", async () => {
    createClientMock.mockResolvedValue(makeRunsClient([
      {
        id: "run-running",
        name: "Running run",
        strategy_id: "equal_weight",
        status: "running",
        start_date: "2024-01-01",
        end_date: "2026-03-13",
      },
    ]))
    createAdminClientMock.mockReturnValue(makeAuditAdminClient({
      "run-running": {
        count: 0,
        minDate: null,
        maxDate: null,
      },
    }))

    const rows = await getRunsBacktestWindowSummary()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      run_id: "run-running",
      status: "running",
      data_points: 0,
      audit_outcome: "skip",
    })
  })
})
