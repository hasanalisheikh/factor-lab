export type CoverageStatsSnapshot = {
  firstDate: string | null;
  lastDate: string | null;
};

export type BenchmarkCoverageStatus = "good" | "warning" | "blocked";
export type BenchmarkMetricSource = "research_window" | "run_window" | "db_wide";

export type BenchmarkCoverageComputation = {
  benchmarkTicker: string;
  firstDate: string | null;
  lastDate: string | null;
  metricSourceUsed: BenchmarkMetricSource;
  windowStartUsed: string;
  windowEndUsed: string;
  expectedDays: number;
  actualDays: number;
  missingDays: number;
  trueMissingRate: number;
  status: BenchmarkCoverageStatus;
};

export type PreflightStatus = "READY" | "WAITING_FOR_DATA" | "USER_ACTION_REQUIRED";

export type SymbolCoverageStatus = "healthy" | "partial" | "not_ingested";

export type SymbolCoverage = {
  symbol: string;
  /** True when this symbol is the run benchmark */
  isBenchmark: boolean;
  /** Rows found in [requiredStart, requiredEnd] */
  actualDays: number;
  /** Business-day count in [requiredStart, requiredEnd] (Mon-Fri approximation) */
  expectedDays: number;
  /** actualDays / expectedDays (0-1) */
  coverageRatio: number;
  /** Applied threshold (0-1) */
  threshold: number;
  status: SymbolCoverageStatus;
};

export type CoverageHealthStatus = "good" | "warning" | "blocked";

export type RunPreflightStatus = "ok" | "warn" | "block";
export type RunPreflightIssueSeverity = "good" | "warning" | "blocked";

export type PreflightSuggestedFix = {
  kind:
    | "clamp_start_date"
    | "clamp_end_date"
    | "queue_data_repairs"
    | "reduce_top_n"
    | "set_top_n"
    | "retry_repairs"
    | "change_benchmark";
  value?: string | number | string[];
};

export type RunPreflightIssueAction =
  | { kind: "clamp_start_date"; value: string; label: string }
  | { kind: "clamp_end_date"; value: string; label: string }
  | { kind: "reduce_top_n"; value: number; label: string }
  | { kind: "set_top_n"; value: number; label: string }
  | { kind: "retry_repairs"; value: string[]; label: string }
  | { kind: "change_benchmark"; value: string; label: string };

export type RunPreflightIssue = {
  severity: RunPreflightIssueSeverity;
  code: string;
  reason: string;
  fix: string;
  action: RunPreflightIssueAction | null;
};

export type RunPreflightConstraints = {
  dataCutoffDate: string;
  universeEarliestStart: string | null;
  universeValidFrom: string | null;
  minStartDate: string | null;
  maxEndDate: string;
  missingTickers: string[];
  warmupStart: string;
  requiredStart: string;
  requiredEnd: string;
};

export type MissingnessCoverageRow = {
  symbol: string;
  isBenchmark: boolean;
  firstDate: string | null;
  lastDate: string | null;
  windowStart: string | null;
  expectedDays: number;
  actualDays: number;
  trueMissingDays: number;
  trueMissingRate: number;
};

export type BenchmarkSuggestionCandidate = {
  symbol: string;
  status: RunPreflightStatus;
  benchmarkTrueMissingRate: number;
  affectedShare: number;
};

export type RunPreflightCoverageSummary = {
  benchmark: {
    status: CoverageHealthStatus;
    reason: string | null;
    metricSourceUsed: BenchmarkMetricSource;
    trueMissingRate: number;
    symbol: string;
    windowStartUsed: string;
    windowEndUsed: string;
    expectedDays: number;
    actualDays: number;
    missingDays: number;
  };
  universe: {
    status: CoverageHealthStatus;
    reason: string | null;
    over2Percent: string[];
    over10Percent: string[];
    affectedShare: number;
  };
  symbols: MissingnessCoverageRow[];
  benchmarkCandidates: BenchmarkSuggestionCandidate[];
};

export type RunPreflightResult = {
  status: RunPreflightStatus;
  issues: RunPreflightIssue[];
  reasons: string[];
  suggested_fixes: PreflightSuggestedFix[];
  constraints: RunPreflightConstraints;
  coverage: RunPreflightCoverageSummary;
  warmupStart: string;
  requiredStart: string;
  requiredEnd: string;
};

export type RunPreflightSnapshot = {
  constraints: RunPreflightConstraints;
  coverage: RunPreflightCoverageSummary;
  warmupStart: string;
  requiredStart: string;
  requiredEnd: string;
};

export type PreflightResult = {
  /** Canonical classification -- use this to decide what to do next. */
  status: PreflightStatus;
  /**
   * Plain-English reasons the run can't proceed as-is.
   * Non-empty only when status != READY.
   * For USER_ACTION_REQUIRED these are the messages shown to the user.
   * For WAITING_FOR_DATA they describe what's being auto-fixed.
   */
  reasons: string[];
  /** @deprecated Use `status === "READY"` instead. Kept for backward compat. */
  allHealthy: boolean;
  /** Symbols below their coverage threshold */
  unhealthy: SymbolCoverage[];
  /** All symbols checked */
  all: SymbolCoverage[];
  /** Warmup-adjusted start date used for the coverage window */
  requiredStart: string;
  requiredEnd: string;
};
