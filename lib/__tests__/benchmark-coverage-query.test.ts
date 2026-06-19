import { describe, expect, it } from "vitest";

import { fetchObservedDateCountsByTicker } from "@/lib/coverage-check/benchmark-coverage";

function makeCountAdminStub(rowsBySymbol: Record<string, number>) {
  const calls: Array<{
    symbol: string | null;
    startDate: string | null;
    endDate: string | null;
    head: boolean | undefined;
    count: string | null | undefined;
    rangeCalled: boolean;
  }> = [];

  return {
    calls,
    from(table: string) {
      if (table !== "prices") {
        throw new Error(`Unexpected table access: ${table}`);
      }

      const state = {
        symbol: null as string | null,
        startDate: null as string | null,
        endDate: null as string | null,
        head: undefined as boolean | undefined,
        count: undefined as string | null | undefined,
        rangeCalled: false,
      };

      const builder = {
        select(_columns: string, options?: { head?: boolean; count?: string | null }) {
          state.head = options?.head;
          state.count = options?.count;
          return builder;
        },
        eq(_column: string, symbol: string) {
          state.symbol = symbol;
          return builder;
        },
        gte(_column: string, startDate: string) {
          state.startDate = startDate;
          return builder;
        },
        lte(_column: string, endDate: string) {
          state.endDate = endDate;
          return builder;
        },
        async range() {
          state.rangeCalled = true;
          return { data: [], error: null };
        },
        async then(resolve: (value: { count: number; error: null }) => void) {
          calls.push({ ...state });
          resolve({ count: rowsBySymbol[state.symbol ?? ""] ?? 0, error: null });
        },
      };

      return builder;
    },
  };
}

describe("fetchObservedDateCountsByTicker", () => {
  it("counts per symbol without materializing raw price rows", async () => {
    const admin = makeCountAdminStub({ SPY: 3, QQQ: 2, IWM: 0 });

    const counts = await fetchObservedDateCountsByTicker({
      admin,
      windowsBySymbol: new Map([
        ["SPY", { startDate: "2026-01-02", endDate: "2026-01-06" }],
        ["QQQ", { startDate: "2026-01-03", endDate: "2026-01-06" }],
        ["IWM", { startDate: "2026-01-02", endDate: "2026-01-01" }],
      ]),
    });

    expect(counts).toEqual(
      new Map([
        ["SPY", 3],
        ["QQQ", 2],
        ["IWM", 0],
      ])
    );
    expect(admin.calls).toHaveLength(2);
    expect(admin.calls).toEqual([
      {
        symbol: "SPY",
        startDate: "2026-01-02",
        endDate: "2026-01-06",
        head: true,
        count: "exact",
        rangeCalled: false,
      },
      {
        symbol: "QQQ",
        startDate: "2026-01-03",
        endDate: "2026-01-06",
        head: true,
        count: "exact",
        rangeCalled: false,
      },
    ]);
  });
});
