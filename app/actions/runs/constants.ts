import type { StrategyId } from "@/lib/types";

export const ML_STRATEGIES = new Set<StrategyId>(["ml_ridge", "ml_lightgbm"]);
export const RANKING_STRATEGIES = new Set<StrategyId>([
  "momentum_12_1",
  "low_vol",
  "trend_filter",
  "ml_ridge",
  "ml_lightgbm",
]);
export const TREND_DEFENSIVE_PRIMARY = "TLT";
export const TREND_DEFENSIVE_FALLBACK = "BIL";
export const RUN_DELETE_BLOCKED_STATUSES = new Set(["queued", "running", "waiting_for_data"]);
export const RETRY_WAKE_MIN_AGE_SECONDS: Record<1 | 2, number> = {
  1: 45,
  2: 90,
};
