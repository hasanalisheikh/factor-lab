export type Verdict = "PASS" | "VALID-BLOCK" | "FAIL"

/** Root cause category for FAIL verdicts — used to route into the correct report section. */
export type FailCause =
  | "benchmark_ingestion_timeout"  // run stayed in waiting_for_data beyond BENCHMARK_READY_TIMEOUT_MS
  | "run_timeout"                  // run left waiting_for_data but didn't complete within RUN_COMPLETION_TIMEOUT_MS
  | "check_failure"                // one or more audit checks failed
  | "preflight_block"              // unexpected preflight block
  | null

export type AuditResult = {
  key: string
  strategy: string
  universe: string
  benchmark: string
  index: number

  // Test type — "matrix" for the 162-run matrix, "targeted" for named edge-case tests
  test_type: "matrix" | "targeted"
  testName: string | null

  // Attempt tracking
  attempt: 1 | 2
  firstAttemptVerdict: Verdict | null    // populated on attempt-2 records
  benchmarkPendingRunId: string | null   // set on attempt-1 when failCause=benchmark_ingestion_timeout
  benchmarkWaitMs: number | null         // ms spent waiting for benchmark ingestion (phase 1)
  failCause: FailCause

  // Dates
  attemptedStartDate: string
  attemptedEndDate: string
  effectiveStartDate: string | null
  effectiveEndDate: string | null
  cutoffDateUsed: string | null

  // Run identity
  runId: string | null
  runName: string | null
  reportFilename: string | null

  // Verdict
  verdict: Verdict
  verdictReason: string

  // Preflight
  preflightStatus: "ok" | "warn" | "block" | "error" | "skipped" | null
  preflightMessages: string[]

  // KPIs (from UI)
  uiCagr: string | null
  uiSharpe: string | null
  uiMaxDrawdown: string | null
  uiVolatility: string | null
  uiWinRate: string | null
  uiProfitFactor: string | null
  uiTurnover: string | null
  uiCalmar: string | null

  // KPIs (from tearsheet)
  reportCagr: string | null
  reportSharpe: string | null
  reportMaxDrawdown: string | null
  reportVolatility: string | null
  reportWinRate: string | null
  reportProfitFactor: string | null
  reportTurnover: string | null
  reportCalmar: string | null

  // Config (from UI run detail)
  uiStrategyLabel: string | null
  uiUniverse: string | null
  uiBenchmark: string | null
  uiPeriod: string | null
  uiCosts: string | null
  uiRebalance: string | null
  uiConstruction: string | null
  uiTopN: string | null

  // Config (from tearsheet)
  reportStrategyLabel: string | null
  reportBenchmark: string | null
  reportWindow: string | null
  reportUniverse: string | null
  reportRebalanceFreq: string | null
  reportTopN: string | null
  reportCosts: string | null

  // Holdings
  holdingsWeightSum: number | null
  holdingsCount: number | null

  // Trades
  tradesCount: number | null

  // ML Insights (ml_ridge/ml_lightgbm only)
  mlInsightsPresent: boolean | null
  mlFeatureImportancePresent: boolean | null
  mlLatestPicksWeightSum: number | null
  mlTrainWindow: string | null
  mlRebalancesCount: string | null

  // Chart date range
  chartStartLabel: string | null
  chartEndLabel: string | null

  // Consistency checks
  checks: CheckResult[]

  // Failures (non-passing checks)
  failures: string[]

  // Timing
  startedAt: string
  completedAt: string | null
  runCompletionMs: number | null
}

export type CheckResult = {
  name: string
  passed: boolean
  detail: string
}

export function makeEmptyResult(combo: {
  key: string
  strategy: string
  universe: string
  benchmark: string
  index: number
  canonicalStartDate: string
  canonicalEndDate: string
  runName: string
}): AuditResult {
  return {
    key: combo.key,
    strategy: combo.strategy,
    universe: combo.universe,
    benchmark: combo.benchmark,
    index: combo.index,
    test_type: "matrix",
    testName: null,
    attempt: 1,
    firstAttemptVerdict: null,
    benchmarkPendingRunId: null,
    benchmarkWaitMs: null,
    failCause: null,
    attemptedStartDate: combo.canonicalStartDate,
    attemptedEndDate: combo.canonicalEndDate,
    effectiveStartDate: null,
    effectiveEndDate: null,
    cutoffDateUsed: null,
    runId: null,
    runName: combo.runName,
    reportFilename: null,
    verdict: "FAIL",
    verdictReason: "Not started",
    preflightStatus: null,
    preflightMessages: [],
    uiCagr: null,
    uiSharpe: null,
    uiMaxDrawdown: null,
    uiVolatility: null,
    uiWinRate: null,
    uiProfitFactor: null,
    uiTurnover: null,
    uiCalmar: null,
    reportCagr: null,
    reportSharpe: null,
    reportMaxDrawdown: null,
    reportVolatility: null,
    reportWinRate: null,
    reportProfitFactor: null,
    reportTurnover: null,
    reportCalmar: null,
    uiStrategyLabel: null,
    uiUniverse: null,
    uiBenchmark: null,
    uiPeriod: null,
    uiCosts: null,
    uiRebalance: null,
    uiConstruction: null,
    uiTopN: null,
    reportStrategyLabel: null,
    reportBenchmark: null,
    reportWindow: null,
    reportUniverse: null,
    reportRebalanceFreq: null,
    reportTopN: null,
    reportCosts: null,
    holdingsWeightSum: null,
    holdingsCount: null,
    tradesCount: null,
    mlInsightsPresent: null,
    mlFeatureImportancePresent: null,
    mlLatestPicksWeightSum: null,
    mlTrainWindow: null,
    mlRebalancesCount: null,
    chartStartLabel: null,
    chartEndLabel: null,
    checks: [],
    failures: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    runCompletionMs: null,
  }
}

export function addCheck(result: AuditResult, name: string, passed: boolean, detail: string): void {
  result.checks.push({ name, passed, detail })
  if (!passed) {
    result.failures.push(`[${name}] ${detail}`)
  }
}

export function finalizeVerdict(result: AuditResult): void {
  result.completedAt = new Date().toISOString()
  if (result.startedAt && result.completedAt) {
    result.runCompletionMs = new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime()
  }

  // If already marked VALID-BLOCK, keep it (preflight classified it)
  if (result.verdict === "VALID-BLOCK") return

  // If there are any failures, mark as FAIL and infer failCause if not already set
  if (result.failures.length > 0) {
    result.verdict = "FAIL"
    result.verdictReason = result.failures[0]
    if (!result.failCause) {
      // Infer cause from the first failure message
      const f = result.failures[0].toLowerCase()
      if (f.includes("benchmark_ingestion_timeout") || f.includes("waiting_for_data")) {
        result.failCause = "benchmark_ingestion_timeout"
      } else if (f.includes("timed out") || f.includes("timeout")) {
        result.failCause = "run_timeout"
      } else if (f.includes("preflight") || f.includes("block")) {
        result.failCause = "preflight_block"
      } else {
        result.failCause = "check_failure"
      }
    }
    return
  }

  // All checks passed
  result.verdict = "PASS"
  result.verdictReason = `All ${result.checks.length} checks passed`
}
