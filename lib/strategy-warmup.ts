import type { StrategyId } from "@/lib/types";

/**
 * Calendar days of price history required BEFORE the backtest start_date
 * for each strategy to produce valid signals on the first rebalance date.
 *
 * Derivation:
 *   equal_weight:  0       — no lookback needed
 *   momentum_12_1: 390     — 252 (1yr) + 21 (skip-month) trading days ≈ 390 calendar days
 *   ml_ridge:      730     — 504-day training window (ML_TRAIN_WINDOW_DAYS) ≈ 730 calendar days
 *   ml_lightgbm:   730     — same as ml_ridge
 *   low_vol:        90     — 60-day rolling vol window ≈ 90 calendar days
 *   trend_filter:  390     — 200-day benchmark SMA plus momentum lookback for
 *                            the risk-on sleeve; use the larger warmup window
 */
export const STRATEGY_WARMUP_CALENDAR_DAYS: Record<StrategyId, number> = {
  equal_weight: 0,
  momentum_12_1: 390,
  ml_ridge: 730,
  ml_lightgbm: 730,
  low_vol: 90,
  trend_filter: 390,
};

export const STRATEGY_WARMUP_DESCRIPTIONS: Record<StrategyId, string> = {
  equal_weight: "",
  momentum_12_1:
    "Requires 12-month momentum lookback + 1-month skip (≈390 calendar days of history before start)",
  ml_ridge:
    "Requires ≈2 years of daily training data before backtest start (ML_TRAIN_WINDOW_DAYS=504 trading days)",
  ml_lightgbm:
    "Requires ≈2 years of daily training data before backtest start (ML_TRAIN_WINDOW_DAYS=504 trading days)",
  low_vol:
    "Requires 60-day realized volatility lookback (≈90 calendar days of history before start)",
  trend_filter:
    "Requires a 200-day benchmark SMA plus momentum history for the risk-on sleeve (≈390 calendar days of history before start)",
};

/**
 * Returns the earliest recommended start date for a given strategy,
 * given the global minimum date available in the DB.
 * Returns null if globalMinDate is null (no data ingested yet).
 */
export function computeStrategyEarliestStart(
  strategyId: StrategyId,
  globalMinDate: string | null
): string | null {
  if (!globalMinDate) return null;
  const warmup = STRATEGY_WARMUP_CALENDAR_DAYS[strategyId];
  if (!warmup) return globalMinDate;
  const d = new Date(`${globalMinDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + warmup);
  return d.toISOString().slice(0, 10);
}
