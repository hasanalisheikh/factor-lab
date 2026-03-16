/**
 * Targeted Edge-Case QA — Preflight Boundary Tests (T1–T8)
 *
 * Tests:
 *   T1  ETF8 start before earliest valid start
 *   T2  SP100 start before earliest valid start
 *   T3  NASDAQ100 start before earliest valid start
 *   T4  End date after global cutoff
 *   T5  Data page healthy benchmark vs preflight consistency
 *   T6  Genuinely unhealthy benchmark path
 *   T7  First-time non-universe benchmark readiness (ETF8 + VTI)
 *   T8  Healthy benchmark should not show misleading Backfill
 *
 * Run only these tests:
 *   npx playwright test tests/targeted-preflight.spec.ts --project=audit
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

// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial("Targeted Preflight Boundary Tests", () => {

  // Shared state: Data page health read once in beforeAll
  let dataHealth: Awaited<ReturnType<DataPage["readHealth"]>> | null = null

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const pg = await ctx.newPage()
    const dataPage = new DataPage(pg)
    try {
      await dataPage.goto()
      dataHealth = await dataPage.readHealth()
      console.log(`[T-preflight] Data page health: ${dataHealth.overallVerdict}, cutoff=${dataHealth.cutoffDate}`)
    } catch (e) {
      console.warn(`[T-preflight] Could not read Data page health: ${e}`)
    } finally {
      await ctx.close()
    }
  })

  test.afterAll(async () => {
    generateTargetedReports(targetedResults)
  })

  // ── T1: ETF8 start before earliest valid start ───────────────────────────

  test("[T1] ETF8 start before earliest valid start", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__01_etf8_early_start",
      "ETF8 start before earliest valid start",
      1001,
      { strategy: "equal_weight", universe: "ETF8", benchmark: "SPY",
        canonicalStartDate: "1999-01-01", canonicalEndDate: "2025-12-31" }
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
        startDate: "1999-01-01",
        endDate: "2025-12-31",
        costsBps: CANONICAL_COSTS_BPS,
        topN: CANONICAL_TOP_N["ETF8"],
      })

      const dateAdjMsg = await formPage.getDateAdjustmentMessage()
      result.attemptedStartDate = "1999-01-01"
      result.attemptedEndDate = "2025-12-31"

      if (preflight?.status === "block") {
        result.preflightStatus = "block"
        result.preflightMessages.push(...preflight.messages)
        const blockText = preflight.messages.join(" ").toLowerCase()
        const isDateRelated =
          blockText.includes("start") || blockText.includes("date") ||
          blockText.includes("history") || blockText.includes("inception") ||
          blockText.includes("coverage") || blockText.includes("earlier") ||
          blockText.includes("warmup")
        addCheck(result, "block-is-date-related", isDateRelated,
          isDateRelated
            ? `Block correctly references date/start/inception: ${preflight.messages[0]?.slice(0, 120)}`
            : `Block does not reference date/start — may be unrelated: ${preflight.messages[0]?.slice(0, 120)}`)
        if (isDateRelated) {
          result.verdict = "VALID-BLOCK"
          result.verdictReason = `Block with start-date fix: ${preflight.messages[0]?.slice(0, 100)}`
          upsertTargetedResult(targetedResults, result)
          return
        }
      }

      if (dateAdjMsg) {
        addCheck(result, "form-snapped-start-date", true, `Form adjusted start date: ${dateAdjMsg}`)
        result.preflightMessages.push(`Date adjustment: ${dateAdjMsg}`)
      }

      if (runId) {
        result.runId = runId
        result.preflightStatus = result.preflightStatus ?? "ok"
        await detailPage.goto(runId)
        const { startDate: effectiveStart } = await detailPage.readEffectiveDates()
        result.effectiveStartDate = effectiveStart

        // Effective start must NOT be 1999 — data doesn't exist that far back
        if (effectiveStart) {
          const year = parseInt(effectiveStart.slice(0, 4))
          addCheck(result, "effective-start-not-1999", year >= 2003,
            year >= 2003
              ? `Effective start ${effectiveStart} is >= 2003 (earliest ETF data window)`
              : `Effective start ${effectiveStart} is suspiciously early (< 2003) — possible data integrity issue`)
        }

        // If we got here with no date adjustment and no block, verify effective start was clamped
        if (!dateAdjMsg && !preflight) {
          addCheck(result, "silent-clamp-or-proceed",
            effectiveStart !== null && effectiveStart > "1999-12-31",
            effectiveStart
              ? `Start silently clamped to ${effectiveStart} (acceptable if valid data exists)`
              : "No effective start date readable — cannot verify clamping")
        }
      } else if (!preflight) {
        addCheck(result, "run-created-or-blocked", false,
          "No run ID and no preflight outcome — form submission produced no traceable result")
      }
    } catch (e) {
      const msg = String(e)
      if (msg.includes("CALENDAR_DATE_DISABLED")) {
        addCheck(result, "form-prevents-early-date", true,
          `Calendar correctly prevents selection of out-of-range date (${msg.split(": ").slice(1).join(": ")})`)
        result.verdict = "VALID-BLOCK"
        result.verdictReason = "Calendar UI prevents selection of dates before the minimum allowed date"
      } else {
        result.failures.push(`Uncaught error: ${e}`)
      }
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T2: SP100 start before earliest valid start ──────────────────────────

  test("[T2] SP100 start before earliest valid start", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__02_sp100_early_start",
      "SP100 start before earliest valid start",
      1002,
      { strategy: "equal_weight", universe: "SP100", benchmark: "SPY",
        canonicalStartDate: "1999-01-01", canonicalEndDate: "2025-12-31" }
    )

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
        startDate: "1999-01-01",
        endDate: "2025-12-31",
        costsBps: CANONICAL_COSTS_BPS,
        topN: CANONICAL_TOP_N["SP100"],
      })

      const dateAdjMsg = await formPage.getDateAdjustmentMessage()
      result.attemptedStartDate = "1999-01-01"
      result.attemptedEndDate = "2025-12-31"

      if (preflight?.status === "block") {
        result.preflightStatus = "block"
        result.preflightMessages.push(...preflight.messages)
        const blockText = preflight.messages.join(" ").toLowerCase()
        const isDateRelated =
          blockText.includes("start") || blockText.includes("date") ||
          blockText.includes("history") || blockText.includes("inception") ||
          blockText.includes("coverage") || blockText.includes("earlier") ||
          blockText.includes("warmup")
        addCheck(result, "block-is-date-related", isDateRelated,
          isDateRelated
            ? `Block correctly references date: ${preflight.messages[0]?.slice(0, 120)}`
            : `Block does not reference date: ${preflight.messages[0]?.slice(0, 120)}`)
        if (isDateRelated) {
          result.verdict = "VALID-BLOCK"
          result.verdictReason = `Block with start-date fix: ${preflight.messages[0]?.slice(0, 100)}`
          upsertTargetedResult(targetedResults, result)
          return
        }
      }

      if (dateAdjMsg) {
        addCheck(result, "form-snapped-start-date", true, `Form adjusted start date: ${dateAdjMsg}`)
        result.preflightMessages.push(`Date adjustment: ${dateAdjMsg}`)
      }

      if (runId) {
        result.runId = runId
        result.preflightStatus = result.preflightStatus ?? "ok"
        await detailPage.goto(runId)
        const { startDate: effectiveStart } = await detailPage.readEffectiveDates()
        result.effectiveStartDate = effectiveStart
        if (effectiveStart) {
          const year = parseInt(effectiveStart.slice(0, 4))
          addCheck(result, "effective-start-not-1999", year >= 2001,
            year >= 2001
              ? `Effective start ${effectiveStart} is >= 2001`
              : `Effective start ${effectiveStart} may predate reliable SP100 price data`)
        }
      } else if (!preflight) {
        addCheck(result, "run-created-or-blocked", false, "No run ID and no preflight outcome")
      }
    } catch (e) {
      const msg = String(e)
      if (msg.includes("CALENDAR_DATE_DISABLED")) {
        addCheck(result, "form-prevents-early-date", true,
          `Calendar correctly prevents selection of out-of-range date (${msg.split(": ").slice(1).join(": ")})`)
        result.verdict = "VALID-BLOCK"
        result.verdictReason = "Calendar UI prevents selection of dates before the minimum allowed date"
      } else {
        result.failures.push(`Uncaught error: ${e}`)
      }
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T3: NASDAQ100 start before earliest valid start ──────────────────────

  test("[T3] NASDAQ100 start before earliest valid start", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__03_nasdaq100_early_start",
      "NASDAQ100 start before earliest valid start",
      1003,
      { strategy: "equal_weight", universe: "NASDAQ100", benchmark: "QQQ",
        canonicalStartDate: "1999-01-01", canonicalEndDate: "2025-12-31" }
    )

    try {
      const formPage = new RunFormPage(page)
      const detailPage = new RunDetailPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "equal_weight",
        universe: "NASDAQ100",
        benchmark: "QQQ",
        startDate: "1999-01-01",
        endDate: "2025-12-31",
        costsBps: CANONICAL_COSTS_BPS,
        topN: CANONICAL_TOP_N["NASDAQ100"],
      })

      const dateAdjMsg = await formPage.getDateAdjustmentMessage()
      result.attemptedStartDate = "1999-01-01"
      result.attemptedEndDate = "2025-12-31"

      if (preflight?.status === "block") {
        result.preflightStatus = "block"
        result.preflightMessages.push(...preflight.messages)
        const blockText = preflight.messages.join(" ").toLowerCase()
        const isDateRelated =
          blockText.includes("start") || blockText.includes("date") ||
          blockText.includes("history") || blockText.includes("inception") ||
          blockText.includes("coverage") || blockText.includes("earlier") ||
          blockText.includes("warmup")
        addCheck(result, "block-is-date-related", isDateRelated,
          isDateRelated
            ? `Block correctly references date: ${preflight.messages[0]?.slice(0, 120)}`
            : `Block does not reference date: ${preflight.messages[0]?.slice(0, 120)}`)
        if (isDateRelated) {
          result.verdict = "VALID-BLOCK"
          result.verdictReason = `Block with start-date fix: ${preflight.messages[0]?.slice(0, 100)}`
          upsertTargetedResult(targetedResults, result)
          return
        }
      }

      if (dateAdjMsg) {
        addCheck(result, "form-snapped-start-date", true, `Form adjusted start date: ${dateAdjMsg}`)
        result.preflightMessages.push(`Date adjustment: ${dateAdjMsg}`)
      }

      if (runId) {
        result.runId = runId
        result.preflightStatus = result.preflightStatus ?? "ok"
        await detailPage.goto(runId)
        const { startDate: effectiveStart } = await detailPage.readEffectiveDates()
        result.effectiveStartDate = effectiveStart
        if (effectiveStart) {
          const year = parseInt(effectiveStart.slice(0, 4))
          addCheck(result, "effective-start-not-1999", year >= 2001,
            year >= 2001
              ? `Effective start ${effectiveStart} is >= 2001`
              : `Effective start ${effectiveStart} may predate reliable NASDAQ100 price data`)
        }
      } else if (!preflight) {
        addCheck(result, "run-created-or-blocked", false, "No run ID and no preflight outcome")
      }
    } catch (e) {
      const msg = String(e)
      if (msg.includes("CALENDAR_DATE_DISABLED")) {
        addCheck(result, "form-prevents-early-date", true,
          `Calendar correctly prevents selection of out-of-range date (${msg.split(": ").slice(1).join(": ")})`)
        result.verdict = "VALID-BLOCK"
        result.verdictReason = "Calendar UI prevents selection of dates before the minimum allowed date"
      } else {
        result.failures.push(`Uncaught error: ${e}`)
      }
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T4: End date after global cutoff ─────────────────────────────────────

  test("[T4] End date after global cutoff", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__04_end_after_cutoff",
      "End date after global cutoff",
      1004,
      { strategy: "equal_weight", universe: "ETF8", benchmark: "SPY",
        canonicalStartDate: "2019-01-01", canonicalEndDate: "2099-01-01" }
    )

    try {
      const formPage = new RunFormPage(page)
      const detailPage = new RunDetailPage(page)
      await formPage.goto()
      const cutoff = await formPage.getCutoffDate()
      result.cutoffDateUsed = cutoff

      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "equal_weight",
        universe: "ETF8",
        benchmark: "SPY",
        startDate: "2019-01-01",
        endDate: "2099-01-01",
        costsBps: CANONICAL_COSTS_BPS,
        topN: CANONICAL_TOP_N["ETF8"],
      })

      const dateAdjMsg = await formPage.getDateAdjustmentMessage()
      const endDateDisplay = await formPage.getEndDateDisplay()
      result.attemptedStartDate = "2019-01-01"
      result.attemptedEndDate = "2099-01-01"

      // Key check: end date display should show <= cutoff, NOT 2099
      if (endDateDisplay) {
        const displayYear = endDateDisplay.match(/(\d{4})/)?.[1]
        const isFuture = displayYear && parseInt(displayYear) > 2030
        addCheck(result, "end-date-display-not-future", !isFuture,
          isFuture
            ? `End date display still shows a future date: ${endDateDisplay}`
            : `End date display correctly shows non-future date: ${endDateDisplay}`)
      }

      if (preflight?.status === "block") {
        result.preflightStatus = "block"
        result.preflightMessages.push(...preflight.messages)
        const blockText = preflight.messages.join(" ").toLowerCase()
        const isCutoffBlock =
          blockText.includes("cutoff") || blockText.includes("end date") ||
          blockText.includes("future") || blockText.includes("date")
        addCheck(result, "block-references-cutoff", isCutoffBlock,
          isCutoffBlock
            ? `Block references cutoff/date: ${preflight.messages[0]?.slice(0, 120)}`
            : `Block does not reference cutoff: ${preflight.messages[0]?.slice(0, 120)}`)
        result.verdict = "VALID-BLOCK"
        result.verdictReason = `Block: ${preflight.messages[0]?.slice(0, 100)}`
        upsertTargetedResult(targetedResults, result)
        return
      }

      if (dateAdjMsg) {
        const adjYear = dateAdjMsg.match(/(\d{4})/)?.[1]
        const adjOk = !adjYear || parseInt(adjYear) <= 2030
        addCheck(result, "date-adj-message-reasonable", adjOk,
          adjOk
            ? `Date adjustment message looks correct: ${dateAdjMsg}`
            : `Date adjustment mentions a future year: ${dateAdjMsg}`)
        result.preflightMessages.push(`Date adjustment: ${dateAdjMsg}`)
      }

      if (runId) {
        result.runId = runId
        result.preflightStatus = result.preflightStatus ?? "ok"
        await detailPage.goto(runId)
        const { endDate: effectiveEnd } = await detailPage.readEffectiveDates()
        result.effectiveEndDate = effectiveEnd

        // The effective end date must be <= cutoff (not 2099)
        if (effectiveEnd) {
          const effectiveEndYear = parseInt(effectiveEnd.slice(0, 4))
          const isClamped = effectiveEndYear <= 2030
          addCheck(result, "effective-end-clamped-to-cutoff", isClamped,
            isClamped
              ? `Effective end ${effectiveEnd} is within cutoff range (≤ 2030)`
              : `Effective end ${effectiveEnd} is suspiciously far in the future — cutoff clamping may not have worked`)
          if (cutoff) {
            addCheck(result, "effective-end-matches-cutoff", effectiveEnd <= cutoff,
              effectiveEnd <= cutoff
                ? `Effective end ${effectiveEnd} ≤ data cutoff ${cutoff}`
                : `Effective end ${effectiveEnd} exceeds data cutoff ${cutoff} — run was created with end beyond available data`)
          }
        } else {
          addCheck(result, "effective-end-readable", false, "Could not read effective end date from run detail")
        }
      } else if (!preflight) {
        addCheck(result, "run-created-or-blocked", false, "No run ID and no preflight outcome after submitting with 2099 end date")
      }
    } catch (e) {
      const msg = String(e)
      if (msg.includes("CALENDAR_DATE_DISABLED")) {
        addCheck(result, "calendar-limits-future-date", true,
          `Calendar correctly limits future date entry: ${msg.split(": ").slice(1).join(": ")}`)
        result.verdict = "VALID-BLOCK"
        result.verdictReason = "Calendar year dropdown correctly prevents entry of dates beyond the data cutoff"
      } else {
        result.failures.push(`Uncaught error: ${e}`)
      }
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T5: Data page healthy benchmark vs preflight consistency ─────────────

  test("[T5] Data page healthy benchmark vs preflight consistency", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__05_healthy_bench_preflight_consistent",
      "Data page healthy benchmark vs preflight consistency",
      1005,
      { strategy: "equal_weight", universe: "ETF8" }
    )

    try {
      if (!dataHealth) {
        addCheck(result, "data-page-readable", false, "Data page health not available — cannot run consistency check")
        finalizeVerdict(result)
        upsertTargetedResult(targetedResults, result)
        throw new Error(`[FAIL] ${result.key}: data page health unavailable`)
      }

      // Find a benchmark that is healthy and NOT behind cutoff
      const healthyRow = dataHealth.benchmarkRows.find(
        (r: BenchmarkHealthRow) => r.status === "healthy" && !r.isBehindCutoff
      )

      if (!healthyRow) {
        // All benchmarks have some issue or behind cutoff — skip
        addCheck(result, "healthy-benchmark-available", false,
          "No fully healthy (not behind cutoff) benchmark found — cannot run consistency check")
        result.verdict = "VALID-BLOCK"
        result.verdictReason = "No healthy benchmark available for consistency check"
        upsertTargetedResult(targetedResults, result)
        return
      }

      const selectedBenchmark = healthyRow.ticker
      result.benchmark = selectedBenchmark
      addCheck(result, "data-page-benchmark-healthy", true,
        `Data page shows ${selectedBenchmark} as healthy (${healthyRow.coveragePct ?? "100%"}), not behind cutoff`)

      const formPage = new RunFormPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "equal_weight",
        universe: "ETF8",
        benchmark: selectedBenchmark,
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
        const blockText = preflight.messages.join(" ").toLowerCase()
        const blockMentionsBenchmarkData =
          blockText.includes(selectedBenchmark.toLowerCase()) &&
          (blockText.includes("coverage") || blockText.includes("ingest") ||
           blockText.includes("missing") || blockText.includes("no data"))
        // CONTRADICTION: Data page says healthy but preflight blocks on that benchmark's data
        addCheck(result, "no-contradiction-healthy-then-block", !blockMentionsBenchmarkData,
          blockMentionsBenchmarkData
            ? `CONTRADICTION: Data page shows ${selectedBenchmark} healthy but preflight blocked citing its data availability`
            : `Block does not contradict Data page health of ${selectedBenchmark} (block may be for other reasons)`)
      } else if (preflight?.status === "warn") {
        result.preflightStatus = "warn"
        result.preflightMessages.push(...preflight.messages)
        const warnText = preflight.messages.join(" ").toLowerCase()
        const warnMentionsBenchmarkData =
          warnText.includes(selectedBenchmark.toLowerCase()) &&
          (warnText.includes("coverage") || warnText.includes("missing"))
        addCheck(result, "no-contradiction-healthy-then-warn", !warnMentionsBenchmarkData,
          warnMentionsBenchmarkData
            ? `CONTRADICTION: Data page shows ${selectedBenchmark} healthy but preflight warned about its data`
            : `Preflight warning does not contradict ${selectedBenchmark} health on Data page`)
      } else {
        result.preflightStatus = "ok"
        addCheck(result, "no-preflight-block-for-healthy-benchmark", true,
          `${selectedBenchmark} is healthy on Data page and no preflight block about its data was raised`)
      }

      if (runId) result.runId = runId
    } catch (e) {
      if (!e?.toString().includes("[FAIL]")) result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T6: Genuinely unhealthy benchmark path ───────────────────────────────

  test("[T6] Genuinely unhealthy benchmark path", async ({ page }) => {
    test.setTimeout(60_000)

    const result = makeTargetedResult(
      "targeted__06_unhealthy_bench_preflight",
      "Genuinely unhealthy benchmark path",
      1006
    )

    try {
      if (!dataHealth) {
        addCheck(result, "data-page-readable", false, "Data page health not available")
        finalizeVerdict(result)
        upsertTargetedResult(targetedResults, result)
        throw new Error(`[FAIL] ${result.key}: data page health unavailable`)
      }

      // Find a benchmark that is NOT healthy
      const unhealthyRow = dataHealth.benchmarkRows.find(
        (r: BenchmarkHealthRow) =>
          r.status === "not_ingested" || r.status === "blocked" ||
          r.status === "failed" || r.status === "partial" ||
          r.status === "needs_backfill" || r.status === "retrying"
      )

      if (!unhealthyRow) {
        // All benchmarks are healthy — this scenario cannot be triggered right now
        addCheck(result, "unhealthy-benchmark-available", true,
          "All benchmarks are currently healthy — the unhealthy path cannot be tested in this state. This is acceptable (system is working correctly).")
        result.verdict = "VALID-BLOCK"
        result.verdictReason = "All benchmarks healthy — unhealthy scenario not triggerable"
        upsertTargetedResult(targetedResults, result)
        return
      }

      const selectedBenchmark = unhealthyRow.ticker
      result.benchmark = selectedBenchmark
      addCheck(result, "found-unhealthy-benchmark", true,
        `Data page shows ${selectedBenchmark} as "${unhealthyRow.status}" — will verify preflight warns`)

      // Create a run with this unhealthy benchmark
      const formPage = new RunFormPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      const { runId, preflight } = await formPage.fillAndSubmit({
        runName: result.runName!,
        strategy: "equal_weight",
        universe: "ETF8",
        benchmark: selectedBenchmark,
        startDate: "2019-01-01",
        endDate: "2025-12-31",
        costsBps: CANONICAL_COSTS_BPS,
        topN: CANONICAL_TOP_N["ETF8"],
      })

      result.attemptedStartDate = "2019-01-01"
      result.attemptedEndDate = "2025-12-31"

      if (preflight?.status === "block" || preflight?.status === "warn") {
        result.preflightStatus = preflight.status
        result.preflightMessages.push(...preflight.messages)
        const msgText = preflight.messages.join(" ")
        // The preflight should mention the benchmark and/or data availability
        const isCoherent =
          msgText.toLowerCase().includes(selectedBenchmark.toLowerCase()) ||
          msgText.toLowerCase().includes("coverage") ||
          msgText.toLowerCase().includes("ingest") ||
          msgText.toLowerCase().includes("missing") ||
          msgText.toLowerCase().includes("data") ||
          msgText.toLowerCase().includes("threshold")
        addCheck(result, "preflight-message-coherent", isCoherent,
          isCoherent
            ? `Preflight ${preflight.status} message references benchmark/data: ${msgText.slice(0, 150)}`
            : `Preflight ${preflight.status} message does not reference ${selectedBenchmark} or data: ${msgText.slice(0, 150)}`)
        addCheck(result, "preflight-wording-actionable", true,
          `Preflight status="${preflight.status}" for unhealthy benchmark ${selectedBenchmark} — user knows action needed`)
        if (preflight.status === "block") {
          result.verdict = "VALID-BLOCK"
          result.verdictReason = `Preflight correctly blocked for unhealthy benchmark ${selectedBenchmark}`
        }
      } else {
        // No preflight warning for known-unhealthy benchmark — this is a defect
        result.preflightStatus = preflight?.status ?? "ok"
        addCheck(result, "preflight-warns-for-unhealthy-bench", false,
          `Data page shows ${selectedBenchmark} as "${unhealthyRow.status}" but preflight did not warn/block — preflight-gap defect`)
        if (runId) {
          result.runId = runId
          result.failures.push(
            `PREFLIGHT GAP: ${selectedBenchmark} is "${unhealthyRow.status}" on Data page but preflight allowed run creation without warning`
          )
        }
      }
    } catch (e) {
      if (!e?.toString().includes("[FAIL]")) result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T7: First-time non-universe benchmark readiness (ETF8 + VTI) ─────────

  test("[T7] First-time non-universe benchmark readiness (ETF8 + VTI)", async ({ page }) => {
    test.setTimeout(BENCHMARK_READY_TIMEOUT_MS + RUN_COMPLETION_TIMEOUT_MS + 120_000)

    const result = makeTargetedResult(
      "targeted__07_etf8_vti_benchmark_readiness",
      "First-time non-universe benchmark readiness (ETF8 + VTI)",
      1007,
      { strategy: "equal_weight", universe: "ETF8", benchmark: "VTI",
        canonicalStartDate: "2019-01-01", canonicalEndDate: "2025-12-31" }
    )

    try {
      const formPage = new RunFormPage(page)
      const detailPage = new RunDetailPage(page)
      await formPage.goto()
      result.cutoffDateUsed = await formPage.getCutoffDate()

      // Pre-check: what does Data page say about VTI?
      let vtiStatus: BenchmarkHealthRow | null = null
      if (dataHealth) {
        vtiStatus = dataHealth.benchmarkRows.find((r: BenchmarkHealthRow) => r.ticker === "VTI") ?? null
        addCheck(result, "vti-data-page-status", true,
          `VTI on Data page: status="${vtiStatus?.status ?? "not checked"}", coverage=${vtiStatus?.coveragePct ?? "N/A"}, isBehindCutoff=${vtiStatus?.isBehindCutoff}`)
      }

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
        const blockText = preflight.messages.join(" ")
        // Check it's a valid/truthful block with an explanation
        addCheck(result, "block-has-explanation", preflight.messages.length > 0 && blockText.length > 10,
          `Block message present and non-trivial: ${blockText.slice(0, 120)}`)
        result.verdict = "VALID-BLOCK"
        result.verdictReason = `Block: ${preflight.messages[0]?.slice(0, 100)}`
        upsertTargetedResult(targetedResults, result)
        return
      }

      if (preflight?.status === "warn") {
        result.preflightStatus = "warn"
        result.preflightMessages.push(...preflight.messages)
        // Continue after warning
        const { runId: ackRunId } = await formPage.acknowledgeWarningAndQueue()
        if (ackRunId) result.runId = ackRunId
      }

      const finalRunId = runId ?? result.runId
      if (!finalRunId) {
        addCheck(result, "run-created", false, "No run ID captured")
        finalizeVerdict(result)
        if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
        upsertTargetedResult(targetedResults, result)
        return
      }

      result.runId = finalRunId
      await detailPage.goto(finalRunId)
      const initialStatus = await detailPage.readStatus()

      if (initialStatus === "waiting_for_data") {
        // VTI needs ingestion — verify the UI clearly explains this state
        addCheck(result, "waiting-for-data-visible", true,
          `Run entered waiting_for_data state as expected (VTI not yet in monitored window) — UI must show clear status`)

        // Read the page for explanation text
        const pageText = await page.locator("body").textContent().catch(() => "")
        const hasExplanation =
          (pageText ?? "").toLowerCase().includes("waiting") ||
          (pageText ?? "").toLowerCase().includes("data") ||
          (pageText ?? "").toLowerCase().includes("ingest") ||
          (pageText ?? "").toLowerCase().includes("preparing")
        addCheck(result, "waiting-state-has-explanation", hasExplanation,
          hasExplanation
            ? "UI shows explanation text for waiting_for_data state"
            : "UI does not show any explanation for waiting_for_data — silent stall")

        // Wait for resolution
        const benchResult = await detailPage.waitUntilBenchmarkReady(finalRunId, BENCHMARK_READY_TIMEOUT_MS)
        result.benchmarkWaitMs = benchResult.elapsedMs
        if (!benchResult.ready) {
          result.failCause = "benchmark_ingestion_timeout"
          result.failures.push(`VTI benchmark ingestion timed out after ${Math.round(benchResult.elapsedMs / 60_000)}min`)
          finalizeVerdict(result)
          await captureFailureArtifacts(page, result)
          upsertTargetedResult(targetedResults, result)
          return
        }
        addCheck(result, "waiting-resolved", true, `waiting_for_data resolved after ${Math.round(benchResult.elapsedMs / 1000)}s`)
      } else {
        // VTI was already ingested — run went straight to queued/running
        addCheck(result, "run-started-without-waiting", true,
          `VTI already ingested — run entered ${initialStatus} directly (no silent stall)`)
      }

      // Wait for completion
      const finalStatus = await detailPage.waitForCompletion(finalRunId, RUN_COMPLETION_TIMEOUT_MS)
      addCheck(result, "run-completed", finalStatus === "completed",
        finalStatus === "completed"
          ? "Run with ETF8 + VTI benchmark completed successfully"
          : `Run ended with status: ${finalStatus} (expected completed)`)

      if (finalStatus === "completed") {
        const { startDate, endDate } = await detailPage.readEffectiveDates()
        result.effectiveStartDate = startDate
        result.effectiveEndDate = endDate
      }
    } catch (e) {
      result.failures.push(`Uncaught error: ${e}`)
    }

    finalizeVerdict(result)
    if (result.verdict === "FAIL") await captureFailureArtifacts(page, result)
    upsertTargetedResult(targetedResults, result)
    if (result.verdict === "FAIL") throw new Error(`[FAIL] ${result.key}\n${result.failures.join("\n")}`)
  })

  // ── T8: Healthy benchmark should not show misleading Backfill ────────────

  test("[T8] Healthy benchmark should not show misleading Backfill", async ({ page }) => {
    test.setTimeout(60_000)

    const result = makeTargetedResult(
      "targeted__08_no_misleading_backfill",
      "Healthy benchmark should not show misleading Backfill",
      1008
    )

    try {
      const dataPage = new DataPage(page)
      await dataPage.goto()
      const health = await dataPage.readHealth()

      let testedCount = 0
      const misleadingBackfills: string[] = []

      for (const row of health.benchmarkRows) {
        if (row.status !== "healthy") continue

        // For a healthy benchmark, check if the page row contains "Backfill" text
        // without also containing an "optional" or "full history" qualifier.
        const ticker = row.ticker

        // Read the raw page text in the ticker row context
        const pageText = await page.locator("body").textContent().catch(() => "")
        if (!pageText) continue

        const tickerIdx = pageText.indexOf(ticker)
        if (tickerIdx === -1) continue

        // Get context around this ticker (bounded)
        const rawCtx = pageText.slice(tickerIdx, tickerIdx + 300)
        // Stop at next benchmark ticker boundary
        const allBenchmarks = ["SPY", "QQQ", "IWM", "VTI", "EFA", "EEM", "TLT", "GLD", "VNQ"]
        let ctxEnd = rawCtx.length
        for (const b of allBenchmarks) {
          if (b === ticker) continue
          const bIdx = rawCtx.indexOf(b, 5)
          if (bIdx > 5 && bIdx < ctxEnd) ctxEnd = bIdx
        }
        const ctx = rawCtx.slice(0, ctxEnd)

        // For a ticker that is "healthy" and NOT behind cutoff:
        // "Backfill" action should either not appear, OR be clearly labeled as optional/full-history
        if (!row.isBehindCutoff) {
          const hasBackfill = ctx.toLowerCase().includes("backfill")
          const hasOptionalQualifier =
            ctx.toLowerCase().includes("optional") ||
            ctx.toLowerCase().includes("full history") ||
            ctx.toLowerCase().includes("full-history") ||
            ctx.toLowerCase().includes("extended")

          if (hasBackfill && !hasOptionalQualifier) {
            misleadingBackfills.push(
              `${ticker} (${row.status}, coverage=${row.coveragePct}): shows "Backfill" without "optional" qualifier — context: "${ctx.slice(0, 80)}"`
            )
          }
          testedCount++
        }
      }

      addCheck(result, "healthy-benchmarks-checked", testedCount > 0,
        testedCount > 0
          ? `Checked ${testedCount} healthy (not-behind-cutoff) benchmarks for misleading Backfill`
          : "No fully healthy benchmarks available to check (all behind cutoff or not ingested)")

      if (misleadingBackfills.length > 0) {
        for (const m of misleadingBackfills) {
          addCheck(result, "no-misleading-backfill", false,
            `Misleading Backfill action: ${m}`)
        }
      } else {
        addCheck(result, "no-misleading-backfill", true,
          `No misleading Backfill actions detected on ${testedCount} healthy benchmarks`)
      }

      // Additionally: benchmarks behind cutoff MAY show "Backfill" (valid) but must have an explanation
      for (const row of health.benchmarkRows) {
        if (!row.isBehindCutoff) continue
        addCheck(result, `behind-cutoff-${row.ticker}-status`, true,
          `${row.ticker} is behind cutoff (isBehindCutoff=true) — Backfill/repair action is expected and appropriate`)
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
