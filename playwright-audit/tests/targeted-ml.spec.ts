/**
 * Targeted Edge-Case QA — ML Edge Tests (T9–T16)
 *
 * Tests:
 *   T9   ml_ridge  Top N too high (ETF8 → topN=9 > 8 available)
 *   T10  ml_lightgbm Top N too high
 *   T11  ml_ridge too-early start (insufficient training history)
 *   T12  ml_lightgbm too-early start
 *   T13  ml_ridge completed run → ML Insights present
 *   T14  ml_lightgbm completed run → ML Insights present
 *   T15  ml_ridge tearsheet encoding check
 *   T16  ml_lightgbm tearsheet encoding check
 *
 * Note: T13+T15 share a single ml_ridge run; T14+T16 share a single ml_lightgbm run.
 *
 * Run only these tests:
 *   npx playwright test tests/targeted-ml.spec.ts --project=audit
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
  runAllKpiChecks,
  checkEncoding,
  checkHoldingsWeightSum,
} from "../helpers/sanity"
import { parseReportHtml } from "../helpers/report-parser"
import { RunFormPage } from "../pages/RunFormPage"
import { RunDetailPage } from "../pages/RunDetailPage"

const targetedResults = loadTargetedResults()

// Shared run IDs from T13/T14 — used by T15/T16 for tearsheet checks
const sharedRunIds: { ml_ridge?: string; ml_lightgbm?: string } = {}

// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial("Targeted ML Edge Tests", () => {

  test.afterAll(async () => {
    generateTargetedReports(targetedResults)
  })

  // ── T9: ml_ridge Top N too high ───────────────────────────────────────────

  test("[T9] ml_ridge Top N too high (ETF8 topN=9 > 8 universe size)", async ({ page }) => {
    test.setTimeout(120_000)

    const result = makeTargetedResult(
      "targeted__09_ml_ridge_topn_too_high",
      "ml_ridge Top N too high",
      1009,
      { strategy: "ml_ridge", universe: "ETF8", benchmark: "SPY" }
    )

    try {
      const formPage = new RunFormPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      // ETF8 has 8 universe symbols; top_n=9 exceeds universe size
      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "ml_ridge",
        universe: "ETF8",
        benchmark: "SPY",
        startDate: "2019-01-01",
        endDate: "2025-12-31",
        costsBps: CANONICAL_COSTS_BPS,
        topN: 9,  // > 8 = ETF8 universe size
      })

      result.attemptedStartDate = "2019-01-01"
      result.attemptedEndDate = "2025-12-31"

      if (preflight?.status === "block") {
        result.preflightStatus = "block"
        result.preflightMessages.push(...preflight.messages)
        const blockText = preflight.messages.join(" ").toLowerCase()

        // Must mention top_n or reduce or universe size
        const mentionsTopN =
          blockText.includes("top n") || blockText.includes("top_n") ||
          blockText.includes("reduce") || blockText.includes("universe") ||
          blockText.includes("symbols") || blockText.includes("size") ||
          blockText.includes("exceed")
        addCheck(result, "block-mentions-top-n", mentionsTopN,
          mentionsTopN
            ? `Block correctly references Top N/universe constraint: ${preflight.messages[0]?.slice(0, 120)}`
            : `Block does not mention Top N or universe size — message may be misleading: ${preflight.messages[0]?.slice(0, 120)}`)

        // Check if fix suggestion is actionable
        const hasActionableFix =
          blockText.includes("reduce") || blockText.includes("lower") ||
          blockText.includes("decrease") || blockText.includes("set") ||
          blockText.includes("use") || blockText.includes("max")
        addCheck(result, "block-fix-actionable", hasActionableFix,
          hasActionableFix
            ? `Block fix is actionable: ${preflight.messages.map(m => m.slice(0, 80)).join("; ")}`
            : `Block fix may not be actionable: ${preflight.messages.map(m => m.slice(0, 80)).join("; ")}`)

        result.verdict = "VALID-BLOCK"
        result.verdictReason = `VALID-BLOCK: Top N too high correctly blocked — ${preflight.messages[0]?.slice(0, 100)}`
      } else if (runId) {
        // Run was created with top_n=9 > 8 symbols — app should have blocked this
        result.runId = runId
        result.preflightStatus = "ok"
        addCheck(result, "top-n-block-expected", false,
          `FAIL: Run was created with top_n=9 > ETF8 universe size (8) — expected a preflight block`)
        result.failures.push("ml_ridge with topN=9 > ETF8(8) was allowed to run without a preflight block")
      } else {
        result.preflightStatus = preflight?.status ?? "error"
        if (preflight?.messages) result.preflightMessages.push(...preflight.messages)
        addCheck(result, "preflight-outcome-captured", false,
          `No block and no run ID — unexpected form outcome: status=${preflight?.status}`)
      }
    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T10: ml_lightgbm Top N too high ──────────────────────────────────────

  test("[T10] ml_lightgbm Top N too high (ETF8 topN=9 > 8 universe size)", async ({ page }) => {
    test.setTimeout(120_000)

    const result = makeTargetedResult(
      "targeted__10_ml_lightgbm_topn_too_high",
      "ml_lightgbm Top N too high",
      1010,
      { strategy: "ml_lightgbm", universe: "ETF8", benchmark: "SPY" }
    )

    try {
      const formPage = new RunFormPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "ml_lightgbm",
        universe: "ETF8",
        benchmark: "SPY",
        startDate: "2019-01-01",
        endDate: "2025-12-31",
        costsBps: CANONICAL_COSTS_BPS,
        topN: 9,
      })

      result.attemptedStartDate = "2019-01-01"
      result.attemptedEndDate = "2025-12-31"

      if (preflight?.status === "block") {
        result.preflightStatus = "block"
        result.preflightMessages.push(...preflight.messages)
        const blockText = preflight.messages.join(" ").toLowerCase()
        const mentionsTopN =
          blockText.includes("top n") || blockText.includes("top_n") ||
          blockText.includes("reduce") || blockText.includes("universe") ||
          blockText.includes("symbols") || blockText.includes("size") ||
          blockText.includes("exceed")
        addCheck(result, "block-mentions-top-n", mentionsTopN,
          mentionsTopN
            ? `Block correctly references Top N/universe: ${preflight.messages[0]?.slice(0, 120)}`
            : `Block does not mention Top N or universe size: ${preflight.messages[0]?.slice(0, 120)}`)
        const hasActionableFix =
          blockText.includes("reduce") || blockText.includes("lower") ||
          blockText.includes("decrease") || blockText.includes("set") ||
          blockText.includes("use") || blockText.includes("max")
        addCheck(result, "block-fix-actionable", hasActionableFix,
          hasActionableFix
            ? `Fix is actionable: ${preflight.messages.map(m => m.slice(0, 80)).join("; ")}`
            : `Fix may not be actionable: ${preflight.messages.map(m => m.slice(0, 80)).join("; ")}`)
        result.verdict = "VALID-BLOCK"
        result.verdictReason = `VALID-BLOCK: Top N too high correctly blocked — ${preflight.messages[0]?.slice(0, 100)}`
      } else if (runId) {
        result.runId = runId
        result.preflightStatus = "ok"
        addCheck(result, "top-n-block-expected", false,
          `FAIL: ml_lightgbm with topN=9 > ETF8(8) was allowed without a preflight block`)
        result.failures.push("ml_lightgbm with topN=9 > ETF8(8) was allowed to run without a preflight block")
      } else {
        result.preflightStatus = preflight?.status ?? "error"
        if (preflight?.messages) result.preflightMessages.push(...preflight.messages)
        addCheck(result, "preflight-outcome-captured", false,
          `No block and no run ID: status=${preflight?.status}`)
      }
    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T11: ml_ridge too-early start (insufficient training history) ─────────

  test("[T11] ml_ridge too-early start (insufficient training history)", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    // Use a very short window: only ~2 months.
    // ML needs train_rows >= 252 * top_n. In 2 months (≈40 trading days × 8 symbols = 320),
    // this is far below 252 * 5 = 1260.
    const result = makeTargetedResult(
      "targeted__11_ml_ridge_short_window",
      "ml_ridge too-early start / insufficient training history",
      1011,
      { strategy: "ml_ridge", universe: "ETF8", benchmark: "SPY",
        canonicalStartDate: "2024-10-01", canonicalEndDate: "2024-12-01" }
    )

    try {
      const formPage = new RunFormPage(page)
      const detailPage = new RunDetailPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "ml_ridge",
        universe: "ETF8",
        benchmark: "SPY",
        startDate: "2024-10-01",
        endDate: "2024-12-01",
        costsBps: CANONICAL_COSTS_BPS,
        topN: CANONICAL_TOP_N["ETF8"],
      })

      result.attemptedStartDate = "2024-10-01"
      result.attemptedEndDate = "2024-12-01"

      if (preflight?.status === "block") {
        // Preflight-level training history check
        result.preflightStatus = "block"
        result.preflightMessages.push(...preflight.messages)
        const blockText = preflight.messages.join(" ").toLowerCase()
        const mentionsTraining =
          blockText.includes("train") || blockText.includes("history") ||
          blockText.includes("warmup") || blockText.includes("insufficient") ||
          blockText.includes("start") || blockText.includes("window") ||
          blockText.includes("period") || blockText.includes("minimum")
        addCheck(result, "block-mentions-training", mentionsTraining,
          mentionsTraining
            ? `Block references training/history constraint: ${preflight.messages.join("; ").slice(0, 150)}`
            : `Block present but does not mention training history: ${preflight.messages[0]?.slice(0, 120)}`)
        // Check for coherent (non-contradictory) diagnostic numbers
        const hasNumbers = /\d+/.test(blockText)
        addCheck(result, "block-has-diagnostic-numbers", hasNumbers,
          hasNumbers
            ? `Block includes diagnostic numbers (train days/rows/symbols): ${preflight.messages[0]?.slice(0, 120)}`
            : `Block lacks diagnostic numbers — diagnostics may be missing`)
        result.verdict = "VALID-BLOCK"
        result.verdictReason = `VALID-BLOCK: ML training block at preflight: ${preflight.messages[0]?.slice(0, 100)}`
        upsertTargetedResult(targetedResults, result)
        return
      }

      if (runId) {
        result.runId = runId
        result.preflightStatus = preflight?.status ?? "ok"
        if (preflight?.messages) result.preflightMessages.push(...preflight.messages)
        await detailPage.goto(runId)

        // Wait for the run to finish — expect it to FAIL with a training history error
        const initialStatus = await detailPage.readStatus()
        if (initialStatus === "waiting_for_data") {
          const br = await detailPage.waitUntilBenchmarkReady(runId, BENCHMARK_READY_TIMEOUT_MS)
          result.benchmarkWaitMs = br.elapsedMs
          if (!br.ready) {
            result.failCause = "benchmark_ingestion_timeout"
            addCheck(result, "run-failed-as-expected", false, "Run stuck in waiting_for_data — timeout")
            finalizeVerdict(result)
            await captureFailureArtifacts(page, result)
            upsertTargetedResult(targetedResults, result)
            return
          }
        }

        const finalStatus = await detailPage.waitForCompletion(runId, RUN_COMPLETION_TIMEOUT_MS)

        if (finalStatus === "failed") {
          // Run failed — verify the error message is coherent
          addCheck(result, "run-failed-for-short-window", true,
            "Run correctly failed for short window (insufficient ML training data)")

          // Try to read error message from the page
          const errorText = await page.locator(
            '[class*="text-destructive"], [class*="error"], [class*="failed"]'
          ).first().textContent().catch(() => null)

          if (errorText) {
            const lower = errorText.toLowerCase()
            const isCoherent =
              lower.includes("train") || lower.includes("history") ||
              lower.includes("insufficient") || lower.includes("sample") ||
              lower.includes("window") || lower.includes("data")
            addCheck(result, "error-message-coherent", isCoherent,
              isCoherent
                ? `Error message references training/history: ${errorText.slice(0, 150)}`
                : `Error message present but does not mention training: ${errorText.slice(0, 150)}`)
          } else {
            addCheck(result, "error-message-present", false,
              "Run failed but no error message visible — user cannot diagnose the problem")
          }

          result.verdict = "VALID-BLOCK"
          result.verdictReason = "VALID-BLOCK: Run correctly failed for insufficient ML training window"
        } else if (finalStatus === "completed") {
          // Run completed despite extremely short window — check if ML insights are coherent
          addCheck(result, "run-failed-as-expected", false,
            `Run COMPLETED on a 2-month window — expected failure for insufficient ML training data. ` +
            `This may indicate the ML validation threshold is not enforced for this window size.`)
          result.failures.push(
            "ml_ridge completed on a 2-month window (2024-10-01 to 2024-12-01). " +
            "Expected training data validation to fail (train_rows < 252*top_n)."
          )
        } else {
          addCheck(result, "run-outcome-clear", finalStatus !== "unknown",
            finalStatus !== "unknown"
              ? `Run ended with status: ${finalStatus}`
              : `Run timed out — could not determine outcome`)
          if (finalStatus === "unknown") result.failCause = "run_timeout"
        }
      } else {
        result.preflightStatus = preflight?.status ?? "error"
        if (preflight?.messages) result.preflightMessages.push(...preflight.messages)
        addCheck(result, "outcome-captured", false,
          `No run ID and status=${preflight?.status} — unexpected outcome`)
      }
    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T12: ml_lightgbm too-early start (insufficient training history) ──────

  test("[T12] ml_lightgbm too-early start (insufficient training history)", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__12_ml_lightgbm_short_window",
      "ml_lightgbm too-early start / insufficient training history",
      1012,
      { strategy: "ml_lightgbm", universe: "ETF8", benchmark: "SPY",
        canonicalStartDate: "2024-10-01", canonicalEndDate: "2024-12-01" }
    )

    try {
      const formPage = new RunFormPage(page)
      const detailPage = new RunDetailPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "ml_lightgbm",
        universe: "ETF8",
        benchmark: "SPY",
        startDate: "2024-10-01",
        endDate: "2024-12-01",
        costsBps: CANONICAL_COSTS_BPS,
        topN: CANONICAL_TOP_N["ETF8"],
      })

      result.attemptedStartDate = "2024-10-01"
      result.attemptedEndDate = "2024-12-01"

      if (preflight?.status === "block") {
        result.preflightStatus = "block"
        result.preflightMessages.push(...preflight.messages)
        const blockText = preflight.messages.join(" ").toLowerCase()
        const mentionsTraining =
          blockText.includes("train") || blockText.includes("history") ||
          blockText.includes("warmup") || blockText.includes("insufficient") ||
          blockText.includes("start") || blockText.includes("window") ||
          blockText.includes("minimum")
        addCheck(result, "block-mentions-training", mentionsTraining,
          mentionsTraining
            ? `Block references training/history: ${preflight.messages[0]?.slice(0, 120)}`
            : `Block present but misses training context: ${preflight.messages[0]?.slice(0, 120)}`)
        const hasNumbers = /\d+/.test(blockText)
        addCheck(result, "block-has-diagnostic-numbers", hasNumbers,
          hasNumbers ? "Block includes diagnostic numbers" : "Block lacks diagnostic numbers")
        result.verdict = "VALID-BLOCK"
        result.verdictReason = `VALID-BLOCK: ML training block at preflight: ${preflight.messages[0]?.slice(0, 100)}`
        upsertTargetedResult(targetedResults, result)
        return
      }

      if (runId) {
        result.runId = runId
        result.preflightStatus = preflight?.status ?? "ok"
        if (preflight?.messages) result.preflightMessages.push(...preflight.messages)
        await detailPage.goto(runId)

        const initialStatus = await detailPage.readStatus()
        if (initialStatus === "waiting_for_data") {
          const br = await detailPage.waitUntilBenchmarkReady(runId, BENCHMARK_READY_TIMEOUT_MS)
          result.benchmarkWaitMs = br.elapsedMs
          if (!br.ready) {
            result.failCause = "benchmark_ingestion_timeout"
            finalizeVerdict(result)
            await captureFailureArtifacts(page, result)
            upsertTargetedResult(targetedResults, result)
            return
          }
        }

        const finalStatus = await detailPage.waitForCompletion(runId, RUN_COMPLETION_TIMEOUT_MS)

        if (finalStatus === "failed") {
          addCheck(result, "run-failed-for-short-window", true,
            "ml_lightgbm correctly failed for short training window")
          const errorText = await page.locator(
            '[class*="text-destructive"], [class*="error"]'
          ).first().textContent().catch(() => null)
          if (errorText) {
            const lower = errorText.toLowerCase()
            const isCoherent =
              lower.includes("train") || lower.includes("history") ||
              lower.includes("insufficient") || lower.includes("window")
            addCheck(result, "error-message-coherent", isCoherent,
              isCoherent
                ? `Error references training: ${errorText.slice(0, 150)}`
                : `Error does not mention training: ${errorText.slice(0, 150)}`)
          } else {
            addCheck(result, "error-message-present", false, "No error message visible for failed run")
          }
          result.verdict = "VALID-BLOCK"
          result.verdictReason = "VALID-BLOCK: ml_lightgbm correctly failed for insufficient training window"
        } else if (finalStatus === "completed") {
          addCheck(result, "run-failed-as-expected", false,
            "ml_lightgbm completed on a 2-month window — expected training validation failure")
          result.failures.push("ml_lightgbm completed on a 2-month window — training validation not enforced")
        } else {
          if (finalStatus === "unknown") result.failCause = "run_timeout"
          addCheck(result, "run-outcome-clear", finalStatus !== "unknown",
            finalStatus !== "unknown" ? `Status: ${finalStatus}` : "Run timed out")
        }
      } else {
        result.preflightStatus = preflight?.status ?? "error"
        if (preflight?.messages) result.preflightMessages.push(...preflight.messages)
        addCheck(result, "outcome-captured", false, `No run ID, status=${preflight?.status}`)
      }
    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T13 + T15: ml_ridge completed run → ML Insights + Encoding ───────────

  test("[T13+T15] ml_ridge completed run — ML Insights + tearsheet encoding", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__13_15_ml_ridge_insights_encoding",
      "ml_ridge completed run — ML Insights present + tearsheet encoding",
      1013,
      { strategy: "ml_ridge", universe: "ETF8", benchmark: "SPY",
        canonicalStartDate: "2019-01-01", canonicalEndDate: "2025-12-31" }
    )

    try {
      const formPage = new RunFormPage(page)
      const detailPage = new RunDetailPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "ml_ridge",
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
        addCheck(result, "run-created", false, "No run ID captured for ml_ridge")
        finalizeVerdict(result)
        await captureFailureArtifacts(page, result)
        upsertTargetedResult(targetedResults, result)
        return
      }

      result.runId = finalRunId
      sharedRunIds.ml_ridge = finalRunId

      await detailPage.goto(finalRunId)

      const initialStatus = await detailPage.readStatus()
      if (initialStatus === "waiting_for_data") {
        const br = await detailPage.waitUntilBenchmarkReady(finalRunId, BENCHMARK_READY_TIMEOUT_MS)
        result.benchmarkWaitMs = br.elapsedMs
        if (!br.ready) {
          result.failCause = "benchmark_ingestion_timeout"
          result.failures.push("ml_ridge run stuck in waiting_for_data")
          finalizeVerdict(result)
          await captureFailureArtifacts(page, result)
          upsertTargetedResult(targetedResults, result)
          return
        }
      }

      const finalStatus = await detailPage.waitForCompletion(finalRunId, RUN_COMPLETION_TIMEOUT_MS)
      addCheck(result, "run-completed", finalStatus === "completed",
        finalStatus === "completed" ? "ml_ridge run completed" : `Run ended with: ${finalStatus}`)

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

      // ── T13: ML Insights ──────────────────────────────────────────────────
      const mlTabVisible = await detailPage.isMLInsightsTabVisible()
      result.mlInsightsPresent = mlTabVisible
      addCheck(result, "ml-insights-tab-visible", mlTabVisible,
        mlTabVisible ? "ML Insights tab visible for ml_ridge" : "ML Insights tab missing for ml_ridge")

      if (mlTabVisible) {
        const mlInsights = await detailPage.readMLInsights()
        result.mlFeatureImportancePresent = mlInsights.featureImportancePresent
        result.mlLatestPicksWeightSum = mlInsights.latestPicksWeightSum
        result.mlTrainWindow = mlInsights.trainWindow
        result.mlRebalancesCount = mlInsights.rebalancesCount

        addCheck(result, "ml-feature-importance-present", mlInsights.featureImportancePresent,
          mlInsights.featureImportancePresent
            ? "Feature importance chart present"
            : "Feature importance chart MISSING — ML run completed but no feature importance")

        if (mlInsights.latestPicksWeightSum !== null) {
          addCheck(result, "ml-picks-weight-sum", Math.abs(mlInsights.latestPicksWeightSum - 100) < 3,
            `ML latest picks weight sum: ${mlInsights.latestPicksWeightSum?.toFixed(2)}%`)
        } else {
          addCheck(result, "ml-picks-present", false, "ML latest picks weight sum not readable")
        }

        addCheck(result, "ml-train-window-present", mlInsights.trainWindow !== null,
          mlInsights.trainWindow
            ? `Train window metadata: ${mlInsights.trainWindow}`
            : "Train window metadata missing from ML Insights")

        addCheck(result, "ml-rebalances-present", mlInsights.rebalancesCount !== null,
          mlInsights.rebalancesCount
            ? `Rebalances count: ${mlInsights.rebalancesCount}`
            : "Rebalances count missing from ML Insights")
      }

      // ── T15: Tearsheet encoding ───────────────────────────────────────────
      const kpis = await detailPage.readKPIs()
      result.uiCagr = kpis.cagr
      result.uiSharpe = kpis.sharpe
      result.uiMaxDrawdown = kpis.maxDrawdown
      result.uiVolatility = kpis.volatility
      result.uiWinRate = kpis.winRate
      result.uiProfitFactor = kpis.profitFactor
      result.uiTurnover = kpis.turnover
      result.uiCalmar = kpis.calmar

      const reportPath = await detailPage.downloadTearsheet(finalRunId)
      if (!reportPath) {
        addCheck(result, "tearsheet-downloaded", false, "Tearsheet download failed for ml_ridge")
      } else {
        result.reportFilename = require("path").basename(reportPath)
        addCheck(result, "tearsheet-downloaded", true, `Tearsheet saved: ${result.reportFilename}`)

        const reportHtml = fs.readFileSync(reportPath, "utf-8")
        const parsed = parseReportHtml(reportHtml)
        result.reportCagr = parsed.cagr
        result.reportSharpe = parsed.sharpe
        result.reportMaxDrawdown = parsed.maxDrawdown
        result.reportVolatility = parsed.volatility

        // Encoding check — the main T15 assertion
        const encCheck = checkEncoding("ml_ridge tearsheet raw HTML", reportHtml.slice(0, 100_000))
        addCheck(result, "tearsheet-encoding-t15", encCheck.passed, encCheck.message)

        // Also check meta section specifically
        const encMetaCheck = checkEncoding("ml_ridge tearsheet meta", parsed.rawTextSnippet)
        addCheck(result, "tearsheet-encoding-meta-t15", encMetaCheck.passed, encMetaCheck.message)

        // Check for known mojibake patterns explicitly (÷, ×, —)
        const badPatterns = [
          { pattern: /\u00e2\u0080\u0093/g, name: "mojibake-em-dash (for \u2014)" },
          { pattern: /\u00c3\u00d7/g, name: "mojibake-times (for \u00d7)" },
          { pattern: /\u00c3\u00b7/g, name: "mojibake-divide (for \u00f7)" },
          { pattern: /\u00e2\u0080\u0098/g, name: "mojibake-left-quote (for \u2018)" },
        ]
        let foundMojibake = false
        for (const { pattern, name } of badPatterns) {
          if (pattern.test(reportHtml)) {
            foundMojibake = true
            addCheck(result, `no-mojibake-${name}`, false,
              `Tearsheet contains mojibake pattern: ${name}`)
          }
        }
        if (!foundMojibake) {
          addCheck(result, "no-common-mojibake", true, "No common mojibake patterns found in tearsheet")
        }

        // Parse errors (non-optional fields missing)
        for (const err of parsed.parseErrors) {
          if (!err.toLowerCase().includes("optional") && !err.toLowerCase().includes("backfill")) {
            addCheck(result, `tearsheet-parse-${err.slice(0, 30)}`, false, err)
          }
        }

        // KPI sanity from tearsheet
        const reportKpiChecks = runAllKpiChecks({
          cagr: parsed.cagr, sharpe: parsed.sharpe, maxDrawdown: parsed.maxDrawdown,
          volatility: parsed.volatility, winRate: parsed.winRate, profitFactor: parsed.profitFactor,
          turnover: parsed.turnover, calmar: parsed.calmar,
        })
        for (const c of reportKpiChecks) {
          addCheck(result, `report-kpi-sanity:${c.message.split(":")[0]}`, c.passed, `[ml_ridge report] ${c.message}`)
        }
      }

      // Holdings check
      const holdings = await detailPage.readHoldings()
      result.holdingsWeightSum = holdings.weightSum
      result.holdingsCount = holdings.count
      const hCheck = checkHoldingsWeightSum(holdings.weightSum, holdings.count)
      addCheck(result, "holdings-weight-sum", hCheck.passed, hCheck.message)

    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T14 + T16: ml_lightgbm completed run → ML Insights + Encoding ─────────

  test("[T14+T16] ml_lightgbm completed run — ML Insights + tearsheet encoding", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__14_16_ml_lightgbm_insights_encoding",
      "ml_lightgbm completed run — ML Insights present + tearsheet encoding",
      1014,
      { strategy: "ml_lightgbm", universe: "ETF8", benchmark: "SPY",
        canonicalStartDate: "2019-01-01", canonicalEndDate: "2025-12-31" }
    )

    try {
      const formPage = new RunFormPage(page)
      const detailPage = new RunDetailPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "ml_lightgbm",
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
        addCheck(result, "run-created", false, "No run ID for ml_lightgbm")
        finalizeVerdict(result)
        await captureFailureArtifacts(page, result)
        upsertTargetedResult(targetedResults, result)
        return
      }

      result.runId = finalRunId
      sharedRunIds.ml_lightgbm = finalRunId

      await detailPage.goto(finalRunId)
      const initialStatus = await detailPage.readStatus()
      if (initialStatus === "waiting_for_data") {
        const br = await detailPage.waitUntilBenchmarkReady(finalRunId, BENCHMARK_READY_TIMEOUT_MS)
        result.benchmarkWaitMs = br.elapsedMs
        if (!br.ready) {
          result.failCause = "benchmark_ingestion_timeout"
          result.failures.push("ml_lightgbm run stuck in waiting_for_data")
          finalizeVerdict(result)
          await captureFailureArtifacts(page, result)
          upsertTargetedResult(targetedResults, result)
          return
        }
      }

      const finalStatus = await detailPage.waitForCompletion(finalRunId, RUN_COMPLETION_TIMEOUT_MS)
      addCheck(result, "run-completed", finalStatus === "completed",
        finalStatus === "completed" ? "ml_lightgbm run completed" : `Run ended with: ${finalStatus}`)

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

      // ── T14: ML Insights ──────────────────────────────────────────────────
      const mlTabVisible = await detailPage.isMLInsightsTabVisible()
      result.mlInsightsPresent = mlTabVisible
      addCheck(result, "ml-insights-tab-visible", mlTabVisible,
        mlTabVisible ? "ML Insights tab visible for ml_lightgbm" : "ML Insights tab missing for ml_lightgbm")

      if (mlTabVisible) {
        const mlInsights = await detailPage.readMLInsights()
        result.mlFeatureImportancePresent = mlInsights.featureImportancePresent
        result.mlLatestPicksWeightSum = mlInsights.latestPicksWeightSum
        result.mlTrainWindow = mlInsights.trainWindow
        result.mlRebalancesCount = mlInsights.rebalancesCount

        addCheck(result, "ml-feature-importance-present", mlInsights.featureImportancePresent,
          mlInsights.featureImportancePresent
            ? "Feature importance chart present"
            : "Feature importance chart MISSING for ml_lightgbm")

        if (mlInsights.latestPicksWeightSum !== null) {
          addCheck(result, "ml-picks-weight-sum", Math.abs(mlInsights.latestPicksWeightSum - 100) < 3,
            `ML latest picks weight sum: ${mlInsights.latestPicksWeightSum?.toFixed(2)}%`)
        } else {
          addCheck(result, "ml-picks-present", false, "ML latest picks weight sum not readable")
        }

        addCheck(result, "ml-train-window-present", mlInsights.trainWindow !== null,
          mlInsights.trainWindow ? `Train window: ${mlInsights.trainWindow}` : "Train window missing")
        addCheck(result, "ml-rebalances-present", mlInsights.rebalancesCount !== null,
          mlInsights.rebalancesCount ? `Rebalances: ${mlInsights.rebalancesCount}` : "Rebalances count missing")
      }

      // ── T16: Tearsheet encoding ───────────────────────────────────────────
      const kpis = await detailPage.readKPIs()
      result.uiCagr = kpis.cagr
      result.uiSharpe = kpis.sharpe

      const reportPath = await detailPage.downloadTearsheet(finalRunId)
      if (!reportPath) {
        addCheck(result, "tearsheet-downloaded", false, "Tearsheet download failed for ml_lightgbm")
      } else {
        result.reportFilename = require("path").basename(reportPath)
        addCheck(result, "tearsheet-downloaded", true, `Tearsheet saved: ${result.reportFilename}`)

        const reportHtml = fs.readFileSync(reportPath, "utf-8")
        const parsed = parseReportHtml(reportHtml)
        result.reportCagr = parsed.cagr
        result.reportSharpe = parsed.sharpe

        const encCheck = checkEncoding("ml_lightgbm tearsheet raw HTML", reportHtml.slice(0, 100_000))
        addCheck(result, "tearsheet-encoding-t16", encCheck.passed, encCheck.message)

        const encMetaCheck = checkEncoding("ml_lightgbm tearsheet meta", parsed.rawTextSnippet)
        addCheck(result, "tearsheet-encoding-meta-t16", encMetaCheck.passed, encMetaCheck.message)

        const badPatterns = [
          { pattern: /\u00e2\u0080\u0093/g, name: "mojibake-em-dash (for \u2014)" },
          { pattern: /\u00c3\u00d7/g, name: "mojibake-times (for \u00d7)" },
          { pattern: /\u00c3\u00b7/g, name: "mojibake-divide (for \u00f7)" },
        ]
        let foundMojibake = false
        for (const { pattern, name } of badPatterns) {
          if (pattern.test(reportHtml)) {
            foundMojibake = true
            addCheck(result, `no-mojibake-${name}`, false, `Tearsheet contains mojibake: ${name}`)
          }
        }
        if (!foundMojibake) {
          addCheck(result, "no-common-mojibake", true, "No mojibake patterns in ml_lightgbm tearsheet")
        }

        for (const err of parsed.parseErrors) {
          if (!err.toLowerCase().includes("optional") && !err.toLowerCase().includes("backfill")) {
            addCheck(result, `tearsheet-parse-error`, false, err)
          }
        }

        const reportKpiChecks = runAllKpiChecks({
          cagr: parsed.cagr, sharpe: parsed.sharpe, maxDrawdown: parsed.maxDrawdown,
          volatility: parsed.volatility, winRate: parsed.winRate, profitFactor: parsed.profitFactor,
          turnover: parsed.turnover, calmar: parsed.calmar,
        })
        for (const c of reportKpiChecks) {
          addCheck(result, `report-kpi-sanity:${c.message.split(":")[0]}`, c.passed, `[lgbm report] ${c.message}`)
        }
      }

      const holdings = await detailPage.readHoldings()
      result.holdingsWeightSum = holdings.weightSum
      result.holdingsCount = holdings.count
      const hCheck = checkHoldingsWeightSum(holdings.weightSum, holdings.count)
      addCheck(result, "holdings-weight-sum", hCheck.passed, hCheck.message)

    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

})
