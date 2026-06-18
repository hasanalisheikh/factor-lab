export const DATE_RANGE_OPTIONS = [1, 2, 3, 5, 7, 10] as const;
export const REBALANCE_OPTIONS = ["Monthly", "Weekly"] as const;
export const CAPITAL_MIN = 1_000;
export const CAPITAL_MAX = 10_000_000;
export const CAPITAL_DEFAULT = 100_000;
export const CAPITAL_PRESETS = [
  { label: "10k", value: 10_000 },
  { label: "100k", value: 100_000 },
  { label: "1m", value: 1_000_000 },
] as const;
