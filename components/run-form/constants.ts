import { STRATEGY_LABELS } from "@/lib/types";

import type { StrategyId } from "@/lib/types";

export const STRATEGIES = Object.entries(STRATEGY_LABELS) as [StrategyId, string][];

export const CAPITAL_MIN = 1_000;
export const CAPITAL_MAX = 10_000_000;
export const CAPITAL_DEFAULT = 100_000;
export const CAPITAL_PRESETS = [
  { label: "10k", value: 10_000 },
  { label: "100k", value: 100_000 },
  { label: "1m", value: 1_000_000 },
] as const;
