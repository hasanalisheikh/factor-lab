import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RunPreflightSnapshot } from "@/lib/coverage-check"
import type { UniverseConstraintsSnapshot } from "@/lib/supabase/queries"

const {
  createClientMock,
  createAdminClientMock,
  getUniverseConstraintsSnapshotMock,
  getUniverseBatchStatusMock,
  evaluateRunPreflightSnapshotMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  getUniverseConstraintsSnapshotMock: vi.fn(),
  getUniverseBatchStatusMock: vi.fn(),
  evaluateRunPreflightSnapshotMock: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock("@/lib/supabase/queries", () => ({
  getUniverseConstraintsSnapshot: getUniverseConstraintsSnapshotMock,
  getUniverseBatchStatus: getUniverseBatchStatusMock,
}))

vi.mock("@/lib/coverage-check", async () => {
  const actual = await vi.importActual<typeof import("@/lib/coverage-check")>("@/lib/coverage-check")
  return {
    ...actual,
    evaluateRunPreflightSnapshot: evaluateRunPreflightSnapshotMock,
  }
})

import { createRun, preflightRun } from "@/app/actions/runs"

const BASE_CONSTRAINTS: UniverseConstraintsSnapshot = {
  universe: "ETF8",
  universeEarliestStart: "2004-11-18",
  universeValidFrom: "2004-11-18",
  missingTickers: [],
  ingestedCount: 8,
  totalCount: 8,
  ready: true,
  dataCutoffDate: "2026-03-12",
}

function makeSnapshot(options?: {
  minStartDate?: string
  maxEndDate?: string
  benchmarkFirstDate?: string | null
  benchmarkMissingRate?: number
  universeFirstDates?: Record<string, string | null>
  universeMissingRates?: Record<string, number>
  missingTickers?: string[]
  requiredStart?: string
  requiredEnd?: string
  symbols?: string[]
}): RunPreflightSnapshot {
  const {
    minStartDate = "2004-11-18",
    maxEndDate = "2026-03-12",
    benchmarkFirstDate = "2000-01-03",
    benchmarkMissingRate = 0,
    universeFirstDates = {},
    universeMissingRates = {},
    missingTickers = [],
    requiredStart = "2019-01-01",
    requiredEnd = "2026-03-12",
    symbols = ["SPY", "QQQ", "IWM", "TLT", "GLD", "VNQ", "EFA", "EEM", "SPY"],
  } = options ?? {}

  const uniqueSymbols = [...new Set(symbols)]
  const coverageSymbols = uniqueSymbols.map((symbol) => {
    const isBenchmark = symbol === "SPY"
    const firstDate = isBenchmark
      ? benchmarkFirstDate
      : universeFirstDates[symbol] ?? "2000-01-03"
    const trueMissingRate = isBenchmark
      ? benchmarkMissingRate
      : universeMissingRates[symbol] ?? 0
    const expectedDays = firstDate ? 100 : 0
    const trueMissingDays = expectedDays > 0 ? Math.round(expectedDays * trueMissingRate) : 0
    const actualDays = expectedDays - trueMissingDays

    return {
      symbol,
      isBenchmark,
      firstDate,
      lastDate: firstDate ? maxEndDate : null,
      expectedDays,
      actualDays,
      trueMissingDays,
      trueMissingRate,
    }
  })

  return {
    constraints: {
      dataCutoffDate: maxEndDate,
      universeEarliestStart: BASE_CONSTRAINTS.universeEarliestStart,
      universeValidFrom: BASE_CONSTRAINTS.universeValidFrom,
      minStartDate,
      maxEndDate,
      missingTickers,
    },
    coverage: {
      benchmark: {
        status: benchmarkMissingRate > 0.02 ? "blocked" : benchmarkMissingRate > 0 ? "warning" : "good",
        reason: null,
        trueMissingRate: benchmarkMissingRate,
        symbol: "SPY",
      },
      universe: {
        status: "good",
        reason: null,
        over2Percent: [],
        over10Percent: [],
        affectedShare: 0,
      },
      symbols: coverageSymbols,
    },
    requiredStart,
    requiredEnd,
  }
}

function makeAuthenticatedClient(userId = "user-1") {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: { id: userId },
        },
      }),
    },
  }
}

function makeAdminStub() {
  const runInsertPayloads: Record<string, unknown>[] = []
  const jobInsertPayloads: Record<string, unknown>[] = []

  return {
    runInsertPayloads,
    jobInsertPayloads,
    from(table: string) {
      if (table === "runs") {
        return {
          insert: (payload: Record<string, unknown>) => {
            runInsertPayloads.push(payload)
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "run-123" },
                  error: null,
                }),
              }),
            }
          },
        }
      }

      if (table === "jobs") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            jobInsertPayloads.push(payload)
            return { error: null }
          },
        }
      }

      throw new Error(`Unexpected table access in test: ${table}`)
    },
  }
}

function makeRepairAdminStub() {
  const dataIngestRows: Record<string, unknown>[] = []

  return {
    dataIngestRows,
    from(table: string) {
      if (table === "data_ingest_jobs") {
        return {
          select: () => ({
            in: () => ({
              in: () => ({
                order: async () => ({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
          insert: async (rows: Record<string, unknown>[]) => {
            dataIngestRows.push(...rows)
            return { error: null }
          },
        }
      }

      throw new Error(`Unexpected repair-table access in test: ${table}`)
    },
  }
}

describe("run actions preflight gating", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()

    createClientMock.mockResolvedValue(makeAuthenticatedClient())
    createAdminClientMock.mockReturnValue(makeAdminStub())
    getUniverseConstraintsSnapshotMock.mockResolvedValue(BASE_CONSTRAINTS)
    getUniverseBatchStatusMock.mockResolvedValue(null)
    evaluateRunPreflightSnapshotMock.mockResolvedValue(makeSnapshot())
  })

  it("preflight blocks invalid date ranges with clear clamp actions", async () => {
    evaluateRunPreflightSnapshotMock.mockResolvedValue(
      makeSnapshot({
        minStartDate: "2004-11-18",
        maxEndDate: "2026-03-12",
      })
    )

    const result = await preflightRun({
      name: "Invalid dates",
      strategy_id: "equal_weight",
      start_date: "2004-01-01",
      end_date: "2026-03-20",
      benchmark: "SPY",
      universe: "ETF8",
      costs_bps: 10,
      top_n: 5,
      initial_capital: 100000,
      apply_costs: true,
      slippage_bps: 0,
    })

    expect(result.status).toBe("block")
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "start_before_universe_min",
      "end_after_cutoff",
    ])
    expect(result.issues.map((issue) => issue.action?.kind)).toEqual([
      "clamp_start_date",
      "clamp_end_date",
    ])
  })

  it("preflight blocks ML runs with insufficient training history and includes diagnostics", async () => {
    vi.stubEnv("ML_MIN_TRAIN_DAYS", "252")
    vi.stubEnv("ML_TRAIN_WINDOW_DAYS", "504")

    evaluateRunPreflightSnapshotMock.mockResolvedValue(
      makeSnapshot({
        benchmarkFirstDate: "2023-12-15",
        universeFirstDates: {
          QQQ: "2021-01-01",
          IWM: "2021-01-01",
          TLT: "2021-01-01",
          GLD: "2021-01-01",
          VNQ: "2021-01-01",
          EFA: "2021-01-01",
          EEM: "2021-01-01",
        },
        requiredStart: "2022-01-01",
      })
    )

    const result = await preflightRun({
      name: "ML too short",
      strategy_id: "ml_ridge",
      start_date: "2024-02-01",
      end_date: "2026-03-12",
      benchmark: "SPY",
      universe: "ETF8",
      costs_bps: 10,
      top_n: 5,
      initial_capital: 100000,
      apply_costs: true,
      slippage_bps: 0,
    })

    expect(result.status).toBe("block")
    expect(result.issues[0]?.code).toBe("ml_insufficient_training_history")
    expect(result.issues[0]?.reason).toContain("train days")
    expect(result.issues[0]?.fix).toContain("reduce Top N")
  })

  it("preflight starts universe repairs and blocks queueing until missing data is ready", async () => {
    const repairAdmin = makeRepairAdminStub()
    createAdminClientMock.mockReturnValue(repairAdmin)
    getUniverseConstraintsSnapshotMock.mockResolvedValue({
      ...BASE_CONSTRAINTS,
      ready: false,
      missingTickers: ["QQQ"],
      ingestedCount: 7,
    })
    evaluateRunPreflightSnapshotMock.mockResolvedValue(
      makeSnapshot({
        missingTickers: ["QQQ"],
        symbols: ["SPY", "QQQ", "IWM", "TLT", "GLD", "VNQ", "EFA", "EEM"],
        universeFirstDates: {
          QQQ: null,
        },
      })
    )

    const result = await preflightRun({
      name: "Missing data repair",
      strategy_id: "equal_weight",
      start_date: "2018-01-01",
      end_date: "2026-03-12",
      benchmark: "SPY",
      universe: "ETF8",
      costs_bps: 10,
      top_n: 5,
      initial_capital: 100000,
      apply_costs: true,
      slippage_bps: 0,
    })

    expect(result.status).toBe("block")
    expect(result.issues[0]?.code).toBe("universe_missing_data_repair_started")
    expect(result.issues[0]?.reason).toContain("We're downloading it now")
    expect(repairAdmin.dataIngestRows).toHaveLength(1)
    expect(repairAdmin.dataIngestRows[0]).toMatchObject({
      symbol: "QQQ",
      status: "queued",
      end_date: "2026-03-12",
    })
  })

  it("preflight blocks top_n above universe size with a one-click fix", async () => {
    const result = await preflightRun({
      name: "Top N too high",
      strategy_id: "low_vol",
      start_date: "2018-01-01",
      end_date: "2026-03-12",
      benchmark: "SPY",
      universe: "ETF8",
      costs_bps: 10,
      top_n: 12,
      initial_capital: 100000,
      apply_costs: true,
      slippage_bps: 0,
    })

    expect(result.status).toBe("block")
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({
      code: "top_n_above_universe_size",
      action: {
        kind: "set_top_n",
        value: 8,
      },
    })
  })

  it("createRun rechecks preflight and refuses inserts when blocked", async () => {
    evaluateRunPreflightSnapshotMock.mockResolvedValue(
      makeSnapshot({
        maxEndDate: "2026-03-12",
      })
    )

    const result = await createRun({
      name: "Blocked create",
      strategy_id: "equal_weight",
      start_date: "2018-01-01",
      end_date: "2026-03-20",
      benchmark: "SPY",
      universe: "ETF8",
      costs_bps: 10,
      top_n: 5,
      initial_capital: 100000,
      apply_costs: true,
      slippage_bps: 0,
      acknowledge_warnings: false,
    })

    expect(result.ok).toBe(false)
    expect(result.preflight?.status).toBe("block")
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it("warn acknowledgement gates creation and marks executed_with_missing_data", async () => {
    const admin = makeAdminStub()
    createAdminClientMock.mockReturnValue(admin)
    evaluateRunPreflightSnapshotMock.mockResolvedValue(
      makeSnapshot({
        benchmarkMissingRate: 0.01,
      })
    )

    const blockedWithoutAck = await createRun({
      name: "Warn no ack",
      strategy_id: "equal_weight",
      start_date: "2018-01-01",
      end_date: "2026-03-12",
      benchmark: "SPY",
      universe: "ETF8",
      costs_bps: 10,
      top_n: 5,
      initial_capital: 100000,
      apply_costs: true,
      slippage_bps: 0,
      acknowledge_warnings: false,
    })

    expect(blockedWithoutAck.ok).toBe(false)
    expect(blockedWithoutAck.preflight?.status).toBe("warn")
    expect(admin.runInsertPayloads).toHaveLength(0)

    const createdWithAck = await createRun({
      name: "Warn acked",
      strategy_id: "equal_weight",
      start_date: "2018-01-01",
      end_date: "2026-03-12",
      benchmark: "SPY",
      universe: "ETF8",
      costs_bps: 10,
      top_n: 5,
      initial_capital: 100000,
      apply_costs: true,
      slippage_bps: 0,
      acknowledge_warnings: true,
    })

    expect(createdWithAck.ok).toBe(true)
    expect(admin.runInsertPayloads).toHaveLength(1)
    expect(admin.runInsertPayloads[0]).toMatchObject({
      status: "queued",
      executed_with_missing_data: true,
    })
    expect(admin.jobInsertPayloads).toHaveLength(1)
  })
})
