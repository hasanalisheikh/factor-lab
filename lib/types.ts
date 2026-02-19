// ── Status & Strategy ──────────────────────────────────

export type RunStatus = "queued" | "running" | "completed" | "failed"

export type StrategyId =
  | "equal_weight"
  | "momentum_12_1"
  | "ml_ridge"
  | "ml_lightgbm"

export const STRATEGY_LABELS: Record<StrategyId, string> = {
  equal_weight: "Equal Weight",
  momentum_12_1: "Momentum 12-1",
  ml_ridge: "ML Ridge",
  ml_lightgbm: "ML LightGBM",
}

// ── Core Domain Types ──────────────────────────────────

export type Metrics = {
  cagr: number
  sharpe: number
  maxDrawdown: number
  turnover: number
  volatility: number
  winRate: number
  profitFactor: number
  calmar: number
}

export type Run = {
  id: string
  name: string
  strategyId: StrategyId
  status: RunStatus
  metrics: Metrics
  startDate: string
  endDate: string
  createdAt: string
}

export type EquityPoint = {
  date: string
  portfolio: number
  benchmark: number
}

export type DrawdownPoint = {
  date: string
  drawdown: number
}

export type Holding = {
  ticker: string
  name: string
  weight: number
  sector: string
  pnl: number
}

export type Trade = {
  id: string
  date: string
  ticker: string
  side: "buy" | "sell"
  qty: number
  price: number
  pnl: number
}

export type Job = {
  id: string
  name: string
  status: RunStatus
  progress: number
  startedAt: string
  duration: string
}

export type FeatureImportance = {
  feature: string
  importance: number
}

export type ModelMeta = {
  name: string
  type: string
  accuracy: number
  precision: number
  recall: number
  f1: number
  auc: number
  trainDate: string
  features: number
  samples: number
}

export type DashboardMetric = {
  label: string
  value: string
  delta: number
  deltaLabel: string
  sparkline: number[]
}

export type TurnoverPoint = {
  date: string
  turnover: number
}
