/**
 * Central configuration for the FactorLab live QA audit.
 * Adjust BASE_URL, credentials, and canonical defaults before running.
 */

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"

export const CREDENTIALS = {
  email: process.env.AUDIT_EMAIL ?? "audit@factorlab.local",
  password: process.env.AUDIT_PASSWORD ?? "audit-password-here",
}

// ── Matrix dimensions ──────────────────────────────────────────────────────

export const STRATEGIES = [
  "equal_weight",
  "momentum_12_1",
  "low_vol",
  "trend_filter",
  "ml_ridge",
  "ml_lightgbm",
] as const

export type StrategyId = (typeof STRATEGIES)[number]

export const UNIVERSES = ["ETF8", "SP100", "NASDAQ100"] as const
export type UniverseId = (typeof UNIVERSES)[number]

export const BENCHMARKS = [
  "SPY",
  "QQQ",
  "IWM",
  "VTI",
  "EFA",
  "EEM",
  "TLT",
  "GLD",
  "VNQ",
] as const
export type BenchmarkId = (typeof BENCHMARKS)[number]

// ── Universe metadata ──────────────────────────────────────────────────────

export const UNIVERSE_SIZES: Record<UniverseId, number> = {
  ETF8: 8,
  SP100: 20,
  NASDAQ100: 20,
}

export const UNIVERSE_PRESETS: Record<UniverseId, readonly string[]> = {
  ETF8: ["SPY", "QQQ", "IWM", "EFA", "EEM", "TLT", "GLD", "VNQ"],
  SP100: [
    "AAPL","MSFT","AMZN","GOOGL","GOOG","META","NVDA","BRK-B",
    "JPM","XOM","UNH","JNJ","PG","V","MA","HD","COST","ABBV","PEP","MRK",
  ],
  NASDAQ100: [
    "AAPL","MSFT","NVDA","AMZN","META","GOOGL","GOOG","AVGO",
    "COST","TSLA","NFLX","AMD","ADBE","CSCO","PEP","INTC",
    "QCOM","AMGN","TXN","CMCSA",
  ],
}

// ── Strategy metadata ──────────────────────────────────────────────────────

export const STRATEGY_LABELS: Record<StrategyId, string> = {
  equal_weight: "Equal Weight",
  momentum_12_1: "Momentum 12-1",
  ml_ridge: "ML Ridge",
  ml_lightgbm: "ML LightGBM",
  low_vol: "Low Volatility",
  trend_filter: "Trend Filter",
}

export const ML_STRATEGIES = new Set<StrategyId>(["ml_ridge", "ml_lightgbm"])

/** Calendar days of price history required BEFORE backtest start_date */
export const STRATEGY_WARMUP_DAYS: Record<StrategyId, number> = {
  equal_weight: 0,
  momentum_12_1: 390,
  ml_ridge: 730,
  ml_lightgbm: 730,
  low_vol: 90,
  trend_filter: 390,
}

// ── Canonical defaults ─────────────────────────────────────────────────────

/**
 * Canonical start date used for ALL runs unless preflight snaps it.
 * Set far enough back that every strategy's warmup is satisfied.
 * 2019-01-01 gives 4+ years before end-of-2024 data cutoff, satisfying
 * even ML strategies (730 calendar day warmup, data starts ~2015).
 */
export const CANONICAL_START_DATE = "2019-01-01"

/** End date — set to a date that is likely within the data cutoff.
 * The form will snap this to the actual cutoff if needed. */
export const CANONICAL_END_DATE = "2025-12-31"

export const CANONICAL_COSTS_BPS = 10

/** Top N per universe — a reasonable non-trivial subset */
export const CANONICAL_TOP_N: Record<UniverseId, number> = {
  ETF8: 5,
  SP100: 10,
  NASDAQ100: 10,
}

/** Initial capital */
export const CANONICAL_INITIAL_CAPITAL = 100_000

// ── Timing ────────────────────────────────────────────────────────────────

/**
 * Max time to wait for benchmark data ingestion to complete before the backtest
 * can start. Only applies when a run enters `waiting_for_data` immediately after
 * creation (i.e. the benchmark ticker is not yet ingested).
 * First-attempt failures due to this timeout are recorded as FAIL with
 * failCause="benchmark_ingestion_timeout" and are retried in the RERUN pass.
 */
export const BENCHMARK_READY_TIMEOUT_MS =
  Number(process.env.BENCHMARK_READY_TIMEOUT_MS) || 45 * 60 * 1_000 // 45 min

/** Max time to wait for a run to complete once it has left waiting_for_data. */
export const RUN_COMPLETION_TIMEOUT_MS =
  Number(process.env.RUN_TIMEOUT_MS) || 30 * 60 * 1_000 // 30 min

/** Poll interval for run status (ms) */
export const RUN_POLL_INTERVAL_MS = 15_000

/** Max time to wait for run form page to be ready (ms) */
export const FORM_READY_TIMEOUT_MS = 60_000

// ── Filtering (for partial runs / resumability) ────────────────────────────

/** If set, only audit runs matching this strategy */
export const FILTER_STRATEGY = process.env.FILTER_STRATEGY as StrategyId | undefined

/** If set, only audit runs matching this universe */
export const FILTER_UNIVERSE = process.env.FILTER_UNIVERSE as UniverseId | undefined

/** If set, only audit runs matching this benchmark */
export const FILTER_BENCHMARK = process.env.FILTER_BENCHMARK as BenchmarkId | undefined

/** If true, skip combinations that already have a verdict in results.json */
export const RESUME_MODE = process.env.RESUME === "1"

// ── Artifacts ─────────────────────────────────────────────────────────────

export const ARTIFACTS_DIR = "./artifacts"
export const RESULTS_FILE = `${ARTIFACTS_DIR}/results/audit-results.json`
export const CSV_FILE = `${ARTIFACTS_DIR}/results/audit-results.csv`
export const MARKDOWN_FILE = `${ARTIFACTS_DIR}/results/audit-report.md`
export const SCREENSHOTS_DIR = `${ARTIFACTS_DIR}/screenshots`
export const REPORTS_DIR = `${ARTIFACTS_DIR}/reports`

// ── Targeted test artifacts ────────────────────────────────────────────────
export const TARGETED_RESULTS_FILE = `${ARTIFACTS_DIR}/results/targeted-results.json`
export const TARGETED_CSV_FILE = `${ARTIFACTS_DIR}/results/targeted-results.csv`
export const TARGETED_MARKDOWN_FILE = `${ARTIFACTS_DIR}/results/targeted-report.md`
