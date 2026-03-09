// ── Status & Strategy ──────────────────────────────────

export type RunStatus = "queued" | "running" | "completed" | "failed" | "waiting_for_data"

export type StrategyId =
  | "equal_weight"
  | "momentum_12_1"
  | "ml_ridge"
  | "ml_lightgbm"
  | "low_vol"
  | "trend_filter"

export const STRATEGY_LABELS: Record<StrategyId, string> = {
  equal_weight: "Equal Weight",
  momentum_12_1: "Momentum 12-1",
  ml_ridge: "ML Ridge",
  ml_lightgbm: "ML LightGBM",
  low_vol: "Low Volatility",
  trend_filter: "Trend Filter",
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
  /** Pre-formatted display value, e.g. "+22.4%", "2.02", "8.3%" or "—" */
  value: string
  /** Raw signed number used only for green/red direction logic */
  deltaRaw: number | null
  /** Pre-formatted delta string, e.g. "+3.2 pp", "+0.15", or null when unavailable */
  deltaFormatted: string | null
  /** Short label shown after the delta value, e.g. "vs SPY" */
  deltaLabel: string
  /** When true: negative delta is GOOD (Max Drawdown, Turnover) */
  lowerIsBetter: boolean
  sparkline: number[]
}

export type TurnoverPoint = {
  date: string
  turnover: number
}
