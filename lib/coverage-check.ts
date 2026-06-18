import "server-only";

export {
  BENCHMARK_COVERAGE_THRESHOLD,
  HIGH_SENSITIVITY_UNIVERSE_THRESHOLD,
  UNIVERSE_COVERAGE_THRESHOLD,
  getUniverseThreshold,
} from "@/lib/coverage-check/thresholds";
export {
  countBusinessDays,
  getSafeLastDate,
  resolveRunPreflightWindow,
  subtractCalendarDays,
} from "@/lib/coverage-check/date-utils";
export { getStrategyWarmupTradingDays } from "@/lib/coverage-check/warmup";
export { computeBenchmarkCoverage } from "@/lib/coverage-check/benchmark-coverage";
export { runPreflightCoverageCheck } from "@/lib/coverage-check/legacy-preflight";
export {
  buildRunPreflightResult,
  buildRunPreflightSnapshot,
  buildUniverseCoverageStatus,
  finalizeRunPreflightResult,
} from "@/lib/coverage-check/preflight-result";
export {
  evaluateRunPreflight,
  evaluateRunPreflightSnapshot,
} from "@/lib/coverage-check/evaluation";
export { getActiveIngestTickers } from "@/lib/coverage-check/ingest";
export { formatPreflightDiagnostic } from "@/lib/coverage-check/classification";

export type {
  BenchmarkCoverageComputation,
  BenchmarkCoverageStatus,
  BenchmarkMetricSource,
  BenchmarkSuggestionCandidate,
  CoverageHealthStatus,
  CoverageStatsSnapshot,
  MissingnessCoverageRow,
  PreflightResult,
  PreflightStatus,
  PreflightSuggestedFix,
  RunPreflightConstraints,
  RunPreflightCoverageSummary,
  RunPreflightIssue,
  RunPreflightIssueAction,
  RunPreflightIssueSeverity,
  RunPreflightResult,
  RunPreflightSnapshot,
  RunPreflightStatus,
  SymbolCoverage,
  SymbolCoverageStatus,
} from "@/lib/coverage-check/types";
