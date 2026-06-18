import type { EquityPoint, DrawdownPoint, DashboardMetric } from "@/lib/types";

export * from "./mock/static-data";

// ── Sparkline seed helper ──────────────────────────────

function generateSparkline(
  length: number,
  start: number,
  volatility: number,
  trend: number
): number[] {
  const arr: number[] = [];
  let v = start;
  for (let i = 0; i < length; i++) {
    v += (Math.random() - 0.5 + trend) * volatility;
    arr.push(Math.round(v * 100) / 100);
  }
  return arr;
}

// ── Dashboard Metrics ──────────────────────────────────

export const dashboardMetrics: DashboardMetric[] = [
  {
    label: "CAGR",
    value: "+24.7%",
    deltaRaw: 0.032,
    deltaFormatted: "+3.2 pp",
    deltaLabel: "vs SPY",
    lowerIsBetter: false,
    sparkline: generateSparkline(20, 18, 1.2, 0.15),
  },
  {
    label: "Sharpe Ratio",
    value: "1.84",
    deltaRaw: 0.12,
    deltaFormatted: "+0.12",
    deltaLabel: "vs SPY",
    lowerIsBetter: false,
    sparkline: generateSparkline(20, 1.5, 0.08, 0.01),
  },
  {
    label: "Max Drawdown",
    value: "8.3%",
    deltaRaw: -0.011,
    deltaFormatted: "-1.1 pp",
    deltaLabel: "vs SPY",
    lowerIsBetter: true,
    sparkline: generateSparkline(20, -5, 0.8, -0.05),
  },
  {
    label: "Turnover",
    value: "42.1%",
    deltaRaw: null,
    deltaFormatted: null,
    deltaLabel: "delta n/a",
    lowerIsBetter: true,
    sparkline: generateSparkline(20, 45, 2, -0.1),
  },
];

// ── Equity Curve ───────────────────────────────────────

// ── Seeded PRNG (LCG) for deterministic mock equity curve ──────────────────
// Using a fixed seed ensures the mock curve is stable across server restarts
// and produces consistently plausible Sharpe / CAGR values for dev testing.
// Parameters tuned to produce:
//   Portfolio: CAGR ~20%, annualised Sharpe ~1.2, MaxDD ~8–14%
//   Benchmark: CAGR ~13%, annualised Sharpe ~0.9, MaxDD ~6–12%
function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
}

export const equityCurve: EquityPoint[] = (() => {
  const rng = makeLCG(1234); // fixed seed → deterministic, realistic mock data
  const data: EquityPoint[] = [];
  let portfolio = 10000;
  let benchmark = 10000;
  const startDate = new Date("2024-01-02");
  for (let i = 0; i < 365; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    // scale ≈ 0.033 → daily std ≈ 0.95%, offset → CAGR ~17%, Sharpe ~1.1
    portfolio *= 1 + (rng() - 0.472) * 0.033;
    // scale ≈ 0.026 → daily std ≈ 0.75%, offset → CAGR ~15%, Sharpe ~1.25
    benchmark *= 1 + (rng() - 0.482) * 0.026;
    data.push({
      date: date.toISOString().split("T")[0],
      portfolio: Math.round(portfolio * 100) / 100,
      benchmark: Math.round(benchmark * 100) / 100,
    });
  }
  return data;
})();

// ── Drawdown ───────────────────────────────────────────

export const drawdownData: DrawdownPoint[] = (() => {
  const data: DrawdownPoint[] = [];
  let peak = 10000;
  let current = 10000;
  const startDate = new Date("2024-01-02");
  for (let i = 0; i < 365; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    current *= 1 + (Math.random() - 0.44) * 0.018;
    if (current > peak) peak = current;
    const dd = ((current - peak) / peak) * 100;
    data.push({
      date: date.toISOString().split("T")[0],
      drawdown: Math.round(dd * 100) / 100,
    });
  }
  return data;
})();
