/**
 * Targeted Edge-Case QA — Benchmark Overlap / Holdings Truth Tests (T23–T25)
 *
 * Tests:
 *   T23  ETF8 + SPY overlap truth test
 *         SPY is held in ETF8 universe → when benchmark=SPY, overlap warning MUST appear
 *   T24  ETF8 + QQQ overlap truth test
 *         QQQ is held in ETF8 universe → when benchmark=QQQ, overlap warning MUST appear
 *   T25  Non-overlap truth test
 *         SP100 + SPY: SPY is NOT in SP100 universe → overlap warning must NOT appear
 *
 * For each test:
 *   - Runs a completed equal_weight backtest
 *   - Inspects the downloaded tearsheet for benchmark overlap language
 *   - Verifies the warning is present iff the benchmark is actually held
 *   - Also checks that holdings weights sum to ~100%
 *
 * Run only these tests:
 *   npx playwright test tests/targeted-overlap.spec.ts --project=audit
 */

import { test } from "@playwright/test"
import * as fs from "fs"
import {
  BENCHMARK_READY_TIMEOUT_MS,
  RUN_COMPLETION_TIMEOUT_MS,
  CANONICAL_COSTS_BPS,
  CANONICAL_TOP_N,
  UNIVERSE_PRESETS,
} from "../audit.config"
import { addCheck, finalizeVerdict } from "../helpers/verdict"
import {
  makeTargetedResult,
  loadTargetedResults,
  upsertTargetedResult,
  captureFailureArtifacts,
  generateTargetedReports,
} from "../helpers/targeted"
import { checkHoldingsWeightSum } from "../helpers/sanity"
import { parseReportHtml } from "../helpers/report-parser"
import { RunFormPage } from "../pages/RunFormPage"
import { RunDetailPage } from "../pages/RunDetailPage"

const targetedResults = loadTargetedResults()

// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial("Targeted Overlap / Holdings Truth Tests", () => {

  test.afterAll(async () => {
    generateTargetedReports(targetedResults)
  })

  // ── T23: ETF8 + SPY overlap truth test ───────────────────────────────────

  test("[T23] ETF8 + SPY overlap truth test", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__23_etf8_spy_overlap",
      "ETF8 + SPY overlap truth test",
      1023,
      { strategy: "equal_weight", universe: "ETF8", benchmark: "SPY",
        canonicalStartDate: "2019-01-01", canonicalEndDate: "2025-12-31" }
    )

    // SPY IS in ETF8 universe → equal_weight holds SPY → overlap warning expected
    const spyInEtf8 = UNIVERSE_PRESETS["ETF8"].includes("SPY")
    addCheck(result, "spy-in-etf8-universe", spyInEtf8,
      spyInEtf8
        ? "SPY confirmed in ETF8 universe preset — overlap IS expected"
        : "SPY not found in ETF8 universe preset — overlap cannot be triggered")

    if (!spyInEtf8) {
      result.verdict = "VALID-BLOCK"
      result.verdictReason = "SPY not in ETF8 universe — overlap scenario not applicable"
      upsertTargetedResult(targetedResults, result)
      return
    }

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
        finalStatus === "completed" ? "ETF8+SPY run completed" : `Run ended with: ${finalStatus}`)

      if (finalStatus !== "completed") {
        if (finalStatus === "unknown") result.failCause = "run_timeout"
        finalizeVerdict(result)
        await captureFailureArtifacts(page, result)
        upsertTargetedResult(targetedResults, result)
        return
      }

      const { startDate, endDate } = await detailPage.readEffectiveDates()
      result.effectiveStartDate = startDate
      result.effectiveEndDate = endDate

      // Holdings check: equal_weight should hold SPY (it's in the universe)
      const holdings = await detailPage.readHoldings()
      result.holdingsWeightSum = holdings.weightSum
      result.holdingsCount = holdings.count
      const hCheck = checkHoldingsWeightSum(holdings.weightSum, holdings.count)
      addCheck(result, "holdings-weight-sum", hCheck.passed, hCheck.message)

      const spyHeld = holdings.positions.some((p) => p.symbol === "SPY")
      addCheck(result, "spy-held-in-portfolio", spyHeld,
        spyHeld
          ? `SPY is held in equal_weight ETF8 portfolio (weight=${holdings.positions.find(p => p.symbol === "SPY")?.weight?.toFixed(2)}%)`
          : "SPY NOT held in equal_weight ETF8 portfolio — overlap warning may not be generated")

      // Holdings weight sum internal consistency check
      if (holdings.weightSum > 0) {
        const avgWeight = holdings.weightSum / holdings.count
        addCheck(result, "equal-weight-roughly-uniform",
          Math.abs(avgWeight - (100 / holdings.count)) < 5,
          `Average weight ${avgWeight.toFixed(2)}% vs expected ${(100 / holdings.count).toFixed(2)}% (equal weight)`)
      }

      // Tearsheet overlap check
      const reportPath = await detailPage.downloadTearsheet(finalRunId)
      if (!reportPath) {
        addCheck(result, "tearsheet-downloaded", false, "Tearsheet download failed")
      } else {
        result.reportFilename = require("path").basename(reportPath)
        const reportHtml = fs.readFileSync(reportPath, "utf-8")
        const parsed = parseReportHtml(reportHtml)
        result.reportCagr = parsed.cagr

        // Core assertion T23: overlap warning MUST appear when SPY is held and is the benchmark
        if (spyHeld) {
          addCheck(result, "overlap-warning-present-t23", parsed.benchmarkOverlapDetected,
            parsed.benchmarkOverlapDetected
              ? "Tearsheet correctly shows benchmark overlap warning (SPY held + SPY is benchmark)"
              : "FAIL: SPY is held in portfolio AND is the benchmark, but tearsheet has NO overlap warning — overlap detection defect")
        } else {
          // SPY not actually held (e.g. topN < 8 excluded it) — overlap may not appear
          addCheck(result, "overlap-warning-conditional", true,
            "SPY not held at current snapshot date — overlap warning absence is acceptable")
        }

        // Check overlap warning wording is truthful (mentions "portfolio holds" and references SPY or benchmark)
        if (parsed.benchmarkOverlapDetected) {
          const htmlLower = reportHtml.toLowerCase()
          const mentionsSpy =
            htmlLower.includes("spy") || htmlLower.includes("benchmark") ||
            htmlLower.includes("portfolio holds") || htmlLower.includes("overlap")
          addCheck(result, "overlap-warning-truthful", mentionsSpy,
            mentionsSpy
              ? "Overlap warning is truthful — references benchmark/portfolio"
              : "Overlap warning text does not reference benchmark or portfolio — may be misleading")
        }
      }

    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T24: ETF8 + QQQ overlap truth test ───────────────────────────────────

  test("[T24] ETF8 + QQQ overlap truth test", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__24_etf8_qqq_overlap",
      "ETF8 + QQQ overlap truth test",
      1024,
      { strategy: "equal_weight", universe: "ETF8", benchmark: "QQQ",
        canonicalStartDate: "2019-01-01", canonicalEndDate: "2025-12-31" }
    )

    const qqqInEtf8 = UNIVERSE_PRESETS["ETF8"].includes("QQQ")
    addCheck(result, "qqq-in-etf8-universe", qqqInEtf8,
      qqqInEtf8
        ? "QQQ confirmed in ETF8 universe — overlap IS expected"
        : "QQQ not in ETF8 universe — overlap scenario not applicable")

    if (!qqqInEtf8) {
      result.verdict = "VALID-BLOCK"
      result.verdictReason = "QQQ not in ETF8 universe — overlap scenario not applicable"
      upsertTargetedResult(targetedResults, result)
      return
    }

    try {
      const formPage = new RunFormPage(page)
      const detailPage = new RunDetailPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "equal_weight",
        universe: "ETF8",
        benchmark: "QQQ",
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
        finalStatus === "completed" ? "ETF8+QQQ run completed" : `Run ended with: ${finalStatus}`)

      if (finalStatus !== "completed") {
        if (finalStatus === "unknown") result.failCause = "run_timeout"
        finalizeVerdict(result)
        await captureFailureArtifacts(page, result)
        upsertTargetedResult(targetedResults, result)
        return
      }

      const { startDate, endDate } = await detailPage.readEffectiveDates()
      result.effectiveStartDate = startDate
      result.effectiveEndDate = endDate

      const holdings = await detailPage.readHoldings()
      result.holdingsWeightSum = holdings.weightSum
      result.holdingsCount = holdings.count
      const hCheck = checkHoldingsWeightSum(holdings.weightSum, holdings.count)
      addCheck(result, "holdings-weight-sum", hCheck.passed, hCheck.message)

      const qqqHeld = holdings.positions.some((p) => p.symbol === "QQQ")
      addCheck(result, "qqq-held-in-portfolio", qqqHeld,
        qqqHeld
          ? `QQQ is held in equal_weight ETF8 portfolio (weight=${holdings.positions.find(p => p.symbol === "QQQ")?.weight?.toFixed(2)}%)`
          : "QQQ NOT held in equal_weight ETF8 portfolio — overlap warning may not be generated")

      const reportPath = await detailPage.downloadTearsheet(finalRunId)
      if (!reportPath) {
        addCheck(result, "tearsheet-downloaded", false, "Tearsheet download failed")
      } else {
        result.reportFilename = require("path").basename(reportPath)
        const reportHtml = fs.readFileSync(reportPath, "utf-8")
        const parsed = parseReportHtml(reportHtml)
        result.reportCagr = parsed.cagr

        if (qqqHeld) {
          addCheck(result, "overlap-warning-present-t24", parsed.benchmarkOverlapDetected,
            parsed.benchmarkOverlapDetected
              ? "Tearsheet correctly shows benchmark overlap warning (QQQ held + QQQ is benchmark)"
              : "FAIL: QQQ is held in portfolio AND is benchmark, but no overlap warning in tearsheet")
        } else {
          addCheck(result, "overlap-warning-conditional", true,
            "QQQ not held at snapshot — overlap absence is acceptable")
        }

        if (parsed.benchmarkOverlapDetected) {
          const htmlLower = reportHtml.toLowerCase()
          addCheck(result, "overlap-warning-truthful",
            htmlLower.includes("qqq") || htmlLower.includes("benchmark") || htmlLower.includes("portfolio holds"),
            "Overlap warning references benchmark or portfolio holdings")
        }
      }

    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T25: Non-overlap truth test (SP100 + SPY) ─────────────────────────────

  test("[T25] Non-overlap truth test (SP100 + SPY — SPY not in SP100 universe)", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__25_sp100_spy_no_overlap",
      "Non-overlap truth test (SP100 + SPY)",
      1025,
      { strategy: "equal_weight", universe: "SP100", benchmark: "SPY",
        canonicalStartDate: "2019-01-01", canonicalEndDate: "2025-12-31" }
    )

    // SP100 universe is stocks — SPY (an ETF) should NOT be a position
    const spyInSp100 = UNIVERSE_PRESETS["SP100"].includes("SPY")
    addCheck(result, "spy-not-in-sp100-universe", !spyInSp100,
      !spyInSp100
        ? "SPY confirmed NOT in SP100 universe preset — no overlap expected"
        : "SPY IS in SP100 universe preset — this test premise is invalid; re-check UNIVERSE_PRESETS")

    if (spyInSp100) {
      result.verdict = "VALID-BLOCK"
      result.verdictReason = "SPY unexpectedly in SP100 universe — test premise invalid"
      upsertTargetedResult(targetedResults, result)
      return
    }

    try {
      const formPage = new RunFormPage(page)
      const detailPage = new RunDetailPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "equal_weight",
        universe: "SP100",
        benchmark: "SPY",
        startDate: "2019-01-01",
        endDate: "2025-12-31",
        costsBps: CANONICAL_COSTS_BPS,
        topN: CANONICAL_TOP_N["SP100"],
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
        finalStatus === "completed" ? "SP100+SPY run completed" : `Run ended with: ${finalStatus}`)

      if (finalStatus !== "completed") {
        if (finalStatus === "unknown") result.failCause = "run_timeout"
        finalizeVerdict(result)
        await captureFailureArtifacts(page, result)
        upsertTargetedResult(targetedResults, result)
        return
      }

      const { startDate, endDate } = await detailPage.readEffectiveDates()
      result.effectiveStartDate = startDate
      result.effectiveEndDate = endDate

      const holdings = await detailPage.readHoldings()
      result.holdingsWeightSum = holdings.weightSum
      result.holdingsCount = holdings.count
      const hCheck = checkHoldingsWeightSum(holdings.weightSum, holdings.count)
      addCheck(result, "holdings-weight-sum", hCheck.passed, hCheck.message)

      // Verify SPY is NOT in the holdings (SP100 universe has no ETFs)
      const spyHeld = holdings.positions.some((p) => p.symbol === "SPY")
      addCheck(result, "spy-not-in-sp100-holdings", !spyHeld,
        !spyHeld
          ? "SPY correctly absent from SP100 equal_weight holdings"
          : "SPY appeared in SP100 equal_weight holdings — unexpected (SPY is not a S&P 100 stock)")

      // Holdings consistency check — equal_weight holds the full universe, not just topN
      const universeSize = UNIVERSE_PRESETS["SP100"].length
      addCheck(result, "holdings-count-matches-topn", holdings.count === universeSize,
        holdings.count === universeSize
          ? `Holdings count ${holdings.count} matches SP100 universe size (${universeSize}) — correct for equal_weight`
          : `Holdings count ${holdings.count} does not match expected SP100 universe size (${universeSize})`)

      // Tearsheet overlap check — NO overlap warning expected
      const reportPath = await detailPage.downloadTearsheet(finalRunId)
      if (!reportPath) {
        addCheck(result, "tearsheet-downloaded", false, "Tearsheet download failed")
      } else {
        result.reportFilename = require("path").basename(reportPath)
        const reportHtml = fs.readFileSync(reportPath, "utf-8")
        const parsed = parseReportHtml(reportHtml)
        result.reportCagr = parsed.cagr

        // Core assertion T25: NO overlap warning when SPY is NOT in portfolio
        addCheck(result, "no-overlap-warning-t25", !parsed.benchmarkOverlapDetected,
          !parsed.benchmarkOverlapDetected
            ? "Tearsheet correctly has NO overlap warning (SPY not in SP100 portfolio)"
            : "FAIL: Tearsheet shows an overlap warning for SP100+SPY, but SPY is not in SP100 universe — false positive overlap detection")
      }

    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

})
