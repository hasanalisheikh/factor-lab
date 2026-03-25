import type {
  Run,
  EquityPoint,
  DrawdownPoint,
  Holding,
  Trade,
  Job,
  FeatureImportance,
  ModelMeta,
  DashboardMetric,
  TurnoverPoint,
} from "@/lib/types";

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

// ── Runs ───────────────────────────────────────────────

export const runs: Run[] = [
  {
    id: "run-001",
    name: "Momentum + Quality V3",
    strategyId: "momentum_12_1",
    status: "completed",
    metrics: {
      cagr: 24.7,
      sharpe: 1.84,
      maxDrawdown: -8.3,
      turnover: 42.1,
      volatility: 13.4,
      winRate: 64.2,
      profitFactor: 2.1,
      calmar: 2.97,
    },
    startDate: "2024-01-01",
    endDate: "2025-01-01",
    createdAt: "2025-01-15T10:30:00Z",
  },
  {
    id: "run-002",
    name: "ML Alpha Signal R2",
    strategyId: "ml_lightgbm",
    status: "completed",
    metrics: {
      cagr: 18.3,
      sharpe: 2.12,
      maxDrawdown: -4.1,
      turnover: 68.3,
      volatility: 8.6,
      winRate: 58.9,
      profitFactor: 1.85,
      calmar: 4.46,
    },
    startDate: "2024-06-01",
    endDate: "2025-01-01",
    createdAt: "2025-01-14T14:20:00Z",
  },
  {
    id: "run-003",
    name: "Macro Regime Switching",
    strategyId: "ml_ridge",
    status: "running",
    metrics: {
      cagr: 0,
      sharpe: 0,
      maxDrawdown: 0,
      turnover: 0,
      volatility: 0,
      winRate: 0,
      profitFactor: 0,
      calmar: 0,
    },
    startDate: "2023-01-01",
    endDate: "2025-01-01",
    createdAt: "2025-01-16T08:00:00Z",
  },
  {
    id: "run-004",
    name: "Stat Arb Pairs V7",
    strategyId: "momentum_12_1",
    status: "completed",
    metrics: {
      cagr: 15.9,
      sharpe: 1.56,
      maxDrawdown: -6.7,
      turnover: 124.5,
      volatility: 10.2,
      winRate: 61.3,
      profitFactor: 1.72,
      calmar: 2.37,
    },
    startDate: "2024-03-01",
    endDate: "2025-01-01",
    createdAt: "2025-01-13T16:45:00Z",
  },
  {
    id: "run-005",
    name: "NLP Sentiment Alpha",
    strategyId: "ml_lightgbm",
    status: "failed",
    metrics: {
      cagr: -2.1,
      sharpe: 0.42,
      maxDrawdown: -18.4,
      turnover: 89.2,
      volatility: 22.1,
      winRate: 44.8,
      profitFactor: 0.91,
      calmar: -0.11,
    },
    startDate: "2024-09-01",
    endDate: "2025-01-15",
    createdAt: "2025-01-12T09:30:00Z",
  },
  {
    id: "run-006",
    name: "Factor Timing V2",
    strategyId: "ml_ridge",
    status: "completed",
    metrics: {
      cagr: 21.2,
      sharpe: 1.71,
      maxDrawdown: -9.8,
      turnover: 55.0,
      volatility: 12.4,
      winRate: 59.7,
      profitFactor: 1.94,
      calmar: 2.16,
    },
    startDate: "2024-01-01",
    endDate: "2025-01-01",
    createdAt: "2025-01-11T11:00:00Z",
  },
  {
    id: "run-007",
    name: "Cross-Asset Momentum",
    strategyId: "momentum_12_1",
    status: "queued",
    metrics: {
      cagr: 0,
      sharpe: 0,
      maxDrawdown: 0,
      turnover: 0,
      volatility: 0,
      winRate: 0,
      profitFactor: 0,
      calmar: 0,
    },
    startDate: "2023-06-01",
    endDate: "2025-01-01",
    createdAt: "2025-01-16T09:00:00Z",
  },
  {
    id: "run-008",
    name: "Volatility Surface Arb",
    strategyId: "equal_weight",
    status: "completed",
    metrics: {
      cagr: 31.5,
      sharpe: 2.45,
      maxDrawdown: -5.2,
      turnover: 210.3,
      volatility: 12.8,
      winRate: 67.1,
      profitFactor: 2.63,
      calmar: 6.06,
    },
    startDate: "2024-01-01",
    endDate: "2025-01-01",
    createdAt: "2025-01-10T13:15:00Z",
  },
];

// ── Holdings ───────────────────────────────────────────

export const holdings: Holding[] = [
  { ticker: "AAPL", name: "Apple Inc.", weight: 8.2, sector: "Technology", pnl: 3420.5 },
  { ticker: "NVDA", name: "NVIDIA Corp.", weight: 7.5, sector: "Technology", pnl: 8910.2 },
  { ticker: "MSFT", name: "Microsoft Corp.", weight: 6.8, sector: "Technology", pnl: 2150.8 },
  { ticker: "JPM", name: "JPMorgan Chase", weight: 5.4, sector: "Financials", pnl: 1820.3 },
  { ticker: "UNH", name: "UnitedHealth Group", weight: 4.9, sector: "Healthcare", pnl: -890.4 },
  { ticker: "LLY", name: "Eli Lilly", weight: 4.6, sector: "Healthcare", pnl: 5620.1 },
  { ticker: "XOM", name: "Exxon Mobil", weight: 4.1, sector: "Energy", pnl: -420.9 },
  { ticker: "AMZN", name: "Amazon.com", weight: 3.8, sector: "Consumer Disc.", pnl: 2780.6 },
  { ticker: "MA", name: "Mastercard Inc.", weight: 3.2, sector: "Financials", pnl: 1540.2 },
  { ticker: "COST", name: "Costco Wholesale", weight: 2.9, sector: "Consumer Staples", pnl: 960.8 },
  { ticker: "CAT", name: "Caterpillar Inc.", weight: 2.6, sector: "Industrials", pnl: 1120.4 },
  { ticker: "AVGO", name: "Broadcom Inc.", weight: 2.4, sector: "Technology", pnl: 4230.7 },
];

// ── Trades ─────────────────────────────────────────────

export const trades: Trade[] = [
  { id: "t-001", date: "2025-01-15", ticker: "NVDA", side: "buy", qty: 50, price: 142.3, pnl: 0 },
  {
    id: "t-002",
    date: "2025-01-15",
    ticker: "XOM",
    side: "sell",
    qty: 120,
    price: 108.5,
    pnl: -420.9,
  },
  { id: "t-003", date: "2025-01-14", ticker: "AAPL", side: "buy", qty: 80, price: 231.2, pnl: 0 },
  {
    id: "t-004",
    date: "2025-01-14",
    ticker: "UNH",
    side: "sell",
    qty: 30,
    price: 548.6,
    pnl: -890.4,
  },
  { id: "t-005", date: "2025-01-13", ticker: "LLY", side: "buy", qty: 25, price: 782.1, pnl: 0 },
  { id: "t-006", date: "2025-01-13", ticker: "MSFT", side: "buy", qty: 45, price: 418.9, pnl: 0 },
  { id: "t-007", date: "2025-01-10", ticker: "JPM", side: "buy", qty: 60, price: 242.8, pnl: 0 },
  {
    id: "t-008",
    date: "2025-01-10",
    ticker: "MA",
    side: "sell",
    qty: 35,
    price: 512.4,
    pnl: 1540.2,
  },
  { id: "t-009", date: "2025-01-09", ticker: "AVGO", side: "buy", qty: 20, price: 228.4, pnl: 0 },
  {
    id: "t-010",
    date: "2025-01-09",
    ticker: "COST",
    side: "sell",
    qty: 15,
    price: 912.3,
    pnl: 960.8,
  },
];

// ── Jobs ───────────────────────────────────────────────

export const jobs: Job[] = [
  {
    id: "j-001",
    name: "Macro Regime Switching",
    status: "running",
    progress: 67,
    startedAt: "2025-01-16T08:00:00Z",
    duration: "2h 14m",
  },
  {
    id: "j-002",
    name: "Cross-Asset Momentum",
    status: "queued",
    progress: 0,
    startedAt: "",
    duration: "--",
  },
  {
    id: "j-003",
    name: "Factor Timing V2",
    status: "completed",
    progress: 100,
    startedAt: "2025-01-11T11:00:00Z",
    duration: "4h 32m",
  },
  {
    id: "j-004",
    name: "NLP Sentiment Alpha",
    status: "failed",
    progress: 84,
    startedAt: "2025-01-12T09:30:00Z",
    duration: "1h 47m",
  },
];

// ── Feature Importance ─────────────────────────────────

export const featureImportance: FeatureImportance[] = [
  { feature: "12m Momentum", importance: 0.182 },
  { feature: "Earnings Surprise", importance: 0.156 },
  { feature: "Vol Surface Skew", importance: 0.134 },
  { feature: "Short Interest", importance: 0.121 },
  { feature: "Book/Price Ratio", importance: 0.098 },
  { feature: "Analyst Revision", importance: 0.087 },
  { feature: "Credit Spread", importance: 0.072 },
  { feature: "Sector Momentum", importance: 0.064 },
  { feature: "Liquidity Score", importance: 0.048 },
  { feature: "Macro Regime", importance: 0.038 },
];

// ── Model Metadata ─────────────────────────────────────

export const modelMeta: ModelMeta = {
  name: "XGBoost Alpha v3.2",
  type: "Gradient Boosted Trees",
  accuracy: 0.721,
  precision: 0.698,
  recall: 0.743,
  f1: 0.72,
  auc: 0.801,
  trainDate: "2025-01-10",
  features: 47,
  samples: 124500,
};

// ── Turnover Chart ─────────────────────────────────────

export const turnoverData: TurnoverPoint[] = (() => {
  const data: TurnoverPoint[] = [];
  const startDate = new Date("2024-01-02");
  for (let i = 0; i < 12; i++) {
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + i);
    data.push({
      date: date.toISOString().split("T")[0],
      turnover: Math.round((30 + Math.random() * 40) * 10) / 10,
    });
  }
  return data;
})();
