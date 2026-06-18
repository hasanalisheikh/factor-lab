import type { StrategyId } from "@/lib/types";

function getMinTrainDays(): number {
  return Number(process.env.ML_MIN_TRAIN_DAYS ?? "252");
}

export function getStrategyWarmupTradingDays(strategyId: StrategyId): number {
  if (strategyId === "momentum_12_1") return 252;
  if (strategyId === "low_vol") return 60;
  if (strategyId === "trend_filter") return 200;
  if (strategyId === "ml_ridge" || strategyId === "ml_lightgbm") {
    return 252 + getMinTrainDays();
  }
  return 0;
}
