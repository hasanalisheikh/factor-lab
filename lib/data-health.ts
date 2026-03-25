import type { TickerDateRange } from "@/lib/supabase/types";

export type HealthStatus = "GOOD" | "WARNING" | "DEGRADED" | "NO_DATA";

export type InceptionAwareCoverageRow = {
  ticker: string;
  firstDate: string;
  lastDate: string;
  actualDays: number;
  expectedDays: number;
  trueMissingDays: number;
  preInceptionDays: number;
  coveragePercent: number;
};

export type InceptionAwareCoverageSummary = {
  rows: InceptionAwareCoverageRow[];
  completeness: number | null;
  totalExpected: number;
  totalActual: number;
  totalTrueMissing: number;
  totalPreInception: number;
  trueMissingRate: number;
};

export type DataHealthMetrics = {
  completeness: number | null;
  requiredNotIngested: number;
  trueMissingRate: number;
  maxGapDays: number;
  benchmarkTicker: string;
  benchmarkTrueMissingRate: number;
  benchmarkMaxGapDays: number;
};

export type DataHealthAssessment = {
  status: HealthStatus;
  reason: string;
};

const OVERALL_MISSING_GOOD = 0.015;
const OVERALL_MISSING_DEGRADED = 0.04;
const BENCHMARK_MISSING_GOOD = 0.02;
const BENCHMARK_MISSING_DEGRADED = 0.1;
const GAP_GOOD_DAYS = 5;
const GAP_DEGRADED_DAYS = 20;
const BENCHMARK_GAP_GOOD_DAYS = 5;
const BENCHMARK_GAP_DEGRADED_DAYS = 10;

function countBusinessDays(startStr: string, endStr: string): number {
  if (!startStr || !endStr || startStr > endStr) return 0;
  const start = new Date(`${startStr}T00:00:00Z`);
  const end = new Date(`${endStr}T00:00:00Z`);
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDays(value: number): string {
  return `${value} trading day${value === 1 ? "" : "s"}`;
}

function makeReason(label: string): string {
  return `Reason: ${label}.`;
}

function degradedReason(metrics: DataHealthMetrics): string | null {
  if (metrics.requiredNotIngested > 0) {
    return makeReason(
      `${metrics.requiredNotIngested} required ticker${metrics.requiredNotIngested === 1 ? " is" : "s are"} not ingested`
    );
  }
  if (metrics.benchmarkTrueMissingRate > BENCHMARK_MISSING_DEGRADED) {
    return makeReason(
      `benchmark ${metrics.benchmarkTicker} true missing rate is ${formatPercent(metrics.benchmarkTrueMissingRate)} (degraded above ${formatPercent(BENCHMARK_MISSING_DEGRADED)})`
    );
  }
  if (metrics.benchmarkMaxGapDays > BENCHMARK_GAP_DEGRADED_DAYS) {
    return makeReason(
      `benchmark ${metrics.benchmarkTicker} max gap is ${formatDays(metrics.benchmarkMaxGapDays)} (degraded above ${BENCHMARK_GAP_DEGRADED_DAYS})`
    );
  }
  if (metrics.trueMissingRate > OVERALL_MISSING_DEGRADED) {
    return makeReason(
      `overall true missing rate is ${formatPercent(metrics.trueMissingRate)} (degraded above ${formatPercent(OVERALL_MISSING_DEGRADED)})`
    );
  }
  if (metrics.maxGapDays > GAP_DEGRADED_DAYS) {
    return makeReason(
      `overall max gap is ${formatDays(metrics.maxGapDays)} (degraded above ${GAP_DEGRADED_DAYS})`
    );
  }
  return null;
}

function warningReason(metrics: DataHealthMetrics): string | null {
  if (metrics.benchmarkTrueMissingRate > BENCHMARK_MISSING_GOOD) {
    return makeReason(
      `benchmark ${metrics.benchmarkTicker} true missing rate is ${formatPercent(metrics.benchmarkTrueMissingRate)} (good threshold ${formatPercent(BENCHMARK_MISSING_GOOD)})`
    );
  }
  if (metrics.benchmarkMaxGapDays > BENCHMARK_GAP_GOOD_DAYS) {
    return makeReason(
      `benchmark ${metrics.benchmarkTicker} max gap is ${formatDays(metrics.benchmarkMaxGapDays)} (good threshold ${BENCHMARK_GAP_GOOD_DAYS})`
    );
  }
  if (metrics.trueMissingRate > OVERALL_MISSING_GOOD) {
    return makeReason(
      `overall true missing rate is ${formatPercent(metrics.trueMissingRate)} (good threshold ${formatPercent(OVERALL_MISSING_GOOD)})`
    );
  }
  if (metrics.maxGapDays > GAP_GOOD_DAYS) {
    return makeReason(
      `overall max gap is ${formatDays(metrics.maxGapDays)} (good threshold ${GAP_GOOD_DAYS})`
    );
  }
  return null;
}

export function calendarGapToTradingDays(calendarGapDays: number): number {
  if (calendarGapDays <= 0) return 0;
  return Math.max(0, Math.round((calendarGapDays * 5) / 7));
}

export function summarizeInceptionAwareCoverage(params: {
  ranges: TickerDateRange[];
  globalStart: string | null;
  globalEnd: string | null;
}): InceptionAwareCoverageSummary {
  const { ranges, globalStart, globalEnd } = params;
  if (ranges.length === 0) {
    return {
      rows: [],
      completeness: null,
      totalExpected: 0,
      totalActual: 0,
      totalTrueMissing: 0,
      totalPreInception: 0,
      trueMissingRate: 0,
    };
  }

  const effectiveGlobalStart =
    globalStart ??
    ranges.reduce(
      (min, range) => (!min || range.firstDate < min ? range.firstDate : min),
      null as string | null
    ) ??
    "";

  const rows = ranges
    .filter((range) => !globalEnd || range.firstDate <= globalEnd)
    .map((range) => {
      const expectedDays = countBusinessDays(range.firstDate, range.lastDate);
      const trueMissingDays = Math.max(expectedDays - range.actualDays, 0);
      const dayBeforeFirst = (() => {
        const date = new Date(`${range.firstDate}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() - 1);
        return date.toISOString().slice(0, 10);
      })();
      const preInceptionDays =
        effectiveGlobalStart < range.firstDate
          ? countBusinessDays(effectiveGlobalStart, dayBeforeFirst)
          : 0;

      return {
        ticker: range.ticker,
        firstDate: range.firstDate,
        lastDate: range.lastDate,
        actualDays: range.actualDays,
        expectedDays,
        trueMissingDays,
        preInceptionDays,
        coveragePercent:
          expectedDays > 0 ? Math.min((range.actualDays / expectedDays) * 100, 100) : 100,
      };
    });

  const totalExpected = rows.reduce((sum, row) => sum + row.expectedDays, 0);
  const totalActual = rows.reduce((sum, row) => sum + row.actualDays, 0);
  const totalTrueMissing = rows.reduce((sum, row) => sum + row.trueMissingDays, 0);
  const totalPreInception = rows.reduce((sum, row) => sum + row.preInceptionDays, 0);

  return {
    rows,
    completeness: totalExpected > 0 ? Math.min((totalActual / totalExpected) * 100, 100) : null,
    totalExpected,
    totalActual,
    totalTrueMissing,
    totalPreInception,
    trueMissingRate: totalExpected > 0 ? totalTrueMissing / totalExpected : 0,
  };
}

export function assessDataHealth(metrics: DataHealthMetrics): DataHealthAssessment {
  if (metrics.completeness === null) {
    return {
      status: "NO_DATA",
      reason: makeReason("no price data is available"),
    };
  }

  const degraded = degradedReason(metrics);
  if (degraded) {
    return {
      status: "DEGRADED",
      reason: degraded,
    };
  }

  const isGood =
    metrics.requiredNotIngested === 0 &&
    metrics.benchmarkTrueMissingRate <= BENCHMARK_MISSING_GOOD &&
    metrics.benchmarkMaxGapDays <= BENCHMARK_GAP_GOOD_DAYS &&
    metrics.maxGapDays <= GAP_GOOD_DAYS &&
    metrics.trueMissingRate <= OVERALL_MISSING_GOOD;

  if (isGood) {
    return {
      status: "GOOD",
      reason: makeReason(
        `all monitored metrics, including benchmark ${metrics.benchmarkTicker}, are within good thresholds`
      ),
    };
  }

  return {
    status: "WARNING",
    reason:
      warningReason(metrics) ??
      makeReason(
        "one or more monitored metrics are outside the good range but below degraded thresholds"
      ),
  };
}
