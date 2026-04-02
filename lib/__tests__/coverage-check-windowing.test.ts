import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import {
  buildRunPreflightResult,
  countBusinessDays,
  evaluateRunPreflightSnapshot,
  resolveRunPreflightWindow,
} from "@/lib/coverage-check";
import { getLastCompleteTradingDayUtc } from "@/lib/data-cutoff";

function weekdayCalendar(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function dayBefore(dateStr: string): string {
  const cursor = new Date(`${dateStr}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  return cursor.toISOString().slice(0, 10);
}

function countDatesInRange(dates: readonly string[], startDate: string, endDate: string): number {
  return dates.filter((date) => date >= startDate && date <= endDate).length;
}

function makeCoverageAdminStub(params: {
  statsRows: Array<{ symbol: string; first_date: string | null; last_date: string | null }>;
  priceRows: Array<{ ticker: string; date: string }>;
}) {
  const { statsRows, priceRows } = params;

  return {
    from(table: string) {
      if (table === "ticker_stats") {
        return {
          select() {
            return {
              in: async (_column: string, symbols: string[]) => ({
                data: statsRows.filter((row) => symbols.includes(row.symbol)),
                error: null,
              }),
            };
          },
        };
      }

      if (table === "prices") {
        const state = {
          symbols: [] as string[],
          startDate: "",
          endDate: "",
        };
        const builder = {
          select(_columns: string) {
            return builder;
          },
          in(_column: string, symbols: string[]) {
            state.symbols = symbols;
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
          order(_column: string, _options: { ascending: boolean }) {
            return builder;
          },
          async range(from: number, to: number) {
            const rows = priceRows
              .filter((row) => state.symbols.includes(row.ticker))
              .filter((row) => row.date >= state.startDate && row.date <= state.endDate)
              .sort((left, right) => left.date.localeCompare(right.date))
              .slice(from, to + 1);
            return { data: rows, error: null };
          },
        };
        return builder;
      }

      throw new Error(`Unexpected table access: ${table}`);
    },
  };
}

describe("evaluateRunPreflightSnapshot windowing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the monitored research window source for runs that live inside that window", async () => {
    const benchmarkDates = weekdayCalendar("2020-01-01", "2026-01-30");
    const researchWindowStart = "2015-01-02";
    const lateFirstDate = "2023-06-01";
    const oldSymbolDates = benchmarkDates.filter((_, index) => index % 20 !== 0);
    const lateSymbolDates = benchmarkDates
      .filter((date) => date >= lateFirstDate)
      .filter((_, index) => index % 30 !== 0);

    createAdminClientMock.mockReturnValue(
      makeCoverageAdminStub({
        statsRows: [
          { symbol: "SPY", first_date: "1993-01-29", last_date: "2026-01-30" },
          { symbol: "OLD", first_date: "1993-01-29", last_date: "2026-01-30" },
          { symbol: "NEW", first_date: lateFirstDate, last_date: "2026-01-30" },
        ],
        priceRows: [
          ...benchmarkDates.map((date) => ({ ticker: "SPY", date })),
          ...oldSymbolDates.map((date) => ({ ticker: "OLD", date })),
          ...lateSymbolDates.map((date) => ({ ticker: "NEW", date })),
        ],
      })
    );

    const snapshot = await evaluateRunPreflightSnapshot({
      strategyId: "momentum_12_1",
      startDate: "2021-01-04",
      endDate: "2026-01-30",
      universeSymbols: ["OLD", "NEW"],
      benchmark: "SPY",
      dataCutoffDate: "2026-01-30",
      universeEarliestStart: "1993-01-29",
      universeValidFrom: "1993-01-29",
      missingTickers: [],
    });

    expect(snapshot.requiredStart).toBe("2021-01-04");
    expect(snapshot.requiredEnd).toBe("2026-01-30");
    expect(countBusinessDays(snapshot.warmupStart, dayBefore(snapshot.requiredStart))).toBe(252);

    const oldRow = snapshot.coverage.symbols.find((row) => row.symbol === "OLD");
    const newRow = snapshot.coverage.symbols.find((row) => row.symbol === "NEW");
    const benchmarkRow = snapshot.coverage.symbols.find((row) => row.symbol === "SPY");
    expect(oldRow).toBeDefined();
    expect(newRow).toBeDefined();
    expect(benchmarkRow).toBeDefined();

    expect(snapshot.coverage.benchmark.metricSourceUsed).toBe("research_window");
    expect(oldRow?.windowStart).toBe(researchWindowStart);
    expect(newRow?.windowStart).toBe(lateFirstDate);
    expect(benchmarkRow?.windowStart).toBe(researchWindowStart);

    const naiveExpectedFromInception = countBusinessDays("1993-01-29", "2026-01-30");
    expect(benchmarkRow?.expectedDays).toBe(
      countDatesInRange(benchmarkDates, researchWindowStart, snapshot.requiredEnd)
    );
    expect(benchmarkRow?.actualDays).toBe(benchmarkRow?.expectedDays);
    expect(benchmarkRow?.trueMissingRate).toBe(0);
    expect(oldRow?.expectedDays).toBe(
      countDatesInRange(benchmarkDates, researchWindowStart, snapshot.requiredEnd)
    );
    expect(oldRow?.expectedDays ?? 0).toBeLessThan(naiveExpectedFromInception / 3);

    expect(newRow?.expectedDays).toBe(
      countDatesInRange(benchmarkDates, lateFirstDate, snapshot.requiredEnd)
    );
    expect(newRow?.expectedDays ?? 0).toBeLessThan(oldRow?.expectedDays ?? 0);
    expect(newRow?.trueMissingRate ?? 1).toBeLessThan(0.1);
  });

  it("uses benchmark trading dates instead of business days for benchmark missingness", async () => {
    const windowStart = "2025-12-22";
    const windowEnd = "2026-01-05";
    const weekdayDates = weekdayCalendar(windowStart, windowEnd);
    const benchmarkDates = weekdayDates.filter(
      (date) => date !== "2025-12-25" && date !== "2026-01-01"
    );

    createAdminClientMock.mockReturnValue(
      makeCoverageAdminStub({
        statsRows: [
          { symbol: "SPY", first_date: "1993-01-29", last_date: windowEnd },
          { symbol: "QQQ", first_date: "1999-03-10", last_date: windowEnd },
        ],
        priceRows: [
          ...benchmarkDates.map((date) => ({ ticker: "SPY", date })),
          ...benchmarkDates.map((date) => ({ ticker: "QQQ", date })),
        ],
      })
    );

    const snapshot = await evaluateRunPreflightSnapshot({
      strategyId: "equal_weight",
      startDate: windowStart,
      endDate: windowEnd,
      universeSymbols: ["QQQ"],
      benchmark: "SPY",
      dataCutoffDate: windowEnd,
      universeEarliestStart: "1993-01-29",
      universeValidFrom: "1993-01-29",
      missingTickers: [],
    });

    const benchmarkRow = snapshot.coverage.symbols.find((row) => row.symbol === "SPY");
    expect(benchmarkRow).toBeDefined();
    expect(countBusinessDays(windowStart, windowEnd)).toBeGreaterThan(benchmarkDates.length);
    expect(benchmarkRow?.expectedDays).toBe(benchmarkDates.length);
    expect(benchmarkRow?.actualDays).toBe(benchmarkDates.length);
    expect(benchmarkRow?.trueMissingDays).toBe(0);
    expect(benchmarkRow?.trueMissingRate).toBe(0);
  });

  it("uses research_window metrics and avoids benchmark warnings for runs fully inside the monitored research window", async () => {
    const researchWindowStart = "2015-01-02";
    const runStart = "2015-06-01";
    const runEnd = "2016-01-29";
    const benchmarkDates = weekdayCalendar(researchWindowStart, runEnd);

    createAdminClientMock.mockReturnValue(
      makeCoverageAdminStub({
        statsRows: [
          { symbol: "SPY", first_date: "1993-01-29", last_date: runEnd },
          { symbol: "QQQ", first_date: "1999-03-10", last_date: runEnd },
        ],
        priceRows: [
          ...benchmarkDates.map((date) => ({ ticker: "SPY", date })),
          ...benchmarkDates.map((date) => ({ ticker: "QQQ", date })),
        ],
      })
    );

    const snapshot = await evaluateRunPreflightSnapshot({
      strategyId: "momentum_12_1",
      startDate: runStart,
      endDate: runEnd,
      universeSymbols: ["QQQ"],
      benchmark: "SPY",
      dataCutoffDate: runEnd,
      universeEarliestStart: "1993-01-29",
      universeValidFrom: "1993-01-29",
      missingTickers: [],
    });

    const result = buildRunPreflightResult({
      strategyId: "momentum_12_1",
      startDate: runStart,
      endDate: runEnd,
      benchmark: "SPY",
      constraints: snapshot.constraints,
      symbolRows: snapshot.coverage.symbols,
      benchmarkCoverage: snapshot.coverage.benchmark,
      benchmarkCandidates: snapshot.coverage.benchmarkCandidates,
    });

    expect(snapshot.coverage.benchmark).toMatchObject({
      metricSourceUsed: "research_window",
      status: "good",
      windowStartUsed: researchWindowStart,
      windowEndUsed: runEnd,
      missingDays: 0,
      trueMissingRate: 0,
    });
    expect(result.issues.some((issue) => issue.code === "benchmark_missingness_warning")).toBe(
      false
    );
    expect(result.coverage.benchmark.status).toBe("good");
  });
});

describe("stale dataCutoffDate isolation", () => {
  const STALE_CUTOFF = "2025-03-15";
  const TODAY = "2026-03-28";
  const RECENT_BENCHMARK_DATES = weekdayCalendar("1993-01-29", TODAY);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolveRunPreflightWindow: requiredEnd equals endDate with no external cap", () => {
    const result = resolveRunPreflightWindow({
      strategyId: "equal_weight",
      startDate: "2020-01-02",
      endDate: TODAY,
      minStartDate: null,
    });
    expect(result.requiredEnd).toBe(TODAY);
  });

  it("resolveRunPreflightWindow: requiredEnd equals endDate even when endDate is far in the future relative to any historical cutoff", () => {
    const result = resolveRunPreflightWindow({
      strategyId: "momentum_12_1",
      startDate: "2021-01-04",
      endDate: "2030-12-31",
      minStartDate: null,
    });
    expect(result.requiredEnd).toBe("2030-12-31");
  });

  it("evaluateRunPreflightSnapshot: maxEndDate is today's last complete trading day, not the stale DB cutoff", async () => {
    createAdminClientMock.mockReturnValue(
      makeCoverageAdminStub({
        statsRows: [
          { symbol: "SPY", first_date: "1993-01-29", last_date: STALE_CUTOFF },
          { symbol: "QQQ", first_date: "1999-03-10", last_date: STALE_CUTOFF },
        ],
        priceRows: RECENT_BENCHMARK_DATES.map((date) => ({ ticker: "SPY", date })).concat(
          weekdayCalendar("1999-03-10", TODAY).map((date) => ({ ticker: "QQQ", date }))
        ),
      })
    );

    const snapshot = await evaluateRunPreflightSnapshot({
      strategyId: "equal_weight",
      startDate: "2020-01-02",
      endDate: TODAY,
      universeSymbols: ["QQQ"],
      benchmark: "SPY",
      dataCutoffDate: STALE_CUTOFF,
      universeEarliestStart: "1993-01-29",
      universeValidFrom: "1993-01-29",
      missingTickers: [],
    });

    const expectedToday = getLastCompleteTradingDayUtc();
    expect(snapshot.constraints.maxEndDate).toBe(expectedToday);
    expect(snapshot.constraints.maxEndDate).not.toBe(STALE_CUTOFF);
  });

  it("evaluateRunPreflightSnapshot: requiredEnd equals the run's endDate even with a stale cutoff", async () => {
    createAdminClientMock.mockReturnValue(
      makeCoverageAdminStub({
        statsRows: [
          { symbol: "SPY", first_date: "1993-01-29", last_date: STALE_CUTOFF },
          { symbol: "QQQ", first_date: "1999-03-10", last_date: STALE_CUTOFF },
        ],
        priceRows: RECENT_BENCHMARK_DATES.map((date) => ({ ticker: "SPY", date })),
      })
    );

    const snapshot = await evaluateRunPreflightSnapshot({
      strategyId: "equal_weight",
      startDate: "2020-01-02",
      endDate: TODAY,
      universeSymbols: ["QQQ"],
      benchmark: "SPY",
      dataCutoffDate: STALE_CUTOFF,
      universeEarliestStart: "1993-01-29",
      universeValidFrom: "1993-01-29",
      missingTickers: [],
    });

    expect(snapshot.requiredEnd).toBe(TODAY);
    expect(snapshot.constraints.requiredEnd).toBe(TODAY);
  });

  it("buildRunPreflightResult: end_after_cutoff not fired when endDate equals today and maxEndDate is today", () => {
    const today = getLastCompleteTradingDayUtc();
    const result = buildRunPreflightResult({
      strategyId: "equal_weight",
      startDate: "2020-01-02",
      endDate: today,
      benchmark: "SPY",
      constraints: {
        dataCutoffDate: STALE_CUTOFF,
        universeEarliestStart: "1993-01-29",
        universeValidFrom: "1993-01-29",
        minStartDate: null,
        maxEndDate: today,
        missingTickers: [],
        warmupStart: "2020-01-02",
        requiredStart: "2020-01-02",
        requiredEnd: today,
      },
      symbolRows: [],
    });

    expect(result.issues.some((issue) => issue.code === "end_after_cutoff")).toBe(false);
  });

  it("buildRunPreflightResult: end_after_cutoff fires for genuinely future dates", () => {
    const today = getLastCompleteTradingDayUtc();
    const result = buildRunPreflightResult({
      strategyId: "equal_weight",
      startDate: "2020-01-02",
      endDate: "2099-12-31",
      benchmark: "SPY",
      constraints: {
        dataCutoffDate: STALE_CUTOFF,
        universeEarliestStart: "1993-01-29",
        universeValidFrom: "1993-01-29",
        minStartDate: null,
        maxEndDate: today,
        missingTickers: [],
        warmupStart: "2020-01-02",
        requiredStart: "2020-01-02",
        requiredEnd: today,
      },
      symbolRows: [],
    });

    expect(result.issues.some((issue) => issue.code === "end_after_cutoff")).toBe(true);
    const issue = result.issues.find((i) => i.code === "end_after_cutoff");
    expect(issue?.severity).toBe("blocked");
    expect(issue?.action?.kind).toBe("clamp_end_date");
  });
});
