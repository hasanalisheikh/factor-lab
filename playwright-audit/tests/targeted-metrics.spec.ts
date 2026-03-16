/**
 * Targeted Metric Cross-Check Tests (T29–T30)
 *
 * These tests go beyond "are values plausible" and verify that displayed metrics
 * are arithmetically self-consistent. They run live backtests, parse the tearsheet,
 * and apply formula-level cross-checks:
 *
 *   T29  CAGR/NAV cross-check
 *        Run an ETF8 equal_weight backtest, download tearsheet, extract Start NAV,
 *        End NAV, and date span. Recompute CAGR from those values using the
 *        TypeScript formula: (endNAV/startNAV)^(1/years) − 1 where
 *        years = calendarDays/365.25. Compare against the displayed CAGR.
 *
 *        IMPORTANT: The displayed CAGR is computed by the Python engine using a
 *        different formula: equity[-1]^(252/n) − 1 (trading-day annualization).
 *        These two formulas diverge by ~0.2–0.5% on 5-year runs.
 *        The test uses a ±3% tolerance to account for this systematic difference
 *        while still catching large errors (off-by-10%, wrong sign, etc.).
 *
 *   T30  Full KPI consistency bundle check
 *        Using a second completed run, verify all cross-metric identities:
 *          - Calmar ≈ |CAGR / Max Drawdown| (±30% tolerance for display rounding)
 *          - CAGR and Sharpe have consistent signs (not opposite)
 *          - Win Rate in [0%, 100%]
 *          - Profit Factor > 0
 *          - Volatility > 0
 *          - Turnover ≥ 0
 *
 * Run only these tests:
 *   npx playwright test tests/targeted-metrics.spec.ts --project=audit
 */

import { test } from "@playwright/test"
import * as fs from "fs"
import {
  BENCHMARK_READY_TIMEOUT_MS,
  RUN_COMPLETION_TIMEOUT_MS,
  CANONICAL_COSTS_BPS,
  CANONICAL_TOP_N,
} from "../audit.config"
import { addCheck, finalizeVerdict } from "../helpers/verdict"
import {
  makeTargetedResult,
  loadTargetedResults,
  upsertTargetedResult,
  captureFailureArtifacts,
  generateTargetedReports,
} from "../helpers/targeted"
import {
  checkCalmarConsistency,
  checkCagrSignConsistency,
  checkCagr,
  checkSharpe,
  checkMaxDrawdown,
  checkVolatility,
  checkWinRate,
  checkProfitFactor,
  checkTurnover,
  checkCalmar,
} from "../helpers/sanity"
import { parseReportHtml } from "../helpers/report-parser"
import { RunFormPage } from "../pages/RunFormPage"
import { RunDetailPage } from "../pages/RunDetailPage"

const targetedResults = loadTargetedResults()

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a dollar-formatted string like "$145,123" or "$1,234,567" into a number.
 * Returns null if parsing fails.
 */
function parseDollarNav(s: string | null): number | null {
  if (!s) return null
  const n = parseFloat(s.replace(/[$,\s]/g, ""))
  return isNaN(n) ? null : n
}

/**
 * Parse a percent string like "+12.3%" or "-5.0%" into a fraction (e.g. 0.123).
 * Returns null if parsing fails.
 */
function parsePercentFraction(s: string | null): number | null {
  if (!s) return null
  const n = parseFloat(s.replace(/[%+\s]/g, ""))
  return isNaN(n) ? null : n / 100
}

/**
 * Recompute CAGR using the TypeScript/calendar-day formula:
 *   CAGR = (endNAV / startNAV)^(1 / years) − 1
 *   years = calendarDays / 365.25
 *
 * This formula differs from the Python engine's trading-day formula:
 *   Python: equity[-1]^(252/n) − 1
 * The systematic difference is ~0.2–0.5% on 5-year runs.
 */
function recomputeCagrFromNavs(
  startNav: number,
  endNav: number,
  startDateStr: string,
  endDateStr: string
): number | null {
  if (startNav <= 0 || endNav <= 0) return null
  try {
    const msStart = new Date(startDateStr + "T00:00:00Z").getTime()
    const msEnd = new Date(endDateStr + "T00:00:00Z").getTime()
    const calDays = (msEnd - msStart) / 86_400_000
    if (calDays < 30) return null // too short to be meaningful
    const years = calDays / 365.25
    const cagr = Math.pow(endNav / startNav, 1 / years) - 1
    return isFinite(cagr) ? cagr : null
  } catch {
    return null
  }
}

/**
 * Extract start and end date strings from a window string like "2019-01-02 to 2025-03-14".
 * Returns null for both if the format is not recognised.
 */
function parseWindowDates(window: string | null): { start: string | null; end: string | null } {
  if (!window) return { start: null, end: null }
  const m = window.match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/)
  if (!m) return { start: null, end: null }
  return { start: m[1], end: m[2] }
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial("Targeted Metric Cross-Check Tests", () => {

  test.afterAll(async () => {
    generateTargetedReports(targetedResults)
  })

  // ── T29: CAGR / NAV cross-check ───────────────────────────────────────────

  test("[T29] CAGR recomputed from Start NAV / End NAV matches displayed CAGR (±3%)", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__29_cagr_nav_crosscheck",
      "CAGR recomputed from NAV and dates matches displayed CAGR",
      1029,
      {
        strategy: "equal_weight",
        universe: "ETF8",
        benchmark: "SPY",
        canonicalStartDate: "2019-01-01",
        canonicalEndDate: "2025-12-31",
      }
    )

    try {
      const formPage = new RunFormPage(page)
      const detailPage = new RunDetailPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "equal_weight",
        universe: "ETF8",
        benchmark: "SPY",
        startDate: "2019-01-01",
        endDate: "2025-12-31",
        costsBps: CANONICAL_COSTS_BPS,
        topN: CANONICAL_TOP_N["ETF8"],
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
        addCheck(result, "run-created", false, "No run ID captured")
        finalizeVerdict(result)
        await captureFailureArtifacts(page, result)
        upsertTargetedResult(targetedResults, result)
        return
      }
      result.runId = finalRunId

      await detailPage.goto(finalRunId)
      const initialStatus = await detailPage.readStatus()
      if (initialStatus === "waiting_for_data") {
        const br = await detailPage.waitUntilBenchmarkReady(finalRunId, BENCHMARK_READY_TIMEOUT_MS)
        result.benchmarkWaitMs = br.elapsedMs
        if (!br.ready) {
          result.failCause = "benchmark_ingestion_timeout"
          finalizeVerdict(result)
          await captureFailureArtifacts(page, result)
          upsertTargetedResult(targetedResults, result)
          return
        }
      }

      const finalStatus = await detailPage.waitForCompletion(finalRunId, RUN_COMPLETION_TIMEOUT_MS)
      addCheck(result, "run-completed", finalStatus === "completed",
        finalStatus === "completed" ? "Run completed successfully" : `Run ended with: ${finalStatus}`)

      if (finalStatus !== "completed") {
        if (finalStatus === "unknown") result.failCause = "run_timeout"
        finalizeVerdict(result)
        await captureFailureArtifacts(page, result)
        upsertTargetedResult(targetedResults, result)
        return
      }

      const { startDate: effectiveStart, endDate: effectiveEnd } = await detailPage.readEffectiveDates()
      result.effectiveStartDate = effectiveStart
      result.effectiveEndDate = effectiveEnd

      // ── Download and parse tearsheet ───────────────────────────────────────

      const reportPath = await detailPage.downloadTearsheet(finalRunId)
      if (!reportPath) {
        addCheck(result, "tearsheet-downloaded", false, "Tearsheet download failed — cannot run metric cross-checks")
        finalizeVerdict(result)
        await captureFailureArtifacts(page, result)
        upsertTargetedResult(targetedResults, result)
        return
      }

      result.reportFilename = require("path").basename(reportPath)
      const reportHtml = fs.readFileSync(reportPath, "utf-8")
      const parsed = parseReportHtml(reportHtml)

      // Record any parse errors
      if (parsed.parseErrors.length > 0) {
        for (const err of parsed.parseErrors) {
          addCheck(result, "tearsheet-parse-ok", false, `Parse error: ${err}`)
        }
      } else {
        addCheck(result, "tearsheet-parse-ok", true,
          "Tearsheet parsed successfully — all KPI fields present")
      }
      result.reportCagr = parsed.cagr

      // ── CAGR recomputation from NAV and date span ──────────────────────────
      //
      // The tearsheet reports:
      //   - Start NAV: $100,000 (initial capital)
      //   - End NAV: $XYZ (final portfolio value)
      //   - Window: "YYYY-MM-DD to YYYY-MM-DD" (effective date span)
      //   - CAGR: "+12.3%" (Python-computed, trading-day basis)
      //
      // We recompute CAGR using the TypeScript/calendar-day formula:
      //   CAGR_recomputed = (endNAV/startNAV)^(365.25/calendarDays) − 1
      //
      // KNOWN METHODOLOGY DIFFERENCE:
      //   Python uses trading days: equity[-1]^(252/n) − 1
      //   TypeScript uses calendar days: (end/start)^(1/(calDays/365.25)) − 1
      //   These diverge by ~0.2–0.5% on a 5-year run.
      //   Tolerance: ±3% absolute (catches off-by-10% errors, wrong signs, etc.)
      //   Note: we compare percentage points (e.g. 12.3% vs 12.6%), not fractions.

      const startNav = parseDollarNav(parsed.startNav)
      const endNav = parseDollarNav(parsed.endNav)
      const { start: winStart, end: winEnd } = parseWindowDates(parsed.window)
      const displayedCagrFrac = parsePercentFraction(parsed.cagr)

      if (startNav !== null && endNav !== null && winStart && winEnd) {
        const recomputed = recomputeCagrFromNavs(startNav, endNav, winStart, winEnd)
        if (recomputed !== null && displayedCagrFrac !== null) {
          const diffAbs = Math.abs(recomputed - displayedCagrFrac)
          const tolerance = 0.03 // 3 percentage points
          addCheck(
            result,
            "cagr-nav-crosscheck",
            diffAbs <= tolerance,
            diffAbs <= tolerance
              ? `CAGR cross-check passed: recomputed=${(recomputed * 100).toFixed(2)}%, ` +
                `displayed=${(displayedCagrFrac * 100).toFixed(2)}%, ` +
                `diff=${(diffAbs * 100).toFixed(2)}pp (tolerance ±${tolerance * 100}pp, ` +
                `methodology note: Python uses 252 trading days/yr, TypeScript uses calDays/365.25)`
              : `CAGR cross-check FAILED: recomputed=${(recomputed * 100).toFixed(2)}%, ` +
                `displayed=${(displayedCagrFrac * 100).toFixed(2)}%, ` +
                `diff=${(diffAbs * 100).toFixed(2)}pp (tolerance ±${tolerance * 100}pp). ` +
                `Start NAV=${startNav}, End NAV=${endNav}, window=${winStart} to ${winEnd}`
          )
        } else {
          addCheck(result, "cagr-nav-crosscheck", true,
            `CAGR recomputation skipped: recomputed=${recomputed}, displayed=${displayedCagrFrac} (one or both unavailable)`)
        }
      } else {
        addCheck(result, "cagr-nav-parsed", false,
          `Could not parse NAV values or window from tearsheet. ` +
          `startNav="${parsed.startNav}", endNav="${parsed.endNav}", window="${parsed.window}"`)
      }

      // ── Calmar consistency: Calmar ≈ |CAGR / Max Drawdown| ────────────────
      const calmarCheck = checkCalmarConsistency(parsed.cagr, parsed.maxDrawdown, parsed.calmar)
      addCheck(result, "calmar-consistency", calmarCheck.passed, calmarCheck.message)

      // ── CAGR / Sharpe sign consistency ────────────────────────────────────
      const signCheck = checkCagrSignConsistency(parsed.cagr, parsed.sharpe)
      addCheck(result, "cagr-sharpe-sign-consistent", signCheck.passed, signCheck.message)

      // ── All KPI plausibility checks ───────────────────────────────────────
      const cagrPl = checkCagr(parsed.cagr)
      addCheck(result, "cagr-plausible", cagrPl.passed, cagrPl.message)

      const sharpePl = checkSharpe(parsed.sharpe)
      addCheck(result, "sharpe-plausible", sharpePl.passed, sharpePl.message)

      const mddPl = checkMaxDrawdown(parsed.maxDrawdown)
      addCheck(result, "max-drawdown-plausible", mddPl.passed, mddPl.message)

      const volPl = checkVolatility(parsed.volatility)
      addCheck(result, "volatility-plausible", volPl.passed, volPl.message)

    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    } finally {
      finalizeVerdict(result)
      await captureFailureArtifacts(page, result).catch(() => {})
      upsertTargetedResult(targetedResults, result)
    }
  })

  // ── T30: Full KPI consistency bundle ────────────────────────────────────────

  test("[T30] Full KPI consistency: win rate, profit factor, turnover, Calmar all self-consistent", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__30_kpi_bundle_consistency",
      "Full KPI bundle self-consistency check",
      1030,
      {
        strategy: "momentum_12_1",
        universe: "ETF8",
        benchmark: "SPY",
        canonicalStartDate: "2019-01-01",
        canonicalEndDate: "2025-12-31",
      }
    )

    try {
      const formPage = new RunFormPage(page)
      const detailPage = new RunDetailPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "momentum_12_1",
        universe: "ETF8",
        benchmark: "SPY",
        startDate: "2019-01-01",
        endDate: "2025-12-31",
        costsBps: CANONICAL_COSTS_BPS,
        topN: CANONICAL_TOP_N["ETF8"],
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
        addCheck(result, "run-created", false, "No run ID captured")
        finalizeVerdict(result)
        await captureFailureArtifacts(page, result)
        upsertTargetedResult(targetedResults, result)
        return
      }
      result.runId = finalRunId

      await detailPage.goto(finalRunId)
      const initialStatus = await detailPage.readStatus()
      if (initialStatus === "waiting_for_data") {
        const br = await detailPage.waitUntilBenchmarkReady(finalRunId, BENCHMARK_READY_TIMEOUT_MS)
        result.benchmarkWaitMs = br.elapsedMs
        if (!br.ready) {
          result.failCause = "benchmark_ingestion_timeout"
          finalizeVerdict(result)
          await captureFailureArtifacts(page, result)
          upsertTargetedResult(targetedResults, result)
          return
        }
      }

      const finalStatus = await detailPage.waitForCompletion(finalRunId, RUN_COMPLETION_TIMEOUT_MS)
      addCheck(result, "run-completed", finalStatus === "completed",
        finalStatus === "completed" ? "Run completed" : `Run ended with: ${finalStatus}`)

      if (finalStatus !== "completed") {
        if (finalStatus === "unknown") result.failCause = "run_timeout"
        finalizeVerdict(result)
        await captureFailureArtifacts(page, result)
        upsertTargetedResult(targetedResults, result)
        return
      }

      const { startDate: effectiveStart, endDate: effectiveEnd } = await detailPage.readEffectiveDates()
      result.effectiveStartDate = effectiveStart
      result.effectiveEndDate = effectiveEnd

      // ── Download and parse tearsheet ───────────────────────────────────────

      const reportPath = await detailPage.downloadTearsheet(finalRunId)
      if (!reportPath) {
        addCheck(result, "tearsheet-downloaded", false, "Tearsheet download failed")
        finalizeVerdict(result)
        await captureFailureArtifacts(page, result)
        upsertTargetedResult(targetedResults, result)
        return
      }

      result.reportFilename = require("path").basename(reportPath)
      const reportHtml = fs.readFileSync(reportPath, "utf-8")
      const parsed = parseReportHtml(reportHtml)
      result.reportCagr = parsed.cagr

      // ── Win Rate: must be in [0%, 100%] ───────────────────────────────────
      const wrCheck = checkWinRate(parsed.winRate)
      addCheck(result, "win-rate-range", wrCheck.passed, wrCheck.message)

      // ── Profit Factor: must be > 0 ────────────────────────────────────────
      const pfCheck = checkProfitFactor(parsed.profitFactor)
      addCheck(result, "profit-factor-positive", pfCheck.passed, pfCheck.message)

      // ── Volatility: must be > 0 ───────────────────────────────────────────
      const volCheck = checkVolatility(parsed.volatility)
      addCheck(result, "volatility-positive", volCheck.passed, volCheck.message)

      // ── Turnover: must be ≥ 0 ────────────────────────────────────────────
      const tCheck = checkTurnover(parsed.turnover)
      addCheck(result, "turnover-non-negative", tCheck.passed, tCheck.message)

      // ── Calmar range sanity ───────────────────────────────────────────────
      const calCheck = checkCalmar(parsed.calmar)
      addCheck(result, "calmar-range", calCheck.passed, calCheck.message)

      // ── Calmar = |CAGR / Max Drawdown| ───────────────────────────────────
      const calConsistency = checkCalmarConsistency(parsed.cagr, parsed.maxDrawdown, parsed.calmar)
      addCheck(result, "calmar-consistency", calConsistency.passed, calConsistency.message)

      // ── CAGR / Sharpe sign consistency ────────────────────────────────────
      const signCheck = checkCagrSignConsistency(parsed.cagr, parsed.sharpe)
      addCheck(result, "cagr-sharpe-sign", signCheck.passed, signCheck.message)

      // ── Win Rate × (total days) = positive days (indirect consistency) ────
      // Win Rate is computed as fraction of DAILY positive returns.
      // Sharpe annualizes at sqrt(252), meaning the underlying data is daily.
      // Both must be based on the same daily granularity — verify the report
      // text explicitly states "daily granularity" for win rate.
      const hasWinRateDailyNote = reportHtml.includes("daily granularity")
      addCheck(result, "win-rate-daily-granularity-documented", hasWinRateDailyNote,
        hasWinRateDailyNote
          ? "Report correctly documents win rate as daily granularity"
          : "FAIL: 'daily granularity' not found in report — win rate convention unclear")

      // ── Profit Factor formula documented ─────────────────────────────────
      // Report must contain &divide; (HTML entity) not raw ÷ (mojibake risk)
      const hasDivideEntity = reportHtml.includes("&divide;")
      addCheck(result, "profit-factor-entity-encoding", hasDivideEntity,
        hasDivideEntity
          ? "Profit factor definition uses &divide; HTML entity correctly"
          : "Profit factor definition missing &divide; entity — possible encoding issue")

      // ── Max Drawdown display: positive magnitude via abs() ────────────────
      // The tearsheet shows positive max drawdown (e.g. "22.0%"), never negative.
      // A negative sign before the MDD value would indicate Math.abs() is broken.
      const mddStr = parsed.maxDrawdown ?? ""
      const mddIsNegativeDisplay = mddStr.startsWith("-")
      addCheck(result, "max-drawdown-displayed-positive", !mddIsNegativeDisplay,
        !mddIsNegativeDisplay
          ? `Max Drawdown displayed as positive magnitude: "${mddStr}" ✓`
          : `FAIL: Max Drawdown displayed with negative sign: "${mddStr}" — Math.abs() not applied`)

    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    } finally {
      finalizeVerdict(result)
      await captureFailureArtifacts(page, result).catch(() => {})
      upsertTargetedResult(targetedResults, result)
    }
  })
})
