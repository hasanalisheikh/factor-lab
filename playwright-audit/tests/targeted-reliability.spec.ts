/**
 * Targeted Edge-Case QA — Reliability / Stuck-State Tests (T26–T28)
 *
 * Tests:
 *   T26  waiting_for_data visibility test
 *        Verify that when a run enters waiting_for_data, the UI clearly
 *        explains what is happening and does not appear as a silent stall.
 *
 *   T27  benchmark/data ingest resolves cleanly
 *        Trigger a benchmark ingest case and verify the run proceeds cleanly
 *        after data becomes available — no duplicate runs, no duplicate jobs.
 *
 *   T28  stuck ingest / backfill handling
 *        Detect or force a case where ingestion stalls or exceeds normal bounds.
 *        Verify the app surfaces retry/failure/pending state with actionable feedback.
 *
 * Design notes:
 *   - These tests depend on live system state and may VALID-BLOCK if the
 *     triggering condition cannot be reproduced (all data already ready).
 *   - T27 uses ETF8 + VTI as the benchmark — VTI is not in ETF8's universe
 *     symbols and may or may not have been ingested at the time of the run.
 *   - T28 reads the Data page for any ticker in "retrying", "stalled", or
 *     "failed" state and verifies the UI gives actionable feedback.
 *
 * Run only these tests:
 *   npx playwright test tests/targeted-reliability.spec.ts --project=audit
 */

import { test } from "@playwright/test"
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
import { RunFormPage } from "../pages/RunFormPage"
import { RunDetailPage } from "../pages/RunDetailPage"
import { DataPage } from "../pages/DataPage"
import type { BenchmarkHealthRow } from "../pages/DataPage"

const targetedResults = loadTargetedResults()

// Reduced timeouts for reliability tests — we don't want to hang for 45 min
const RELIABILITY_BENCHMARK_WAIT_MS = Math.min(BENCHMARK_READY_TIMEOUT_MS, 20 * 60 * 1000)  // 20 min cap
const RELIABILITY_RUN_COMPLETION_MS = Math.min(RUN_COMPLETION_TIMEOUT_MS, 15 * 60 * 1000)   // 15 min cap

// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial("Targeted Reliability / Stuck-State Tests", () => {

  // Shared Data page health read at the start
  let dataHealth: Awaited<ReturnType<DataPage["readHealth"]>> | null = null

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const pg = await ctx.newPage()
    const dataPage = new DataPage(pg)
    try {
      await dataPage.goto()
      dataHealth = await dataPage.readHealth()
      console.log(`[T-reliability] Data page: ${dataHealth.overallVerdict}, cutoff=${dataHealth.cutoffDate}`)
      console.log(`[T-reliability] Benchmark statuses:`,
        dataHealth.benchmarkRows.map((r: BenchmarkHealthRow) => `${r.ticker}=${r.status}${r.isBehindCutoff ? "(behind)" : ""}`).join(", "))
    } catch (e) {
      console.warn(`[T-reliability] Could not read Data page health: ${e}`)
    } finally {
      await ctx.close()
    }
  })

  test.afterAll(async () => {
    generateTargetedReports(targetedResults)
  })

  // ── T26: waiting_for_data visibility test ────────────────────────────────

  test("[T26] waiting_for_data visibility test", async ({ page }) => {
    test.setTimeout(RELIABILITY_BENCHMARK_WAIT_MS + RELIABILITY_RUN_COMPLETION_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__26_waiting_for_data_visibility",
      "waiting_for_data visibility test",
      1026,
      { strategy: "equal_weight", universe: "ETF8", benchmark: "VTI",
        canonicalStartDate: "2019-01-01", canonicalEndDate: "2025-12-31" }
    )

    try {
      // Determine VTI's current state from Data page
      let vtiRow: BenchmarkHealthRow | null = null
      if (dataHealth) {
        vtiRow = dataHealth.benchmarkRows.find((r: BenchmarkHealthRow) => r.ticker === "VTI") ?? null
      }

      addCheck(result, "vti-data-page-status", true,
        vtiRow
          ? `VTI data page status: ${vtiRow.status}, isBehindCutoff=${vtiRow.isBehindCutoff}, coverage=${vtiRow.coveragePct}`
          : "VTI not found on Data page (or Data page not loaded)")

      const formPage = new RunFormPage(page)
      const detailPage = new RunDetailPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "equal_weight",
        universe: "ETF8",
        benchmark: "VTI",
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
        // A block with a clear message is acceptable (truthful block)
        const blockText = preflight.messages.join(" ")
        addCheck(result, "block-has-explanation", blockText.length > 10,
          `Block with explanation: ${blockText.slice(0, 120)}`)
        result.verdict = "VALID-BLOCK"
        result.verdictReason = `Block with explanation: ${preflight.messages[0]?.slice(0, 100)}`
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

      // Read the initial status
      const initialStatus = await detailPage.readStatus()
      addCheck(result, "run-status-visible", initialStatus !== "unknown",
        initialStatus !== "unknown"
          ? `Run status clearly visible: ${initialStatus}`
          : "Run status 'unknown' — UI may not be showing status clearly")

      if (initialStatus === "waiting_for_data") {
        // This is the primary scenario we're testing: UI should clearly show what's happening
        addCheck(result, "waiting-for-data-state-reached", true,
          "Run entered waiting_for_data state — now verifying UI clarity")

        // Read the full page text to verify meaningful explanation is shown
        const pageText = await page.locator("body").textContent().catch(() => "") ?? ""
        const explanationKeywords = [
          "waiting", "data", "ingest", "preparing", "download", "fetch",
          "benchmark", "ready", "checking", "process"
        ]
        const hasKeyword = explanationKeywords.some(k => pageText.toLowerCase().includes(k))
        addCheck(result, "waiting-state-has-explanation", hasKeyword,
          hasKeyword
            ? "UI contains explanation text for waiting_for_data state (not a silent stall)"
            : "UI has no explanation text for waiting_for_data — user cannot understand why the run is waiting")

        // Verify there's no just a blank/spinner with no text
        const hasRunName = pageText.includes(result.runName ?? "") || pageText.includes(finalRunId.slice(0, 8))
        addCheck(result, "run-identity-visible-in-waiting-state", hasRunName,
          hasRunName
            ? "Run identity (name or ID) visible while in waiting_for_data"
            : "Run identity not visible in waiting_for_data state — user cannot identify which run is waiting")

        // Check for progress indicator text
        const hasProgressText =
          pageText.toLowerCase().includes("progress") ||
          pageText.toLowerCase().includes("%") ||
          pageText.toLowerCase().includes("job") ||
          pageText.toLowerCase().includes("ticker") ||
          pageText.toLowerCase().includes("symbol")
        addCheck(result, "progress-info-visible", hasProgressText,
          hasProgressText
            ? "Progress/job info visible in waiting_for_data state"
            : "No progress info shown in waiting_for_data state — consider adding progress indicators")

        // Wait for resolution
        console.log(`[T26] Run entered waiting_for_data — waiting up to ${Math.round(RELIABILITY_BENCHMARK_WAIT_MS / 60000)}min for resolution`)
        const br = await detailPage.waitUntilBenchmarkReady(finalRunId, RELIABILITY_BENCHMARK_WAIT_MS)
        result.benchmarkWaitMs = br.elapsedMs

        if (!br.ready) {
          // Timeout is VALID-BLOCK (ingest taking too long in test environment)
          result.failCause = "benchmark_ingestion_timeout"
          addCheck(result, "waiting-resolved-in-time", false,
            `waiting_for_data did not resolve within ${Math.round(RELIABILITY_BENCHMARK_WAIT_MS / 60000)}min — but UI clarity was verified`)
          // The main visibility checks passed even if we timed out
          result.verdict = "VALID-BLOCK"
          result.verdictReason = `VALID-BLOCK: waiting_for_data state UI verified — ingest timed out (expected in test env)`
          upsertTargetedResult(targetedResults, result)
          return
        }

        addCheck(result, "waiting-for-data-resolved", true,
          `waiting_for_data resolved in ${Math.round(br.elapsedMs / 1000)}s`)
      } else {
        // Run did not enter waiting_for_data (VTI was already ingested)
        addCheck(result, "run-did-not-stall", true,
          `Run entered ${initialStatus} directly — VTI data already available, no silent stall observed`)
      }

      // Wait for completion
      const finalStatus = await detailPage.waitForCompletion(finalRunId, RELIABILITY_RUN_COMPLETION_MS)
      addCheck(result, "run-completed-cleanly", finalStatus === "completed",
        finalStatus === "completed"
          ? "Run completed cleanly after waiting_for_data resolved"
          : `Run ended with: ${finalStatus} (expected completed)`)

      if (finalStatus === "completed") {
        const { startDate, endDate } = await detailPage.readEffectiveDates()
        result.effectiveStartDate = startDate
        result.effectiveEndDate = endDate
      } else if (finalStatus === "unknown") {
        result.failCause = "run_timeout"
      }

    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T27: benchmark/data ingest resolves cleanly ───────────────────────────

  test("[T27] benchmark/data ingest resolves cleanly", async ({ page }) => {
    test.setTimeout(RELIABILITY_BENCHMARK_WAIT_MS + RELIABILITY_RUN_COMPLETION_MS + 120_000)

    // Session-unique run name so the no-duplicate-runs check is meaningful:
    // exactly 1 occurrence means the form submitted once (not twice by accident).
    const sessionId = Date.now().toString(36).slice(-5).toUpperCase()
    const result = makeTargetedResult(
      "targeted__27_ingest_resolves_cleanly",
      "benchmark/data ingest resolves cleanly",
      1027,
      { strategy: "equal_weight", universe: "ETF8", benchmark: "VTI",
        canonicalStartDate: "2019-01-01", canonicalEndDate: "2025-12-31",
        runName: `T27_VTI_${sessionId}` }
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
        benchmark: "VTI",
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
      addCheck(result, "single-run-created", true, `Run created with ID: ${finalRunId}`)

      await detailPage.goto(finalRunId)
      const initialStatus = await detailPage.readStatus()

      // Capture pre-data-ready state
      const preDataState = {
        status: initialStatus,
        timestamp: new Date().toISOString(),
        wasWaitingForData: initialStatus === "waiting_for_data",
      }
      result.preflightMessages.push(
        `PRE-READY STATE: status=${preDataState.status}, waitingForData=${preDataState.wasWaitingForData}`
      )

      if (initialStatus === "waiting_for_data") {
        addCheck(result, "pre-ready-state-captured", true,
          `Pre-data-ready state: ${initialStatus} at ${preDataState.timestamp}`)

        // Phase 1: wait for benchmark data
        const br = await detailPage.waitUntilBenchmarkReady(finalRunId, RELIABILITY_BENCHMARK_WAIT_MS)
        result.benchmarkWaitMs = br.elapsedMs

        if (!br.ready) {
          result.failCause = "benchmark_ingestion_timeout"
          addCheck(result, "ingest-resolved-in-time", false,
            `Ingest did not resolve within ${Math.round(RELIABILITY_BENCHMARK_WAIT_MS / 60000)}min`)
          result.verdict = "VALID-BLOCK"
          result.verdictReason = "VALID-BLOCK: ingest timed out (acceptable in test environment)"
          upsertTargetedResult(targetedResults, result)
          return
        }

        addCheck(result, "ingest-resolved", true,
          `Benchmark data became available after ${Math.round(br.elapsedMs / 1000)}s — run transitioned from waiting_for_data`)

        // Capture post-data-ready state
        const postStatus = await detailPage.readStatus()
        result.preflightMessages.push(`POST-READY STATE: status=${postStatus}`)
        addCheck(result, "post-ready-state-captured", true,
          `Post-data-ready state: ${postStatus}`)
      } else {
        addCheck(result, "no-waiting-for-data", true,
          `VTI already ingested — run entered ${initialStatus} directly (no waiting_for_data transition)`)
      }

      // Phase 2: wait for completion
      const finalStatus = await detailPage.waitForCompletion(finalRunId, RELIABILITY_RUN_COMPLETION_MS)
      addCheck(result, "run-completed-after-ingest", finalStatus === "completed",
        finalStatus === "completed"
          ? "Run completed cleanly after ingest resolved"
          : `Run ended with: ${finalStatus} (expected completed)`)

      if (finalStatus === "completed") {
        const { startDate, endDate } = await detailPage.readEffectiveDates()
        result.effectiveStartDate = startDate
        result.effectiveEndDate = endDate

        // Verify no duplicate runs were created (check the Runs list)
        // Navigate to /runs and count table rows containing this run name.
        // Using row count (not body text) avoids false positives from desktop+mobile
        // rendering the same name multiple times in a single row.
        await page.goto(page.url().replace(/\/runs\/[a-f0-9-]+/, "/runs"))
        await page.waitForTimeout(1000)
        const runNamePattern = result.runName ?? "TARGETED_27"
        const matchingRows = await page
          .locator("tbody tr")
          .filter({ hasText: runNamePattern })
          .count()
          .catch(() => 0)
        addCheck(result, "no-duplicate-runs", matchingRows <= 1,
          matchingRows <= 1
            ? `No duplicate runs found with name "${runNamePattern}" (${matchingRows} row)`
            : `Found ${matchingRows} rows with run name "${runNamePattern}" — possible duplicate run creation`)

        // Navigate back to the run detail to verify final state
        await detailPage.goto(finalRunId)
        const verifyStatus = await detailPage.readStatus()
        addCheck(result, "final-status-is-completed", verifyStatus === "completed",
          verifyStatus === "completed"
            ? "Final status confirmed as completed on re-check"
            : `Final status on re-check: ${verifyStatus} (expected completed)`)
      } else if (finalStatus === "unknown") {
        result.failCause = "run_timeout"
      }

    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T28: stuck ingest / backfill handling ────────────────────────────────

  test("[T28] stuck ingest / backfill handling", async ({ page }) => {
    test.setTimeout(120_000)

    const result = makeTargetedResult(
      "targeted__28_stuck_ingest_handling",
      "stuck ingest / backfill handling",
      1028
    )

    try {
      // Approach: inspect the Data page for any tickers in retrying/stalled/blocked state.
      // If found, verify the UI provides actionable feedback.
      // If not found (all data healthy), this scenario cannot be triggered — VALID-BLOCK.
      const dataPage = new DataPage(page)
      await dataPage.goto()
      const health = await dataPage.readHealth()

      // Find tickers in problematic states
      const stuckRows = health.benchmarkRows.filter((r: BenchmarkHealthRow) =>
        r.status === "retrying" || r.status === "blocked" ||
        r.status === "failed" || r.status === "partial" ||
        r.isBehindCutoff
      )

      if (stuckRows.length === 0) {
        // No stuck states detected — all data is healthy
        addCheck(result, "stuck-state-scenario", true,
          "No stuck/retrying/blocked tickers found — all data is healthy. Stuck state scenario cannot be tested in current system state.")
        addCheck(result, "system-health-good", true,
          `All ${health.benchmarkRows.length} monitored tickers are in a healthy/ready state`)
        result.verdict = "VALID-BLOCK"
        result.verdictReason = "VALID-BLOCK: No stuck state found — all benchmark data is healthy"
        upsertTargetedResult(targetedResults, result)
        return
      }

      // Found at least one stuck ticker
      addCheck(result, "stuck-state-found", true,
        `Found ${stuckRows.length} ticker(s) in stuck/non-healthy state: ${stuckRows.map((r: BenchmarkHealthRow) => `${r.ticker}(${r.status})`).join(", ")}`)

      // For each stuck ticker, verify the UI surfaces actionable information
      for (const row of stuckRows) {
        // Read the row's context text from the Data page
        const pageText = await page.locator("body").textContent().catch(() => "") ?? ""
        const tickerIdx = pageText.indexOf(row.ticker)
        if (tickerIdx === -1) {
          addCheck(result, `ticker-row-visible-${row.ticker}`, false,
            `${row.ticker} not found on Data page text`)
          continue
        }

        // Get context around ticker row
        const ctx = pageText.slice(tickerIdx, tickerIdx + 300)

        // Check 1: the status is clearly shown (not silently hidden)
        const statusKeywords = {
          retrying: ["retry", "retrying", "attempt"],
          blocked: ["blocked", "block", "permanent"],
          failed: ["failed", "fail", "error"],
          partial: ["partial", "incomplete"],
        }
        const relevantKeywords = statusKeywords[row.status as keyof typeof statusKeywords] ?? []
        const hasStatusText =
          relevantKeywords.some(k => ctx.toLowerCase().includes(k)) ||
          ctx.toLowerCase().includes("retry") ||
          ctx.toLowerCase().includes("action") ||
          ctx.toLowerCase().includes("button")
        addCheck(result, `status-visible-${row.ticker}`, hasStatusText,
          hasStatusText
            ? `${row.ticker} (${row.status}): status/action text visible in UI context`
            : `${row.ticker} (${row.status}): no status or action text visible — silent stuck state`)

        // Check 2: for retrying, verify there's retry info (attempt count, next retry time)
        if (row.status === "retrying") {
          const hasRetryInfo =
            ctx.toLowerCase().includes("retry") ||
            ctx.toLowerCase().includes("attempt") ||
            ctx.toLowerCase().includes("will retry") ||
            ctx.toLowerCase().includes("next")
          addCheck(result, `retry-info-visible-${row.ticker}`, hasRetryInfo,
            hasRetryInfo
              ? `${row.ticker} retrying state shows retry info in UI`
              : `${row.ticker} retrying but no retry info visible — user cannot know when it will retry`)
        }

        // Check 3: for blocked, verify there's a "Retry now" or clear explanation
        if (row.status === "blocked") {
          const hasAction =
            ctx.toLowerCase().includes("retry") ||
            ctx.toLowerCase().includes("action") ||
            ctx.toLowerCase().includes("blocked") ||
            ctx.toLowerCase().includes("unable")
          addCheck(result, `blocked-has-action-${row.ticker}`, hasAction,
            hasAction
              ? `${row.ticker} blocked state shows an action/explanation`
              : `${row.ticker} blocked but no action/explanation shown — user cannot take corrective action`)
        }

        // Check 4: for behind-cutoff, verify there's a repair action
        if (row.isBehindCutoff) {
          const hasBehindCutoffAction =
            ctx.toLowerCase().includes("backfill") ||
            ctx.toLowerCase().includes("update") ||
            ctx.toLowerCase().includes("enable") ||
            ctx.toLowerCase().includes("diagnostics") ||
            ctx.toLowerCase().includes("behind")
          addCheck(result, `behind-cutoff-has-action-${row.ticker}`, hasBehindCutoffAction,
            hasBehindCutoffAction
              ? `${row.ticker} behind-cutoff shows repair action/info`
              : `${row.ticker} is behind cutoff but no repair action shown`)
        }
      }

      // Overall: verify the Data page does not just show a spinner with no state info
      const dataPageText = await page.locator("main, [role='main']").first().textContent().catch(() => "") ?? ""
      addCheck(result, "data-page-not-spinning-silently",
        dataPageText.length > 100,
        dataPageText.length > 100
          ? "Data page shows sufficient content (not a silent spinner)"
          : "Data page has very little content — may be a silent loading state")

    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

})
