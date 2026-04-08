import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EquityCurveRow, RunMetricsRow, RunWithMetrics } from "@/lib/supabase/types";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { getCompareRunBundles } from "@/lib/supabase/queries";

function makeMetrics(runId: string): RunMetricsRow {
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
  };
}

function makeRun(runId: string, name: string, createdAt: string): RunWithMetrics {
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
    top_n: 10,
    run_params: {},
    run_metadata: {},
    start_date: "2021-04-01",
    end_date: "2026-04-30",
    executed_start_date: "2021-04-01",
    executed_end_date: "2026-04-30",
    created_at: createdAt,
    user_id: "user-1",
    executed_with_missing_data: false,
    run_metrics: [makeMetrics(runId)],
  };
}

function makeEquitySeries(runId: string, startDate: string, endDate: string): EquityCurveRow[] {
  const rows: EquityCurveRow[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let portfolio = 100_000;
  let benchmark = 100_000;

  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    const date = day.toISOString().slice(0, 10);
    portfolio += 75;
    benchmark += 50;
    rows.push({
      id: `eq-${runId}-${date}`,
      run_id: runId,
      date,
      portfolio,
      benchmark,
    });
  }

  return rows;
}

function makeCompareClient(params: { runs: RunWithMetrics[]; equityRows: EquityCurveRow[] }) {
  const equityRangeCalls: Array<[number, number]> = [];
  const orderedEquityRows = [...params.equityRows].sort((left, right) => {
    const byRunId = left.run_id.localeCompare(right.run_id);
    return byRunId !== 0 ? byRunId : left.date.localeCompare(right.date);
  });

  return {
    equityRangeCalls,
    from(table: string) {
      if (table === "runs") {
        return {
          select(_columns: string) {
            return {
              eq(_column: string, _value: string) {
                return {
                  order(_orderColumn: string, _options: { ascending: boolean }) {
                    return {
                      limit: async (limit: number) => ({
                        data: params.runs.slice(0, limit),
                        error: null,
                      }),
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "equity_curve") {
        const state = {
          runIds: [] as string[],
        };

        const builder = {
          select(_columns: string) {
            return builder;
          },
          in(_column: string, runIds: string[]) {
            state.runIds = [...runIds];
            return builder;
          },
          order(_column: string, _options: { ascending: boolean }) {
            return builder;
          },
          async range(from: number, to: number) {
            equityRangeCalls.push([from, to]);
            return {
              data: orderedEquityRows
                .filter((row) => state.runIds.includes(row.run_id))
                .slice(from, to + 1),
              error: null,
            };
          },
        };

        return builder;
      }

      throw new Error(`Unexpected table access: ${table}`);
    },
  };
}

describe("getCompareRunBundles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches full paged equity history and preserves compare run ordering", async () => {
    const runA = makeRun("run-a", "Run A", "2026-04-30T00:00:00Z");
    const runB = makeRun("run-b", "Run B", "2026-05-01T00:00:00Z");
    const equityA = makeEquitySeries("run-a", "2021-04-01", "2026-04-29");
    const equityB = makeEquitySeries("run-b", "2021-04-05", "2026-04-30");
    const client = makeCompareClient({
      runs: [runB, runA],
      equityRows: [...equityA, ...equityB],
    });

    expect(equityA.length + equityB.length).toBeGreaterThan(2000);

    createClientMock.mockResolvedValue(client);

    const bundles = await getCompareRunBundles(40);

    expect(bundles).toHaveLength(2);
    expect(bundles.map((bundle) => bundle.run.id)).toEqual(["run-b", "run-a"]);

    expect(bundles[0].equity).toHaveLength(equityB.length);
    expect(bundles[1].equity).toHaveLength(equityA.length);
    expect(bundles[0].equity.length).toBeGreaterThan(1000);
    expect(bundles[1].equity.length).toBeGreaterThan(1000);

    expect(bundles[0].equity[0]?.date).toBe("2021-04-05");
    expect(bundles[0].equity.at(-1)?.date).toBe("2026-04-30");
    expect(bundles[1].equity[0]?.date).toBe("2021-04-01");
    expect(bundles[1].equity.at(-1)?.date).toBe("2026-04-29");

    expect(client.equityRangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
});
