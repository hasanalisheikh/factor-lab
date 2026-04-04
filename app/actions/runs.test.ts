import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunPreflightSnapshot } from "@/lib/coverage-check";
import type { UniverseConstraintsSnapshot } from "@/lib/supabase/queries";

const {
  createClientMock,
  createAdminClientMock,
  getUniverseConstraintsSnapshotMock,
  getUniverseBatchStatusMock,
  evaluateRunPreflightSnapshotMock,
  redirectMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  getUniverseConstraintsSnapshotMock: vi.fn(),
  getUniverseBatchStatusMock: vi.fn(),
  evaluateRunPreflightSnapshotMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
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
  getUniverseConstraintsSnapshot: getUniverseConstraintsSnapshotMock,
  getUniverseBatchStatus: getUniverseBatchStatusMock,
}));

vi.mock("@/lib/coverage-check", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/coverage-check")>("@/lib/coverage-check");
  return {
    ...actual,
    evaluateRunPreflightSnapshot: evaluateRunPreflightSnapshotMock,
  };
});

import { createRun, deleteRunAction, preflightRun } from "@/app/actions/runs";
import { getLastCompleteTradingDayUtc } from "@/lib/data-cutoff";

const BASE_CONSTRAINTS: UniverseConstraintsSnapshot = {
  universe: "ETF8",
  universeEarliestStart: "2004-11-18",
  universeValidFrom: "2004-11-18",
  missingTickers: [],
  ingestedCount: 8,
  totalCount: 8,
  ready: true,
  dataCutoffDate: "2026-03-12",
};

function makeSnapshot(options?: {
  minStartDate?: string;
  maxEndDate?: string;
  benchmarkFirstDate?: string | null;
  benchmarkMissingRate?: number;
  universeFirstDates?: Record<string, string | null>;
  universeMissingRates?: Record<string, number>;
  missingTickers?: string[];
  warmupStart?: string;
  requiredStart?: string;
  requiredEnd?: string;
  symbols?: string[];
  benchmarkCandidates?: Array<{
    symbol: string;
    status: "ok" | "warn" | "block";
    benchmarkTrueMissingRate: number;
    affectedShare: number;
  }>;
}): RunPreflightSnapshot {
  const {
    minStartDate = "2004-11-18",
    maxEndDate = "2026-03-12",
    benchmarkFirstDate = "2000-01-03",
    benchmarkMissingRate = 0,
    universeFirstDates = {},
    universeMissingRates = {},
    missingTickers = [],
    warmupStart = "2018-01-01",
    requiredStart = "2019-01-01",
    requiredEnd = "2026-03-12",
    symbols = ["SPY", "QQQ", "IWM", "TLT", "GLD", "VNQ", "EFA", "EEM", "SPY"],
    benchmarkCandidates = [],
  } = options ?? {};

  const uniqueSymbols = [...new Set(symbols)];
  const coverageSymbols = uniqueSymbols.map((symbol) => {
    const isBenchmark = symbol === "SPY";
    const firstDate = isBenchmark
      ? benchmarkFirstDate
      : (universeFirstDates[symbol] ?? "2000-01-03");
    const trueMissingRate = isBenchmark
      ? benchmarkMissingRate
      : (universeMissingRates[symbol] ?? 0);
    const expectedDays = firstDate ? 100 : 0;
    const trueMissingDays = expectedDays > 0 ? Math.round(expectedDays * trueMissingRate) : 0;
    const actualDays = expectedDays - trueMissingDays;

    return {
      symbol,
      isBenchmark,
      firstDate,
      lastDate: firstDate ? maxEndDate : null,
      windowStart: firstDate ? (firstDate > warmupStart ? firstDate : warmupStart) : null,
      expectedDays,
      actualDays,
      trueMissingDays,
      trueMissingRate,
    };
  });

  return {
    constraints: {
      dataCutoffDate: maxEndDate,
      universeEarliestStart: BASE_CONSTRAINTS.universeEarliestStart,
      universeValidFrom: BASE_CONSTRAINTS.universeValidFrom,
      minStartDate,
      maxEndDate,
      missingTickers,
      warmupStart,
      requiredStart,
      requiredEnd,
    },
    coverage: {
      benchmark: {
        status:
          benchmarkMissingRate > 0.1 ? "blocked" : benchmarkMissingRate > 0.02 ? "warning" : "good",
        reason:
          benchmarkMissingRate > 0.1
            ? `SPY missingness is ${(benchmarkMissingRate * 100).toFixed(1)}% over ${warmupStart} -> ${requiredEnd} (source: run_window) (10.0% max allowed).`
            : benchmarkMissingRate > 0.02
              ? `SPY missingness is ${(benchmarkMissingRate * 100).toFixed(1)}% over ${warmupStart} -> ${requiredEnd} (source: run_window) (2.0% good threshold, 10.0% block threshold).`
              : null,
        metricSourceUsed: "run_window",
        trueMissingRate: benchmarkMissingRate,
        symbol: "SPY",
        windowStartUsed: warmupStart,
        windowEndUsed: requiredEnd,
        expectedDays: 100,
        actualDays: 100 - Math.round(100 * benchmarkMissingRate),
        missingDays: Math.round(100 * benchmarkMissingRate),
      },
      universe: {
        status: "good",
        reason: null,
        over2Percent: [],
        over10Percent: [],
        affectedShare: 0,
      },
      symbols: coverageSymbols,
      benchmarkCandidates,
    },
    warmupStart,
    requiredStart,
    requiredEnd,
  };
}

function makeAuthenticatedClient(userId = "user-1") {
  const runInsertPayloads: Record<string, unknown>[] = [];
  const jobInsertPayloads: Record<string, unknown>[] = [];
  const deletedRunIds: string[] = [];

  return {
    runInsertPayloads,
    jobInsertPayloads,
    deletedRunIds,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: { id: userId },
        },
      }),
    },
    from(table: string) {
      if (table === "runs") {
        return {
          insert: (payload: Record<string, unknown>) => {
            runInsertPayloads.push(payload);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "run-123" },
                  error: null,
                }),
              }),
            };
          },
          delete: () => ({
            eq: async (_column: string, id: string) => {
              deletedRunIds.push(id);
              return { error: null };
            },
          }),
        };
      }

      if (table === "jobs") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            jobInsertPayloads.push(payload);
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected authenticated table access in test: ${table}`);
    },
  };
}

function makeAdminStub() {
  const runInsertPayloads: Record<string, unknown>[] = [];
  const jobInsertPayloads: Record<string, unknown>[] = [];

  return {
    runInsertPayloads,
    jobInsertPayloads,
    from(table: string) {
      if (table === "runs") {
        return {
          insert: (payload: Record<string, unknown>) => {
            runInsertPayloads.push(payload);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "run-123" },
                  error: null,
                }),
              }),
            };
          },
        };
      }

      if (table === "jobs") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            jobInsertPayloads.push(payload);
            return { error: null };
          },
        };
      }

      if (table === "ticker_stats") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                { symbol: "TLT", first_date: "2002-07-30", last_date: "2026-03-12" },
                { symbol: "BIL", first_date: "2007-05-25", last_date: "2026-03-12" },
              ],
              error: null,
            }),
          }),
        };
      }

      throw new Error(`Unexpected table access in test: ${table}`);
    },
  };
}

function makeRepairAdminStub() {
  const dataIngestRows: Record<string, unknown>[] = [];

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
            dataIngestRows.push(...rows);
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected repair-table access in test: ${table}`);
    },
  };
}

function makeDeleteServerClient(options?: {
  userId?: string;
  visibleRuns?: Array<{
    id: string;
    status: string;
    user_id: string;
  }>;
}) {
  const userId = options?.userId ?? "user-1";
  const visibleRuns = new Map((options?.visibleRuns ?? []).map((run) => [run.id, run]));
  const deletedRunIds: string[] = [];

  return {
    deletedRunIds,
    getVisibleRunIds: () => [...visibleRuns.keys()],
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
    from(table: string) {
      if (table !== "runs") {
        throw new Error(`Unexpected delete-table access in test: ${table}`);
      }

      return {
        select: () => ({
          eq: (_column: string, runId: string) => ({
            maybeSingle: async () => ({
              data: visibleRuns.get(runId) ?? null,
              error: null,
            }),
          }),
        }),
        delete: () => ({
          eq: async (_column: string, runId: string) => {
            deletedRunIds.push(runId);
            visibleRuns.delete(runId);
            return { error: null };
          },
        }),
      };
    },
  };
}

function makeDeleteAdminStub(options?: { storagePath?: string | null }) {
  const deletedIngestRunIds: string[] = [];
  const deletedStoragePaths: string[] = [];

  return {
    deletedIngestRunIds,
    deletedStoragePaths,
    storage: {
      from: vi.fn(() => ({
        remove: async (paths: string[]) => {
          deletedStoragePaths.push(...paths);
          return { error: null };
        },
      })),
    },
    from(table: string) {
      if (table === "reports") {
        return {
          select: () => ({
            eq: (_column: string, _runId: string) => ({
              maybeSingle: async () => ({
                data: options?.storagePath ? { storage_path: options.storagePath } : null,
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "data_ingest_jobs") {
        return {
          delete: () => ({
            eq: async (_column: string, runId: string) => {
              deletedIngestRunIds.push(runId);
              return { error: null };
            },
          }),
        };
      }

      throw new Error(`Unexpected delete-admin table access in test: ${table}`);
    },
  };
}

describe("run actions preflight gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();

    createClientMock.mockResolvedValue(makeAuthenticatedClient());
    createAdminClientMock.mockReturnValue(makeAdminStub());
    getUniverseConstraintsSnapshotMock.mockResolvedValue(BASE_CONSTRAINTS);
    getUniverseBatchStatusMock.mockResolvedValue(null);
    evaluateRunPreflightSnapshotMock.mockResolvedValue(makeSnapshot());
  });

  it("preflight blocks invalid date ranges with clear clamp actions", async () => {
    evaluateRunPreflightSnapshotMock.mockResolvedValue(
      makeSnapshot({
        minStartDate: "2004-11-18",
        maxEndDate: "2026-03-12",
      })
    );

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
    });

    expect(result.status).toBe("block");
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "start_before_universe_min",
      "end_after_cutoff",
    ]);
    expect(result.issues.map((issue) => issue.action?.kind)).toEqual([
      "clamp_start_date",
      "clamp_end_date",
    ]);
  });

  it("preflight does not queue repairs when the end date is beyond available data", async () => {
    const repairAdmin = makeRepairAdminStub();
    createAdminClientMock.mockReturnValue(repairAdmin);
    evaluateRunPreflightSnapshotMock.mockResolvedValue(
      makeSnapshot({
        maxEndDate: "2026-03-12",
        requiredEnd: "2026-03-20",
      })
    );

    const result = await preflightRun({
      name: "Future end date",
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
    });

    expect(result.status).toBe("block");
    expect(result.issues.map((issue) => issue.code)).toEqual(["end_after_cutoff"]);
    expect(result.issues[0]?.reason).toBe("We do not have data past 2026-03-12 yet.");
    expect(repairAdmin.dataIngestRows).toHaveLength(0);
  });

  it("preflight blocks ML runs with insufficient training history and includes diagnostics", async () => {
    vi.stubEnv("ML_MIN_TRAIN_DAYS", "252");
    vi.stubEnv("ML_TRAIN_WINDOW_DAYS", "504");

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
    );

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
    });

    expect(result.status).toBe("block");
    expect(result.issues[0]?.code).toBe("ml_insufficient_training_history");
    expect(result.issues[0]?.reason).toContain("train days");
    expect(result.issues[0]?.fix).toContain("reduce Top N");
  });

  it("preflight evaluates ML training coverage in the initial rolling window", async () => {
    vi.stubEnv("ML_MIN_TRAIN_DAYS", "252");
    vi.stubEnv("ML_TRAIN_WINDOW_DAYS", "504");

    evaluateRunPreflightSnapshotMock.mockResolvedValue(
      makeSnapshot({
        benchmarkFirstDate: "2000-01-03",
        warmupStart: "2022-01-03",
        requiredStart: "2024-01-02",
        universeFirstDates: {
          QQQ: "2021-01-04",
          IWM: "2021-01-04",
          TLT: "2021-01-04",
          GLD: "2021-01-04",
          VNQ: "2021-01-04",
          EFA: "2023-10-02",
          EEM: "2023-10-02",
        },
      })
    );

    const result = await preflightRun({
      name: "ML rolling window",
      strategy_id: "ml_ridge",
      start_date: "2024-01-02",
      end_date: "2026-03-12",
      benchmark: "SPY",
      universe: "ETF8",
      costs_bps: 10,
      top_n: 5,
      initial_capital: 100000,
      apply_costs: true,
      slippage_bps: 0,
    });

    expect(result.status).toBe("ok");
    expect(result.issues.some((issue) => issue.code === "ml_insufficient_training_history")).toBe(
      false
    );
  });

  it("preflight starts universe repairs and blocks queueing until missing data is ready", async () => {
    const repairAdmin = makeRepairAdminStub();
    createAdminClientMock.mockReturnValue(repairAdmin);
    getUniverseConstraintsSnapshotMock.mockResolvedValue({
      ...BASE_CONSTRAINTS,
      ready: false,
      missingTickers: ["QQQ"],
      ingestedCount: 7,
    });
    evaluateRunPreflightSnapshotMock.mockResolvedValue(
      makeSnapshot({
        missingTickers: ["QQQ"],
        symbols: ["SPY", "QQQ", "IWM", "TLT", "GLD", "VNQ", "EFA", "EEM"],
        universeFirstDates: {
          QQQ: null,
        },
      })
    );

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
    });

    expect(result.status).toBe("block");
    expect(result.issues[0]?.code).toBe("universe_missing_data_repair_started");
    expect(result.issues[0]?.reason).toContain("We've queued a data refresh");
    expect(repairAdmin.dataIngestRows).toHaveLength(1);
    expect(repairAdmin.dataIngestRows[0]).toMatchObject({
      symbol: "QQQ",
      status: "queued",
      end_date: getLastCompleteTradingDayUtc(),
    });
  });

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
    });

    expect(result.status).toBe("block");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "top_n_above_universe_size",
      action: {
        kind: "reduce_top_n",
        value: 8,
      },
    });
  });

  it("does not queue repairs for current symbols that only fail missingness thresholds", async () => {
    const repairAdmin = makeRepairAdminStub();
    createAdminClientMock.mockReturnValue(repairAdmin);
    evaluateRunPreflightSnapshotMock.mockResolvedValue(
      makeSnapshot({
        universeMissingRates: {
          QQQ: 0.12,
        },
      })
    );

    const result = await preflightRun({
      name: "Current but gappy",
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
    });

    expect(result.status).toBe("block");
    expect(
      result.issues.some((issue) => issue.code === "universe_missingness_per_ticker_blocked")
    ).toBe(true);
    expect(repairAdmin.dataIngestRows).toHaveLength(0);
  });

  it("suggests a benchmark change when an alternative benchmark is cleaner", async () => {
    evaluateRunPreflightSnapshotMock.mockResolvedValue(
      makeSnapshot({
        benchmarkMissingRate: 0.12,
        benchmarkCandidates: [
          { symbol: "QQQ", status: "ok", benchmarkTrueMissingRate: 0.0, affectedShare: 0 },
          { symbol: "SPY", status: "block", benchmarkTrueMissingRate: 0.12, affectedShare: 0 },
        ],
      })
    );

    const result = await preflightRun({
      name: "Switch benchmark",
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
    });

    expect(result.status).toBe("block");
    expect(
      result.issues.find((issue) => issue.code === "benchmark_missingness_blocked")
    ).toMatchObject({
      action: {
        kind: "change_benchmark",
        value: "QQQ",
      },
    });
  });

  it("createRun rechecks preflight and refuses inserts when blocked", async () => {
    evaluateRunPreflightSnapshotMock.mockResolvedValue(
      makeSnapshot({
        maxEndDate: "2026-03-12",
      })
    );

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
    });

    expect(result.ok).toBe(false);
    expect(result.preflight?.status).toBe("block");
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("allows clean runs for every strategy to be created and queued", async () => {
    const serverClient = makeAuthenticatedClient();
    const admin = makeAdminStub();
    createClientMock.mockResolvedValue(serverClient);
    createAdminClientMock.mockReturnValue(admin);
    evaluateRunPreflightSnapshotMock.mockResolvedValue(makeSnapshot());

    const strategies = [
      "equal_weight",
      "momentum_12_1",
      "low_vol",
      "trend_filter",
      "ml_ridge",
      "ml_lightgbm",
    ] as const;

    for (const strategy of strategies) {
      const result = await createRun({
        name: `Clean ${strategy}`,
        strategy_id: strategy,
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
      });

      expect(result.ok).toBe(true);
    }

    expect(serverClient.runInsertPayloads).toHaveLength(strategies.length);
    expect(serverClient.jobInsertPayloads).toHaveLength(strategies.length);
    expect(serverClient.runInsertPayloads[0]).toMatchObject({
      user_id: "user-1",
      status: "queued",
    });
  });

  it("warn acknowledgement gates creation and marks executed_with_missing_data", async () => {
    const serverClient = makeAuthenticatedClient();
    const admin = makeAdminStub();
    createClientMock.mockResolvedValue(serverClient);
    createAdminClientMock.mockReturnValue(admin);
    evaluateRunPreflightSnapshotMock.mockResolvedValue(
      makeSnapshot({
        benchmarkMissingRate: 0.04,
      })
    );

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
    });

    expect(blockedWithoutAck.ok).toBe(false);
    expect(blockedWithoutAck.preflight?.status).toBe("warn");
    expect(serverClient.runInsertPayloads).toHaveLength(0);

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
    });

    expect(createdWithAck.ok).toBe(true);
    expect(serverClient.runInsertPayloads).toHaveLength(1);
    expect(serverClient.runInsertPayloads[0]).toMatchObject({
      status: "queued",
      executed_with_missing_data: true,
      user_id: "user-1",
    });
    expect(serverClient.jobInsertPayloads).toHaveLength(1);
  });
});

describe("deleteRunAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets an owner delete a run and removes it from the visible runs set", async () => {
    const runId = "22222222-2222-4222-8222-222222222222";
    const serverClient = makeDeleteServerClient({
      visibleRuns: [{ id: runId, status: "completed", user_id: "user-1" }],
    });
    const admin = makeDeleteAdminStub({
      storagePath: `${runId}/tearsheet.html`,
    });

    createClientMock.mockResolvedValue(serverClient);
    createAdminClientMock.mockReturnValue(admin);

    await expect(deleteRunAction(runId)).rejects.toThrow("REDIRECT:/runs?deleted=1");

    expect(serverClient.deletedRunIds).toEqual([runId]);
    expect(serverClient.getVisibleRunIds()).toEqual([]);
    expect(admin.deletedIngestRunIds).toEqual([runId]);
    expect(admin.deletedStoragePaths).toEqual([`${runId}/tearsheet.html`]);
    expect(revalidatePathMock).toHaveBeenCalledWith("/runs");
  });

  it("rejects deletes for runs the current user does not own", async () => {
    const runId = "33333333-3333-4333-8333-333333333333";
    const serverClient = makeDeleteServerClient({
      visibleRuns: [],
    });

    createClientMock.mockResolvedValue(serverClient);
    createAdminClientMock.mockReturnValue(makeDeleteAdminStub());

    await expect(deleteRunAction(runId)).resolves.toEqual({
      error: "You can only delete your own runs.",
    });

    expect(serverClient.deletedRunIds).toEqual([]);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
