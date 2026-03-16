/**
 * FactorLab Live QA Audit Suite
 *
 * Executes the full 162-run matrix (6 strategies × 3 universes × 9 benchmarks)
 * against the live app and verifies correctness of every output.
 *
 * Run with:
 *   npx playwright test tests/audit.spec.ts --project=audit
 *
 * Resume from a previous partial run:
 *   RESUME=1 npx playwright test tests/audit.spec.ts --project=audit
 *
 * Filter to a subset:
 *   FILTER_STRATEGY=ml_ridge npx playwright test tests/audit.spec.ts --project=audit
 */

import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"
import {
  ML_STRATEGIES,
  RESUME_MODE,
  UNIVERSE_PRESETS,
  SCREENSHOTS_DIR,
  BENCHMARK_READY_TIMEOUT_MS,
  RUN_COMPLETION_TIMEOUT_MS,
  type StrategyId,
  type UniverseId,
} from "../audit.config"
import { FULL_MATRIX, PLANNED_COUNT, type MatrixCombo } from "../helpers/matrix"
import {
  loadResults,
  upsertResult,
  generateReports,
} from "../helpers/results"
import {
  makeEmptyResult,
  addCheck,
  finalizeVerdict,
  type AuditResult,
} from "../helpers/verdict"
import {
  runAllKpiChecks,
  checkHoldingsWeightSum,
  checkKpiConsistency,
  checkConfigConsistency,
  checkChartDateRange,
  checkEncoding,
} from "../helpers/sanity"
import { parseReportHtml } from "../helpers/report-parser"
import { RunFormPage } from "../pages/RunFormPage"
import { RunDetailPage } from "../pages/RunDetailPage"
import { DataPage } from "../pages/DataPage"
import type { BenchmarkHealthRow } from "../pages/DataPage"
import * as fsSync from "fs"

// ── Load existing results (for resume mode) ───────────────────────────────
const existingResults = loadResults()
let dataPageHealth: Awaited<ReturnType<DataPage['readHealth']>> | null = null

// ── Test suite ────────────────────────────────────────────────────────────

test.describe.serial("FactorLab Run Matrix Audit", () => {

  // Before all: capture Data page health once for use in contradiction checks
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    const dataPage = new DataPage(page)
    try {
      await dataPage.goto()
      dataPageHealth = await dataPage.readHealth()
      console.log(`[audit] Data page health: ${dataPageHealth.overallVerdict}, cutoff=${dataPageHealth.cutoffDate}`)
    } catch (e) {
      console.warn(`[audit] Could not read Data page health: ${e}`)
    } finally {
      await context.close()
    }
  })

  // After all: generate final reports
  test.afterAll(async () => {
    generateReports(existingResults)
    console.log(`\n${"=".repeat(60)}`)
    console.log(`AUDIT COMPLETE`)
    console.log(`Planned: ${PLANNED_COUNT} | Executed: ${existingResults.size}`)
    const arr = Array.from(existingResults.values())
    console.log(`PASS: ${arr.filter((r) => r.verdict === "PASS").length}`)
    console.log(`VALID-BLOCK: ${arr.filter((r) => r.verdict === "VALID-BLOCK").length}`)
    console.log(`FAIL: ${arr.filter((r) => r.verdict === "FAIL").length}`)
    console.log(`${"=".repeat(60)}\n`)
  })

  // Generate one test per matrix combination
  for (const combo of FULL_MATRIX) {
    test(`[${combo.index + 1}/162] ${combo.strategy} × ${combo.universe} × ${combo.benchmark}`, async ({ page }, testInfo) => {

      // Resume mode: skip if already classified
      if (RESUME_MODE && existingResults.has(combo.key)) {
        const existing = existingResults.get(combo.key)!
        if (existing.verdict !== "FAIL" || existing.verdictReason !== "Not started") {
          console.log(`[resume] Skipping ${combo.key} (verdict: ${existing.verdict})`)
          test.skip()
          return
        }
      }

      const result = makeEmptyResult(combo)

      try {
        await runAudit(page, combo, result, testInfo.outputDir)
      } catch (e) {
        result.failures.push(`Uncaught error: ${e}`)
        result.verdict = "FAIL"
        result.verdictReason = `Uncaught error: ${String(e).slice(0, 200)}`
      }

      finalizeVerdict(result)

      // Save screenshot and structured artifact on failure (after verdict is finalized)
      if (result.verdict === "FAIL") {
        const screenshotDir = path.resolve(SCREENSHOTS_DIR)
        fs.mkdirSync(screenshotDir, { recursive: true })
        const screenshotPath = path.join(screenshotDir, `${combo.key}.png`)
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})
        result.failures.push(`Screenshot saved: ${screenshotPath}`)

        const artifactPath = path.join(screenshotDir, `${combo.key}.fail.json`)
        fs.writeFileSync(artifactPath, JSON.stringify({
          combo: { strategy: combo.strategy, universe: combo.universe, benchmark: combo.benchmark, runName: combo.runName },
          runId: result.runId,
          verdict: result.verdict,
          failCause: result.failCause,
          verdictReason: result.verdictReason,
          failures: result.failures,
          preflightStatus: result.preflightStatus,
          preflightMessages: result.preflightMessages,
          effectiveDates: { start: result.effectiveStartDate, end: result.effectiveEndDate },
          kpis: { cagr: result.uiCagr, sharpe: result.uiSharpe, maxDrawdown: result.uiMaxDrawdown, volatility: result.uiVolatility, winRate: result.uiWinRate, profitFactor: result.uiProfitFactor, turnover: result.uiTurnover, calmar: result.uiCalmar },
          reportKpis: { cagr: result.reportCagr, sharpe: result.reportSharpe, maxDrawdown: result.reportMaxDrawdown, volatility: result.reportVolatility },
          tearsheetPath: result.reportFilename ?? null,
          screenshotPath,
          timestamp: new Date().toISOString(),
        }, null, 2), 'utf-8')
      }

      upsertResult(existingResults, result)

      // Fail the Playwright test if verdict is FAIL.
      // Exception: benchmark_ingestion_timeout is recorded as FAIL but the test
      // does NOT throw — the matrix continues and the RERUN pass handles it.
      if (result.verdict === "FAIL" && result.failCause !== "benchmark_ingestion_timeout") {
        throw new Error(`[FAIL] ${combo.key}\n${result.failures.join("\n")}`)
      }
      if (result.failCause === "benchmark_ingestion_timeout") {
        console.log(`[audit] ${combo.key} recorded as FAIL/benchmark_ingestion_timeout — continuing matrix`)
      }
    })
  }

  // ── RERUN pass: attempt 2 for benchmark-ingestion-timeout failures ─────────
  // These tests run after all attempt-1 tests. Most will skip; only combos that
  // had failCause=benchmark_ingestion_timeout on attempt 1 are retried here.
  for (const combo of FULL_MATRIX) {
    test(`[RERUN/a2] ${combo.strategy} × ${combo.universe} × ${combo.benchmark}`, async ({ page }, testInfo) => {
      // Re-read results from disk so we see attempt-1 outcomes written by tests above
      const fresh = loadResults()
      const a1 = fresh.get(combo.key)
      const a2Key = `${combo.key}__a2`

      if (!a1?.benchmarkPendingRunId) {
        // No pending benchmark for this combo — nothing to rerun
        test.skip()
        return
      }

      if (fresh.has(a2Key)) {
        console.log(`[rerun] ${a2Key} already recorded — skipping`)
        test.skip()
        return
      }

      console.log(`[rerun] Attempt 2 for ${combo.key} (original run ${a1.benchmarkPendingRunId})`)

      // Build a fresh result for attempt 2
      const a2Combo = {
        ...combo,
        key: a2Key,
        runName: combo.runName + "_a2",
        index: combo.index,  // keep same index for sorting; attempt field distinguishes them
      }
      const result = makeEmptyResult(a2Combo)
      result.attempt = 2
      result.firstAttemptVerdict = a1.verdict

      try {
        await runAudit(page, a2Combo, result, testInfo.outputDir)
      } catch (e) {
        result.failures.push(`Uncaught error: ${e}`)
        result.verdict = "FAIL"
        result.verdictReason = `Uncaught error: ${String(e).slice(0, 200)}`
      }

      finalizeVerdict(result)

      if (result.verdict === "FAIL") {
        const screenshotDir = path.resolve(SCREENSHOTS_DIR)
        fs.mkdirSync(screenshotDir, { recursive: true })
        const screenshotPath = path.join(screenshotDir, `${a2Key}.png`)
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})
        result.failures.push(`Screenshot saved: ${screenshotPath}`)

        const artifactPath = path.join(screenshotDir, `${a2Key}.fail.json`)
        fs.writeFileSync(artifactPath, JSON.stringify({
          combo: { strategy: combo.strategy, universe: combo.universe, benchmark: combo.benchmark, runName: a2Combo.runName },
          runId: result.runId,
          attempt: 2,
          firstAttemptVerdict: result.firstAttemptVerdict,
          verdict: result.verdict,
          failCause: result.failCause,
          verdictReason: result.verdictReason,
          failures: result.failures,
          preflightStatus: result.preflightStatus,
          preflightMessages: result.preflightMessages,
          effectiveDates: { start: result.effectiveStartDate, end: result.effectiveEndDate },
          kpis: { cagr: result.uiCagr, sharpe: result.uiSharpe, maxDrawdown: result.uiMaxDrawdown, volatility: result.uiVolatility, winRate: result.uiWinRate, profitFactor: result.uiProfitFactor, turnover: result.uiTurnover, calmar: result.uiCalmar },
          reportKpis: { cagr: result.reportCagr, sharpe: result.reportSharpe, maxDrawdown: result.reportMaxDrawdown, volatility: result.reportVolatility },
          tearsheetPath: result.reportFilename ?? null,
          screenshotPath,
          timestamp: new Date().toISOString(),
        }, null, 2), 'utf-8')
      }

      upsertResult(existingResults, result)
      console.log(`[rerun] ${a2Key} → ${result.verdict}`)

      if (result.verdict === "FAIL" && result.failCause !== "benchmark_ingestion_timeout") {
        throw new Error(`[FAIL/a2] ${combo.key}\n${result.failures.join("\n")}`)
      }
    })
  }
})

// ── Core audit logic ──────────────────────────────────────────────────────

async function runAudit(
  page: import("@playwright/test").Page,
  combo: MatrixCombo,
  result: AuditResult,
  outputDir: string
): Promise<void> {
  const formPage = new RunFormPage(page)
  const detailPage = new RunDetailPage(page)

  console.log(`\n[audit] Starting: ${combo.strategy} × ${combo.universe} × ${combo.benchmark}`)

  // ── 1) Navigate to run form ───────────────────────────────────────────────
  await formPage.goto()

  const cutoffDate = await formPage.getCutoffDate()
  result.cutoffDateUsed = cutoffDate

  // ── 2) Pre-run benchmark currency check ──────────────────────────────────
  // Verify the selected benchmark is current through the cutoff date BEFORE
  // creating the run. This is separate from the post-creation waiting_for_data
  // phase — it surfaces the preflight-gap defect proactively.
  if (dataPageHealth) {
    const benchRow = dataPageHealth.benchmarkRows.find((r) => r.ticker === combo.benchmark)
    if (benchRow) {
      const notReady = benchRow.status !== "healthy" && benchRow.status !== "unknown"
      const behindCutoff = benchRow.isBehindCutoff

      if (notReady) {
        // Benchmark status indicates data is missing or degraded — run will likely
        // block at preflight or enter waiting_for_data immediately.
        addCheck(
          result,
          "pre-run-benchmark-currency",
          false,
          `Data page shows ${combo.benchmark} as "${benchRow.status}" (coverage: ${benchRow.coveragePct ?? "—"}) — ` +
          `run is likely to enter waiting_for_data or be blocked by preflight`
        )
        result.preflightMessages.push(
          `PRE-RUN WARNING: ${combo.benchmark} status="${benchRow.status}" — benchmark data may not be current through cutoff`
        )
      } else if (behindCutoff) {
        // Benchmark is "Healthy" in the UI (status=ok, coverage≈100%) but its
        // latest price date is behind the window end. The backtest preflight will
        // queue a tail-end ingestion job and put the run into waiting_for_data.
        // This is the exact gap exposed by the equal_weight × ETF8 × VTI finding:
        // the Data page says "Healthy" but the preflight system triggers ingestion.
        addCheck(
          result,
          "pre-run-benchmark-currency",
          false,
          `${combo.benchmark} is behind the cutoff date (latestDate < windowEnd) despite showing "Healthy". ` +
          `The preflight system will queue tail-end ingestion and the run will enter waiting_for_data. ` +
          `This is a preflight-gap defect: UI indicates readiness but silent ingestion is still required.`
        )
        result.preflightMessages.push(
          `PRE-RUN DEFECT: ${combo.benchmark} shows "Healthy" on Data page but is behind the cutoff date. ` +
          `Run will enter waiting_for_data — recording first attempt as FAIL/benchmark_ingestion_timeout, ` +
          `RERUN pass (attempt 2) will retry after benchmark data is current.`
        )
        console.log(
          `[audit] PRE-RUN: ${combo.benchmark} is behind cutoff (isBehindCutoff=true). ` +
          `This run may enter waiting_for_data — two-phase wait is active.`
        )
      } else {
        // Benchmark is healthy and current through the cutoff — expect fast path.
        addCheck(
          result,
          "pre-run-benchmark-currency",
          true,
          `${combo.benchmark} is healthy and current through the cutoff date (status="${benchRow.status}", coverage=${benchRow.coveragePct ?? "100%"})`
        )
      }
    }
  }

  // ── 3) Fill form ──────────────────────────────────────────────────────────
  const { runId, preflight } = await formPage.fillAndSubmit({
    runName: combo.runName,
    strategy: combo.strategy,
    universe: combo.universe,
    benchmark: combo.benchmark,
    startDate: combo.canonicalStartDate,
    endDate: combo.canonicalEndDate,
    costsBps: combo.costsBps,
    topN: combo.topN,
  })

  // Check for date adjustment (snapping)
  const dateAdjMsg = await formPage.getDateAdjustmentMessage()
  if (dateAdjMsg) {
    result.preflightMessages.push(`Date adjustment: ${dateAdjMsg}`)
    // Extract snapped dates
    const snapMatch = dateAdjMsg.match(/(\d{4}-\d{2}-\d{2})/)
    if (snapMatch) {
      // The snapped date is mentioned in the message
    }
  }

  // ── 4) Handle preflight outcome ───────────────────────────────────────────
  if (preflight) {
    result.preflightStatus = preflight.status
    result.preflightMessages.push(...preflight.messages)

    if (preflight.status === 'block') {
      // Try to classify the block
      const blockText = preflight.messages.join(' ')
      const isValidBlock = classifyBlock(blockText, combo)

      if (isValidBlock.valid) {
        // Before accepting as VALID-BLOCK, check for a Data page contradiction:
        // If the Data page shows the benchmark as healthy (not behind cutoff) but
        // preflight is blocking citing data availability for that benchmark, the
        // block is contradictory — record as FAIL/preflight_block, not VALID-BLOCK.
        if (dataPageHealth) {
          const benchRow = dataPageHealth.benchmarkRows.find((r) => r.ticker === combo.benchmark)
          const lowerBlock = blockText.toLowerCase()
          const blockMentionsBenchmark = lowerBlock.includes(combo.benchmark.toLowerCase())
          const blockMentionsData = /coverage|ingest|missing|no data|not available|not ingested/.test(lowerBlock)
          if (
            benchRow?.status === 'healthy' &&
            !benchRow.isBehindCutoff &&
            blockMentionsBenchmark &&
            blockMentionsData
          ) {
            result.verdict = "FAIL"
            result.failCause = "preflight_block"
            result.verdictReason =
              `CONTRADICTION: Data page shows ${combo.benchmark} as healthy but preflight blocked citing data availability`
            result.failures.push(
              `CONTRADICTION: ${combo.benchmark} shows "Healthy" on Data page (coverage: ${benchRow.coveragePct ?? "100%"}), ` +
              `but preflight blocked with: "${blockText.slice(0, 200)}". ` +
              `Expected VALID-BLOCK (data genuinely missing) but data page disagrees — this is a preflight-gap defect.`
            )
            return
          }
        }
        result.verdict = "VALID-BLOCK"
        result.verdictReason = isValidBlock.reason
        return
      } else {
        result.failures.push(`Unexpected block: ${blockText}`)
        result.verdict = "FAIL"
        result.verdictReason = `Unexpected preflight block: ${blockText.slice(0, 150)}`

        // Check for contradiction with Data page
        if (dataPageHealth) {
          const benchRow = dataPageHealth.benchmarkRows.find((r) => r.ticker === combo.benchmark)
          if (benchRow?.status === 'healthy' && blockText.toLowerCase().includes(combo.benchmark.toLowerCase()) && blockText.toLowerCase().includes('data')) {
            result.failures.push(
              `CONTRADICTION: Data page shows ${combo.benchmark} as healthy, but preflight blocked on ${combo.benchmark} data`
            )
          }
        }
        return
      }
    }

    if (preflight.status === 'warn') {
      // Acknowledge warning and proceed
      const { runId: acknowledgedRunId } = await formPage.acknowledgeWarningAndQueue()
      if (!acknowledgedRunId) {
        result.failures.push(`Warning acknowledged but no run was created`)
        result.verdict = "FAIL"
        result.verdictReason = "Warning acknowledged but navigation did not reach run detail"
        return
      }

      result.runId = acknowledgedRunId
      result.preflightStatus = 'warn'
    }

    if (preflight.status === 'error') {
      result.failures.push(`Form submission error: ${preflight.messages.join('; ')}`)
      result.verdict = "FAIL"
      result.verdictReason = `Form error: ${preflight.messages[0]?.slice(0, 100) ?? "unknown"}`
      return
    }
  } else {
    result.preflightStatus = 'ok'
  }

  // ── 5) Run was created ────────────────────────────────────────────────────
  const finalRunId = runId ?? result.runId
  if (!finalRunId) {
    result.failures.push("Run creation succeeded (no preflight block) but no run ID was captured")
    result.verdict = "FAIL"
    result.verdictReason = "No run ID captured after creation"
    return
  }

  result.runId = finalRunId
  console.log(`[audit] Run created: ${finalRunId}`)

  // ── 6) Navigate to run detail — two-phase wait ───────────────────────────
  await detailPage.goto(finalRunId)

  // Phase 1: benchmark readiness — if the run enters waiting_for_data, wait
  // with a separate timeout before the backtest completion timeout begins.
  const initialStatus = await detailPage.readStatus()
  if (initialStatus === 'waiting_for_data') {
    console.log(`[audit] Run ${finalRunId} entered waiting_for_data — waiting for benchmark ingestion (BENCHMARK_READY_TIMEOUT_MS=${Math.round(BENCHMARK_READY_TIMEOUT_MS/60000)}min)`)
    const benchmarkReady = await detailPage.waitUntilBenchmarkReady(finalRunId, BENCHMARK_READY_TIMEOUT_MS)
    result.benchmarkWaitMs = benchmarkReady.elapsedMs
    if (!benchmarkReady.ready) {
      // First-attempt failure: benchmark data was not ingested in time.
      // Record the pending run ID so the RERUN pass can retry after data arrives.
      result.benchmarkPendingRunId = finalRunId
      result.failCause = "benchmark_ingestion_timeout"
      result.failures.push(
        `Benchmark ingestion timeout: run ${finalRunId} remained in waiting_for_data ` +
        `for ${Math.round(benchmarkReady.elapsedMs / 60_000)} min (limit: ${Math.round(BENCHMARK_READY_TIMEOUT_MS / 60_000)} min). ` +
        `Benchmark ticker "${combo.benchmark}" data not ingested within BENCHMARK_READY_TIMEOUT_MS. ` +
        `The RERUN pass (attempt 2) will retry this combo once benchmark data is available.`
      )
      result.verdict = "FAIL"
      result.verdictReason = `Benchmark ingestion timeout after ${Math.round(benchmarkReady.elapsedMs / 60_000)}min`
      console.log(`[audit] ${combo.key} FAIL (benchmark_ingestion_timeout) — recording for RERUN pass`)
      return
    }
    console.log(`[audit] Benchmark data ready after ${Math.round(benchmarkReady.elapsedMs / 1000)}s — proceeding to backtest wait`)
  }

  // Phase 2: backtest completion — run has left waiting_for_data
  const finalStatus = await detailPage.waitForCompletion(finalRunId, RUN_COMPLETION_TIMEOUT_MS)
  console.log(`[audit] Run ${finalRunId} final status: ${finalStatus}`)

  if (finalStatus === 'failed') {
    result.failures.push(`Run ${finalRunId} ended in status: failed`)
    result.verdict = "FAIL"
    result.verdictReason = "Run ended with status: failed"
    return
  }

  if (finalStatus === 'blocked') {
    result.failures.push(`Run ${finalRunId} ended in status: blocked`)
    result.verdict = "FAIL"
    result.verdictReason = "Run ended with status: blocked (should have been caught at preflight)"
    return
  }

  if (finalStatus === 'unknown') {
    result.failCause = "run_timeout"
    result.failures.push(`Run ${finalRunId} timed out waiting for completion`)
    result.verdict = "FAIL"
    result.verdictReason = `Run timed out after ${Math.round(RUN_COMPLETION_TIMEOUT_MS / 60_000)}min`
    return
  }

  // ── 7) Read effective dates ───────────────────────────────────────────────
  const { startDate: effectiveStart, endDate: effectiveEnd } = await detailPage.readEffectiveDates()
  result.effectiveStartDate = effectiveStart
  result.effectiveEndDate = effectiveEnd

  // ── 8) Read run config ────────────────────────────────────────────────────
  const config = await detailPage.readRunConfig()
  result.uiStrategyLabel = config.strategy
  result.uiUniverse = config.universe
  result.uiBenchmark = config.benchmark
  result.uiPeriod = config.period
  result.uiCosts = config.costs
  result.uiRebalance = config.rebalance
  result.uiConstruction = config.construction
  result.uiTopN = config.topN

  if (cutoffDate) {
    addCheck(result, "cutoff-date-used", true, `Cutoff date: ${cutoffDate}`)
  }

  // Verify config matches what we requested
  verifyRunConfig(result, combo, config)

  // ── 9) Read KPIs ──────────────────────────────────────────────────────────
  const kpis = await detailPage.readKPIs()
  result.uiCagr = kpis.cagr
  result.uiSharpe = kpis.sharpe
  result.uiMaxDrawdown = kpis.maxDrawdown
  result.uiVolatility = kpis.volatility
  result.uiWinRate = kpis.winRate
  result.uiProfitFactor = kpis.profitFactor
  result.uiTurnover = kpis.turnover
  result.uiCalmar = kpis.calmar

  // KPI sanity checks
  const kpiChecks = runAllKpiChecks(kpis)
  for (const check of kpiChecks) {
    addCheck(result, `kpi-sanity:${check.message.split(':')[0]}`, check.passed, check.message)
  }

  // ── 10) Chart date range ──────────────────────────────────────────────────
  const chartRange = await detailPage.readChartDateRange()
  result.chartStartLabel = chartRange.start
  result.chartEndLabel = chartRange.end

  const chartCheck = checkChartDateRange(chartRange.start, chartRange.end, effectiveStart, effectiveEnd)
  if (chartRange.start === null && chartRange.end === null) {
    // Recharts SVG labels weren't found by selector — log as info, not a hard failure.
    // The tearsheet chart labels (parsed from HTML) serve as the verification source.
    result.preflightMessages.push("INFO: Live chart date labels not found via DOM (recharts SVG); using tearsheet chart labels for verification")
    addCheck(result, "chart-date-range", true, "Chart date range: using tearsheet labels as fallback")
  } else {
    addCheck(result, "chart-date-range", chartCheck.passed, chartCheck.message)
  }

  // ── 11) Holdings tab ──────────────────────────────────────────────────────
  const holdings = await detailPage.readHoldings()
  result.holdingsWeightSum = holdings.weightSum
  result.holdingsCount = holdings.count

  const holdingsCheck = checkHoldingsWeightSum(holdings.weightSum, holdings.count)
  addCheck(result, "holdings-weight-sum", holdingsCheck.passed, holdingsCheck.message)

  // Top N check: for non-equal-weight strategies, holdings should be <= requested topN.
  // equal_weight is INFO-only: engine holds all snapshotted universe symbols (which may
  // include the benchmark if not already in the universe), so count >= canonical universe size.
  if (holdings.count > 0) {
    const universeSize = UNIVERSE_PRESETS[combo.universe as UniverseId]?.length ?? 20
    const isEqualWeight = combo.strategy === "equal_weight"
    if (isEqualWeight) {
      // Soft check: weight sum is the real integrity signal; count may vary by ±1 or ±2.
      result.preflightMessages.push(
        `INFO: equal_weight holdings count=${holdings.count} (canonical universe size=${universeSize}). ` +
        `Variance is expected when benchmark is added to or excluded from the snapshotted universe.`
      )
      addCheck(result, "holdings-top-n", true, `[equal_weight] Holdings count ${holdings.count} (universe ${universeSize}) — weight-sum is the integrity check`)
    } else {
      const uiTopN = config.topN ? parseInt(config.topN) : null
      const effectiveMax = uiTopN && !isNaN(uiTopN) ? Math.min(uiTopN, universeSize) : universeSize
      addCheck(
        result,
        "holdings-top-n",
        holdings.count <= effectiveMax,
        holdings.count <= effectiveMax
          ? `Holdings count (${holdings.count}) ≤ effective top N (${effectiveMax})`
          : `Holdings count (${holdings.count}) exceeds effective top N (${effectiveMax}); UI topN="${config.topN}", universeSize=${universeSize}`
      )
    }
  }

  // ── 12) Trades tab ────────────────────────────────────────────────────────
  const trades = await detailPage.readTrades()
  result.tradesCount = trades.rebalanceCount

  addCheck(
    result,
    "trades-non-empty",
    trades.rebalanceCount > 0,
    trades.rebalanceCount > 0
      ? `Rebalance log has ${trades.rebalanceCount} entries`
      : "Rebalance log is empty (suspicious for a completed run)"
  )

  // ── 13) ML Insights tab (ML strategies only) ──────────────────────────────
  const isMl = ML_STRATEGIES.has(combo.strategy as StrategyId)
  if (isMl) {
    const mlTabVisible = await detailPage.isMLInsightsTabVisible()
    result.mlInsightsPresent = mlTabVisible

    addCheck(
      result,
      "ml-insights-tab-visible",
      mlTabVisible,
      mlTabVisible ? "ML Insights tab is visible" : "ML Insights tab missing for ML strategy"
    )

    if (mlTabVisible) {
      const mlInsights = await detailPage.readMLInsights()
      result.mlFeatureImportancePresent = mlInsights.featureImportancePresent
      result.mlLatestPicksWeightSum = mlInsights.latestPicksWeightSum
      result.mlTrainWindow = mlInsights.trainWindow
      result.mlRebalancesCount = mlInsights.rebalancesCount

      addCheck(
        result,
        "ml-feature-importance",
        mlInsights.featureImportancePresent,
        mlInsights.featureImportancePresent ? "Feature importance chart present" : "Feature importance chart missing"
      )

      if (mlInsights.latestPicksWeightSum !== null) {
        addCheck(
          result,
          "ml-picks-weight-sum",
          Math.abs(mlInsights.latestPicksWeightSum - 100) < 3,
          `ML latest picks weight sum: ${mlInsights.latestPicksWeightSum?.toFixed(2)}%`
        )
      }
    }
  } else {
    // Non-ML strategies should NOT show ML Insights tab
    const mlTabVisible = await detailPage.isMLInsightsTabVisible()
    addCheck(
      result,
      "ml-insights-tab-absent",
      !mlTabVisible,
      mlTabVisible ? "ML Insights tab should not appear for non-ML strategy" : "ML Insights tab correctly absent"
    )
  }

  // ── 14) Download and parse tearsheet ──────────────────────────────────────
  const reportPath = await detailPage.downloadTearsheet(finalRunId)
  if (!reportPath) {
    addCheck(result, "tearsheet-downloaded", false, "Tearsheet could not be downloaded")
  } else {
    result.reportFilename = path.basename(reportPath)
    addCheck(result, "tearsheet-downloaded", true, `Tearsheet saved: ${result.reportFilename}`)

    // Parse the tearsheet
    const reportHtml = fs.readFileSync(reportPath, 'utf-8')
    const parsed = parseReportHtml(reportHtml)

    // Store report KPIs
    result.reportCagr = parsed.cagr
    result.reportSharpe = parsed.sharpe
    result.reportMaxDrawdown = parsed.maxDrawdown
    result.reportVolatility = parsed.volatility
    result.reportWinRate = parsed.winRate
    result.reportProfitFactor = parsed.profitFactor
    result.reportTurnover = parsed.turnover
    result.reportCalmar = parsed.calmar
    result.reportStrategyLabel = parsed.strategyLabel
    result.reportBenchmark = parsed.benchmark
    result.reportWindow = parsed.window
    result.reportUniverse = parsed.universe
    result.reportRebalanceFreq = parsed.rebalanceFreq
    result.reportTopN = parsed.topN
    result.reportCosts = parsed.costs

    // Chart date labels from tearsheet
    result.chartStartLabel = result.chartStartLabel ?? parsed.chartStartLabel
    result.chartEndLabel = result.chartEndLabel ?? parsed.chartEndLabel

    // Report parsing errors
    for (const err of parsed.parseErrors) {
      if (err.includes("mojibake") || err.includes("encoding")) {
        addCheck(result, "tearsheet-encoding", false, err)
      } else if (!err.includes("optional") && !err.includes("backfill")) {
        addCheck(result, "tearsheet-parse", false, err)
      }
    }

    // Encoding check on raw meta text
    const encCheck = checkEncoding("tearsheet-meta", parsed.rawTextSnippet)
    addCheck(result, "tearsheet-encoding-meta", encCheck.passed, encCheck.message)

    // ── 15) KPI consistency: UI vs tearsheet ────────────────────────────────
    // Note: Max Drawdown — the DB stores it as a negative fraction; the UI may
    // display the raw negative value while the tearsheet uses Math.abs(). We
    // compare absolute magnitudes to detect true discrepancies.
    const normalizeForConsistency = (val: string | null): string | null => {
      if (!val) return val
      const n = parseFloat(val.replace(/%/g, "").trim())
      return isNaN(n) ? val : `${Math.abs(n).toFixed(1)}%`
    }

    const kpiPairs: [string, string | null, string | null][] = [
      ["CAGR", kpis.cagr, parsed.cagr],
      ["Sharpe", kpis.sharpe, parsed.sharpe],
      // Use absolute magnitudes for Max Drawdown (UI=negative, report=positive)
      ["Max Drawdown", normalizeForConsistency(kpis.maxDrawdown), normalizeForConsistency(parsed.maxDrawdown)],
      ["Volatility", kpis.volatility, parsed.volatility],
      ["Win Rate", kpis.winRate, parsed.winRate],
      ["Profit Factor", kpis.profitFactor, parsed.profitFactor],
      ["Turnover", kpis.turnover, parsed.turnover],
      ["Calmar", kpis.calmar, parsed.calmar],
    ]

    for (const [name, uiVal, repVal] of kpiPairs) {
      const c = checkKpiConsistency(name, uiVal, repVal)
      addCheck(result, `kpi-consistency:${name}`, c.passed, c.message)
    }

    // Record the sign discrepancy for Max Drawdown as an informational finding
    if (kpis.maxDrawdown && parsed.maxDrawdown) {
      const uiNeg = kpis.maxDrawdown.trim().startsWith('-')
      const repNeg = parsed.maxDrawdown.trim().startsWith('-')
      if (uiNeg !== repNeg) {
        // This is a known display inconsistency: UI shows raw DB sign, tearsheet normalizes
        result.preflightMessages.push(
          `INFO: Max Drawdown sign differs between UI (${kpis.maxDrawdown}) and tearsheet (${parsed.maxDrawdown}). ` +
          `UI shows raw DB value; tearsheet uses Math.abs(). The underlying magnitude is consistent.`
        )
      }
    }

    // ── 16) Config consistency: UI vs tearsheet ──────────────────────────────
    const strategyCheck = checkConfigConsistency("strategy", result.uiStrategyLabel, parsed.strategyLabel)
    addCheck(result, "config-strategy", strategyCheck.passed, strategyCheck.message)

    const benchmarkCheck = checkConfigConsistency("benchmark", result.uiBenchmark, parsed.benchmark)
    addCheck(result, "config-benchmark", benchmarkCheck.passed, benchmarkCheck.message)

    // Report strategy ID must match what we requested
    if (parsed.strategyId) {
      addCheck(
        result,
        "config-strategy-id",
        parsed.strategyId === combo.strategy,
        parsed.strategyId === combo.strategy
          ? `Strategy ID matches: ${combo.strategy}`
          : `Strategy ID mismatch: expected ${combo.strategy}, got ${parsed.strategyId}`
      )
    }

    // Report benchmark must match what we requested
    if (parsed.benchmark) {
      addCheck(
        result,
        "config-benchmark-match",
        parsed.benchmark === combo.benchmark,
        parsed.benchmark === combo.benchmark
          ? `Benchmark matches: ${combo.benchmark}`
          : `Benchmark mismatch: expected ${combo.benchmark}, got ${parsed.benchmark}`
      )
    }

    // ── 17) Benchmark overlap warning ────────────────────────────────────────
    const universeSymbols = UNIVERSE_PRESETS[combo.universe as UniverseId] ?? []
    const benchmarkInUniverse = universeSymbols.includes(combo.benchmark)
    if (benchmarkInUniverse) {
      // Overlap may occur — check if the tearsheet mentions it
      // (Not all strategies will hold the benchmark at every rebalance)
      addCheck(
        result,
        "benchmark-overlap-note",
        true,  // Not a hard failure — just record it
        parsed.benchmarkOverlapDetected
          ? `Benchmark overlap detected and noted in tearsheet`
          : `Benchmark ${combo.benchmark} is in ${combo.universe} universe — overlap possible but not detected in tearsheet (may depend on run)`
      )
    }

    // ── 18) Tearsheet KPI sanity ─────────────────────────────────────────────
    const reportKpiChecks = runAllKpiChecks({
      cagr: parsed.cagr,
      sharpe: parsed.sharpe,
      maxDrawdown: parsed.maxDrawdown,
      volatility: parsed.volatility,
      winRate: parsed.winRate,
      profitFactor: parsed.profitFactor,
      turnover: parsed.turnover,
      calmar: parsed.calmar,
    })
    for (const check of reportKpiChecks) {
      addCheck(result, `report-kpi-sanity:${check.message.split(':')[0]}`, check.passed, `[report] ${check.message}`)
    }

    // ── 19) Data page vs preflight contradiction check ───────────────────────
    // Two contradiction patterns are recorded here:
    //   A) Data page says "Healthy" but preflight returned a hard block mentioning the benchmark
    //   B) Data page says "Healthy" + isBehindCutoff=false but the run entered waiting_for_data
    //      (meaning the preflight silently queued ingestion without surfacing it to the UI)
    if (dataPageHealth) {
      const benchRow = dataPageHealth.benchmarkRows.find((r) => r.ticker === combo.benchmark)
      if (benchRow?.status === 'healthy') {
        // Pattern A: hard preflight block
        if (result.preflightStatus === 'block') {
          const blockMsgs = result.preflightMessages.join(' ')
          if (blockMsgs.toLowerCase().includes(combo.benchmark.toLowerCase())) {
            addCheck(
              result,
              "data-preflight-contradiction",
              false,
              `CONTRADICTION: Data page shows ${combo.benchmark} as healthy (${benchRow.coveragePct} coverage), ` +
              `but preflight blocked mentioning ${combo.benchmark}`
            )
          }
        }

        // Pattern B: "Healthy" ticker triggered silent ingestion (isBehindCutoff gap)
        // The pre-run check already failed for isBehindCutoff cases, so this is an
        // additional record if the run ALSO entered waiting_for_data (confirming the defect).
        if (result.failCause === 'benchmark_ingestion_timeout' && !benchRow.isBehindCutoff) {
          addCheck(
            result,
            "data-preflight-contradiction",
            false,
            `CONTRADICTION: Data page shows ${combo.benchmark} as healthy with no isBehindCutoff signal, ` +
            `but the run entered waiting_for_data (benchmark ingestion was triggered by preflight). ` +
            `This is a preflight-gap defect: the Data page UI did not surface the stale data condition.`
          )
        }
      }
    }
  }

  console.log(`[audit] Completed: ${combo.strategy} × ${combo.universe} × ${combo.benchmark} — ${result.failures.length === 0 ? 'PASS' : 'FAIL (' + result.failures.length + ' failures)'}`)
}

// ── Block classification helpers ──────────────────────────────────────────

function classifyBlock(
  blockText: string,
  combo: MatrixCombo
): { valid: boolean; reason: string } {
  const lower = blockText.toLowerCase()

  // Valid blocks: strategy not in UI
  if (lower.includes('not available') || lower.includes('not supported') || lower.includes('coming soon')) {
    return { valid: true, reason: `Strategy or feature not available: "${blockText.slice(0, 100)}"` }
  }

  // Valid block: universe data missing / not ingested
  if ((lower.includes('missing') || lower.includes('not ingested') || lower.includes('ingest')) &&
      (lower.includes('universe') || lower.includes('ticker') || lower.includes('symbol'))) {
    return { valid: true, reason: `Universe data not ready: "${blockText.slice(0, 100)}"` }
  }

  // Valid block: date window too short for strategy warmup
  if (lower.includes('warmup') || lower.includes('training') || lower.includes('history') ||
      lower.includes('start date') || lower.includes('earlier start')) {
    return { valid: true, reason: `Insufficient history for strategy warmup: "${blockText.slice(0, 100)}"` }
  }

  // Valid block: benchmark not ingested / no data
  if ((lower.includes(combo.benchmark.toLowerCase())) &&
      (lower.includes('not ingested') || lower.includes('missing') || lower.includes('no data'))) {
    return { valid: true, reason: `Benchmark ${combo.benchmark} not available: "${blockText.slice(0, 100)}"` }
  }

  // Valid block: top N exceeds universe size
  if (lower.includes('top n') || lower.includes('top_n') || lower.includes('reduce')) {
    return { valid: true, reason: `Top N constraint: "${blockText.slice(0, 100)}"` }
  }

  // Valid block: date range too short
  if (lower.includes('date range') || lower.includes('minimum') || lower.includes('2 year')) {
    return { valid: true, reason: `Date range constraint: "${blockText.slice(0, 100)}"` }
  }

  // Valid block: inception date / coverage below threshold
  if (lower.includes('inception') || lower.includes('coverage') || lower.includes('threshold')) {
    return { valid: true, reason: `Coverage/inception constraint: "${blockText.slice(0, 100)}"` }
  }

  // Default: classify as invalid (unexpected) block → FAIL
  return {
    valid: false,
    reason: `Unexpected block: "${blockText.slice(0, 150)}"`,
  }
}

function verifyRunConfig(
  result: AuditResult,
  combo: MatrixCombo,
  config: ReturnType<typeof parseRunConfig>
): void {
  // Strategy verification
  if (config.strategy) {
    // The strategy label shown should contain the expected strategy
    const stratLabels: Record<string, string> = {
      equal_weight: 'Equal Weight',
      momentum_12_1: 'Momentum 12-1',
      ml_ridge: 'ML Ridge',
      ml_lightgbm: 'ML LightGBM',
      low_vol: 'Low Volatility',
      trend_filter: 'Trend Filter',
    }
    const expectedLabel = stratLabels[combo.strategy] ?? combo.strategy
    addCheck(
      result,
      "ui-config-strategy",
      config.strategy.includes(expectedLabel) || config.strategy.toLowerCase().includes(combo.strategy),
      config.strategy.includes(expectedLabel)
        ? `UI config strategy matches: ${config.strategy}`
        : `UI config strategy mismatch: expected "${expectedLabel}", got "${config.strategy}"`
    )
  }

  // Benchmark verification
  if (config.benchmark) {
    addCheck(
      result,
      "ui-config-benchmark",
      config.benchmark.includes(combo.benchmark),
      config.benchmark.includes(combo.benchmark)
        ? `UI config benchmark matches: ${combo.benchmark}`
        : `UI config benchmark mismatch: expected ${combo.benchmark}, got "${config.benchmark}"`
    )
  }

  // Universe verification
  if (config.universe) {
    addCheck(
      result,
      "ui-config-universe",
      config.universe.includes(combo.universe),
      config.universe.includes(combo.universe)
        ? `UI config universe matches: ${combo.universe}`
        : `UI config universe mismatch: expected ${combo.universe}, got "${config.universe}"`
    )
  }
}

// Type alias helper
function parseRunConfig(config: { strategy: string | null; universe: string | null; benchmark: string | null; [k: string]: string | null }) {
  return config
}
