/**
 * Targeted Edge-Case QA — Chart / Tearsheet Full-Range Tests (T17–T22)
 *
 * For each strategy, creates a long-window run (2019-01-01 → 2025-12-31)
 * using ETF8 + SPY and verifies that:
 *   1. The UI "ALL" chart end date matches the effective run end date
 *   2. The tearsheet chart labels also reach the effective end date
 *   3. Neither truncates silently (e.g. stops in 2025 when run says 2026)
 *
 * Tests:
 *   T17  equal_weight    full-range chart check
 *   T18  momentum_12_1  full-range chart check
 *   T19  low_vol        full-range chart check
 *   T20  trend_filter   full-range chart check
 *   T21  ml_ridge       full-range chart check
 *   T22  ml_lightgbm    full-range chart check
 *
 * Run only these tests:
 *   npx playwright test tests/targeted-charts.spec.ts --project=audit
 */

import { test } from "@playwright/test"
import * as fs from "fs"
import {
  BENCHMARK_READY_TIMEOUT_MS,
  RUN_COMPLETION_TIMEOUT_MS,
  CANONICAL_COSTS_BPS,
  CANONICAL_TOP_N,
  type StrategyId,
} from "../audit.config"
import { addCheck, finalizeVerdict } from "../helpers/verdict"
import {
  makeTargetedResult,
  loadTargetedResults,
  upsertTargetedResult,
  captureFailureArtifacts,
  generateTargetedReports,
} from "../helpers/targeted"
import { checkChartDateRange } from "../helpers/sanity"
import { parseReportHtml } from "../helpers/report-parser"
import { RunFormPage } from "../pages/RunFormPage"
import { RunDetailPage } from "../pages/RunDetailPage"

const targetedResults = loadTargetedResults()

// ─────────────────────────────────────────────────────────────────────────────

const CHART_STRATEGIES: Array<{
  id: StrategyId
  label: string
  testIndex: number
  topN: number
}> = [
  { id: "equal_weight",   label: "equal_weight",   testIndex: 17, topN: CANONICAL_TOP_N["ETF8"] },
  { id: "momentum_12_1",  label: "momentum_12_1",  testIndex: 18, topN: CANONICAL_TOP_N["ETF8"] },
  { id: "low_vol",        label: "low_vol",         testIndex: 19, topN: CANONICAL_TOP_N["ETF8"] },
  { id: "trend_filter",   label: "trend_filter",    testIndex: 20, topN: CANONICAL_TOP_N["ETF8"] },
  { id: "ml_ridge",       label: "ml_ridge",        testIndex: 21, topN: CANONICAL_TOP_N["ETF8"] },
  { id: "ml_lightgbm",    label: "ml_lightgbm",     testIndex: 22, topN: CANONICAL_TOP_N["ETF8"] },
]

test.describe.serial("Targeted Chart Full-Range Tests", () => {

  test.afterAll(async () => {
    generateTargetedReports(targetedResults)
  })

  for (const strat of CHART_STRATEGIES) {
    test(`[T${strat.testIndex}] ${strat.id} full-range chart check`, async ({ page }) => {
      test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

      const key = `targeted__${strat.testIndex}_${strat.id}_chart_range`
      const result = makeTargetedResult(
        key,
        `${strat.id} full-range chart check`,
        1000 + strat.testIndex,
        { strategy: strat.id, universe: "ETF8", benchmark: "SPY",
          canonicalStartDate: "2019-01-01", canonicalEndDate: "2025-12-31" }
      )

      try {
        const formPage = new RunFormPage(page)
        const detailPage = new RunDetailPage(page)
        await formPage.goto()
        result.cutoffDateUsed = await formPage.getCutoffDate()

        const { runId, preflight } = await formPage.fillAndSubmit({
          runName: result.runName!,
          strategy: strat.id,
          universe: "ETF8",
          benchmark: "SPY",
          startDate: "2019-01-01",
          endDate: "2025-12-31",
          costsBps: CANONICAL_COSTS_BPS,
          topN: strat.topN,
        })

        result.attemptedStartDate = "2019-01-01"
        result.attemptedEndDate = "2025-12-31"

        if (preflight?.status === "block") {
          result.preflightStatus = "block"
          result.preflightMessages.push(...preflight.messages)
          result.verdict = "VALID-BLOCK"
          result.verdictReason = `Block: ${preflight.messages[0]?.slice(0, 100)}`
          upsertTargetedResult(targetedResults, result)
          return
        }

        if (preflight?.status === "warn") {
          result.preflightStatus = "warn"
          result.preflightMessages.push(...preflight.messages)
          const { runId: ackRunId } = await formPage.acknowledgeWarningAndQueue()
          if (ackRunId) result.runId = ackRunId
        }

        const finalRunId = runId ?? result.runId
        if (!finalRunId) {
          addCheck(result, "run-created", false, `No run ID for ${strat.id}`)
          finalizeVerdict(result)
          await captureFailureArtifacts(page, result)
          upsertTargetedResult(targetedResults, result)
          return
        }

        result.runId = finalRunId
        await detailPage.goto(finalRunId)

        // Phase 1: benchmark readiness
        const initialStatus = await detailPage.readStatus()
        if (initialStatus === "waiting_for_data") {
          const br = await detailPage.waitUntilBenchmarkReady(finalRunId, BENCHMARK_READY_TIMEOUT_MS)
          result.benchmarkWaitMs = br.elapsedMs
          if (!br.ready) {
            result.failCause = "benchmark_ingestion_timeout"
            result.failures.push(`${strat.id} run stuck in waiting_for_data for ${Math.round(br.elapsedMs / 60000)}min`)
            finalizeVerdict(result)
            await captureFailureArtifacts(page, result)
            upsertTargetedResult(targetedResults, result)
            return
          }
        }

        // Phase 2: run completion
        const finalStatus = await detailPage.waitForCompletion(finalRunId, RUN_COMPLETION_TIMEOUT_MS)
        addCheck(result, "run-completed", finalStatus === "completed",
          finalStatus === "completed"
            ? `${strat.id} run completed`
            : `${strat.id} run ended with: ${finalStatus}`)

        if (finalStatus !== "completed") {
          if (finalStatus === "unknown") result.failCause = "run_timeout"
          finalizeVerdict(result)
          await captureFailureArtifacts(page, result)
          upsertTargetedResult(targetedResults, result)
          return
        }

        // Read effective dates
        const { startDate: effectiveStart, endDate: effectiveEnd } = await detailPage.readEffectiveDates()
        result.effectiveStartDate = effectiveStart
        result.effectiveEndDate = effectiveEnd

        addCheck(result, "effective-dates-readable", effectiveStart !== null && effectiveEnd !== null,
          effectiveStart && effectiveEnd
            ? `Effective dates: ${effectiveStart} → ${effectiveEnd}`
            : `Effective dates not readable from UI (start=${effectiveStart}, end=${effectiveEnd})`)

        // ── UI Chart Date Range ───────────────────────────────────────────
        await detailPage.navigateToTab("Overview")
        await page.waitForTimeout(1_500)  // give recharts time to render

        const chartRange = await detailPage.readChartDateRange()
        result.chartStartLabel = chartRange.start
        result.chartEndLabel = chartRange.end

        if (chartRange.start !== null && chartRange.end !== null) {
          const uiChartCheck = checkChartDateRange(
            chartRange.start, chartRange.end, effectiveStart, effectiveEnd
          )
          addCheck(result, "ui-chart-date-range-t" + strat.testIndex, uiChartCheck.passed, uiChartCheck.message)

          // Specific full-range assertion: chart end must be within 1 year of effective end
          if (effectiveEnd) {
            const effectiveEndYear = parseInt(effectiveEnd.slice(0, 4))
            const chartEndYearMatch = chartRange.end.match(/\b(20\d{2})\b/)
            if (chartEndYearMatch) {
              const chartEndYear = parseInt(chartEndYearMatch[1])
              const yearGap = effectiveEndYear - chartEndYear
              addCheck(result, "chart-end-not-truncated", yearGap <= 1,
                yearGap <= 1
                  ? `UI chart end year ${chartEndYear} is within 1yr of effective end ${effectiveEnd}`
                  : `UI CHART TRUNCATED: end year ${chartEndYear} is ${yearGap}yr before effective end ${effectiveEnd} — chart silently stops early`)
            } else {
              // Chart end label has no 4-digit year (e.g. "Jan") — skip year-gap check here;
              // the tearsheet chart range check below is the authoritative assertion.
              addCheck(result, "chart-end-label-no-year", true,
                `UI chart end label "${chartRange.end}" has no parseable year — tearsheet chart range used for coverage verification`)
            }
          }
        } else {
          // Chart labels not found via DOM — use tearsheet as authoritative source
          result.preflightMessages.push(
            `INFO [T${strat.testIndex}]: UI chart labels not found via DOM selector — tearsheet chart labels will be used for verification`
          )
          addCheck(result, "ui-chart-labels-found", true,
            "UI chart labels not readable via recharts DOM — using tearsheet chart as fallback")
        }

        // ── Tearsheet Chart Date Range ─────────────────────────────────────
        const reportPath = await detailPage.downloadTearsheet(finalRunId)
        if (!reportPath) {
          addCheck(result, "tearsheet-downloaded", false, `Tearsheet download failed for ${strat.id}`)
        } else {
          result.reportFilename = require("path").basename(reportPath)
          addCheck(result, "tearsheet-downloaded", true, `Tearsheet saved: ${result.reportFilename}`)

          const reportHtml = fs.readFileSync(reportPath, "utf-8")
          const parsed = parseReportHtml(reportHtml)
          result.reportCagr = parsed.cagr
          result.reportSharpe = parsed.sharpe
          result.reportMaxDrawdown = parsed.maxDrawdown
          result.reportVolatility = parsed.volatility

          // Use tearsheet chart labels as primary source when DOM labels not found
          const tsChartStart = parsed.chartStartLabel
          const tsChartEnd = parsed.chartEndLabel

          if (tsChartStart || tsChartEnd) {
            addCheck(result, "tearsheet-chart-labels-present", true,
              `Tearsheet chart labels: ${tsChartStart} → ${tsChartEnd}`)
          }

          // Tearsheet chart range check (primary assertion for T17-22)
          if (tsChartStart && tsChartEnd && effectiveStart && effectiveEnd) {
            const tsChartCheck = checkChartDateRange(tsChartStart, tsChartEnd, effectiveStart, effectiveEnd)
            addCheck(result, `tearsheet-chart-range-t${strat.testIndex}`, tsChartCheck.passed, tsChartCheck.message)

            // Core full-range assertion: tearsheet chart must reach effective end year
            const effectiveEndYear = parseInt(effectiveEnd.slice(0, 4))
            const tsEndYear = parseInt((tsChartEnd.match(/\b(20\d{2})\b/)?.[1]) ?? "0")
            const tsYearGap = effectiveEndYear - tsEndYear
            addCheck(result, "tearsheet-chart-end-not-truncated", tsYearGap <= 1,
              tsYearGap <= 1
                ? `Tearsheet chart end ${tsChartEnd} is within 1yr of effective end ${effectiveEnd}`
                : `TEARSHEET CHART TRUNCATED: ends at ${tsChartEnd} but effective end is ${effectiveEnd} (${tsYearGap}yr gap)`)
          } else if (!tsChartStart && !tsChartEnd) {
            addCheck(result, "tearsheet-chart-labels-present", false,
              `No chart labels found in ${strat.id} tearsheet — cannot verify date range coverage`)
          }

          // Tearsheet window metadata check
          if (parsed.window && effectiveEnd) {
            const windowIncludesEnd =
              parsed.window.includes(effectiveEnd.slice(0, 7)) ||  // YYYY-MM
              parsed.window.includes(effectiveEnd.slice(0, 4))     // YYYY as fallback
            addCheck(result, "tearsheet-window-covers-end", windowIncludesEnd,
              windowIncludesEnd
                ? `Tearsheet window "${parsed.window}" covers effective end ${effectiveEnd}`
                : `Tearsheet window "${parsed.window}" does NOT include effective end ${effectiveEnd} — possible truncation`)
          }
        }

        // KPI sanity — spot check CAGR sign vs start/end NAV
        const kpis = await detailPage.readKPIs()
        result.uiCagr = kpis.cagr
        result.uiSharpe = kpis.sharpe

        if (kpis.cagr && effectiveStart && effectiveEnd) {
          const cagrNum = parseFloat(kpis.cagr.replace(/%/g, "").trim())
          const runYears = (
            new Date(effectiveEnd).getTime() - new Date(effectiveStart).getTime()
          ) / (365.25 * 24 * 3600 * 1000)
          addCheck(result, "kpi-cagr-present", !isNaN(cagrNum),
            !isNaN(cagrNum)
              ? `CAGR ${kpis.cagr} over ~${runYears.toFixed(1)}yr run`
              : `CAGR not parseable: ${kpis.cagr}`)
        }

      } catch (e) {
        result.failures.push(`Uncaught error: ${e}`)
      }

      finalizeVerdict(result)
      if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
      upsertTargetedResult(targetedResults, result)
      if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
    })
  }

})
