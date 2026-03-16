/**
 * Utilities for the targeted edge-case QA test suite.
 *
 * Provides: result factory, persistence, artifact capture, CSV/Markdown export.
 * Targeted results are stored separately from the 162-run matrix in
 * artifacts/results/targeted-results.json + targeted-results.csv + targeted-report.md
 */

import * as fs from "fs"
import * as path from "path"
import type { Page } from "@playwright/test"
import {
  TARGETED_RESULTS_FILE,
  TARGETED_CSV_FILE,
  TARGETED_MARKDOWN_FILE,
  SCREENSHOTS_DIR,
  CANONICAL_START_DATE,
  CANONICAL_END_DATE,
} from "../audit.config"
import { makeEmptyResult, finalizeVerdict, type AuditResult } from "./verdict"

// ── Targeted result factory ────────────────────────────────────────────────

/**
 * Build an empty AuditResult tagged as test_type="targeted".
 * Index starts at 1001 to keep targeted results sortable after the 162 matrix runs.
 */
export function makeTargetedResult(
  key: string,
  testName: string,
  index: number,
  overrides: Partial<{
    strategy: string
    universe: string
    benchmark: string
    canonicalStartDate: string
    canonicalEndDate: string
    runName: string
  }> = {}
): AuditResult {
  const result = makeEmptyResult({
    key,
    strategy: overrides.strategy ?? "N/A",
    universe: overrides.universe ?? "N/A",
    benchmark: overrides.benchmark ?? "N/A",
    index,
    canonicalStartDate: overrides.canonicalStartDate ?? CANONICAL_START_DATE,
    canonicalEndDate: overrides.canonicalEndDate ?? CANONICAL_END_DATE,
    runName: overrides.runName ?? `TARGETED_${key.replace(/targeted__/, "")}`,
  })
  result.test_type = "targeted"
  result.testName = testName
  return result
}

// ── Persistence ────────────────────────────────────────────────────────────

export function loadTargetedResults(): Map<string, AuditResult> {
  const map = new Map<string, AuditResult>()
  if (!fs.existsSync(TARGETED_RESULTS_FILE)) return map
  try {
    const arr: AuditResult[] = JSON.parse(fs.readFileSync(TARGETED_RESULTS_FILE, "utf-8"))
    for (const r of arr) map.set(r.key, r)
    console.log(`[targeted] Loaded ${map.size} existing results from ${TARGETED_RESULTS_FILE}`)
  } catch (e) {
    console.warn(`[targeted] Failed to load existing results: ${e}`)
  }
  return map
}

export function saveTargetedResults(results: Map<string, AuditResult>): void {
  fs.mkdirSync(path.dirname(TARGETED_RESULTS_FILE), { recursive: true })
  const arr = Array.from(results.values()).sort((a, b) => a.index - b.index)
  fs.writeFileSync(TARGETED_RESULTS_FILE, JSON.stringify(arr, null, 2), "utf-8")
}

export function upsertTargetedResult(results: Map<string, AuditResult>, result: AuditResult): void {
  results.set(result.key, result)
  saveTargetedResults(results)
}

// ── Artifact capture on failure ────────────────────────────────────────────

export async function captureFailureArtifacts(
  page: Page,
  result: AuditResult
): Promise<void> {
  const screenshotDir = path.resolve(SCREENSHOTS_DIR)
  fs.mkdirSync(screenshotDir, { recursive: true })

  const screenshotPath = path.join(screenshotDir, `${result.key}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})
  result.failures.push(`Screenshot saved: ${screenshotPath}`)

  const artifactPath = path.join(screenshotDir, `${result.key}.fail.json`)
  fs.writeFileSync(
    artifactPath,
    JSON.stringify(
      {
        key: result.key,
        testName: result.testName,
        test_type: result.test_type,
        runId: result.runId,
        verdict: result.verdict,
        failCause: result.failCause,
        verdictReason: result.verdictReason,
        failures: result.failures,
        preflightStatus: result.preflightStatus,
        preflightMessages: result.preflightMessages,
        effectiveDates: { start: result.effectiveStartDate, end: result.effectiveEndDate },
        kpis: {
          cagr: result.uiCagr,
          sharpe: result.uiSharpe,
          maxDrawdown: result.uiMaxDrawdown,
          volatility: result.uiVolatility,
          winRate: result.uiWinRate,
          profitFactor: result.uiProfitFactor,
        },
        tearsheetPath: result.reportFilename ?? null,
        screenshotPath,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  )
}

// ── CSV export ─────────────────────────────────────────────────────────────

const TARGETED_CSV_HEADERS = [
  "index", "key", "testName", "strategy", "universe", "benchmark",
  "verdict", "verdictReason", "failCause",
  "runId", "runName",
  "attemptedStartDate", "attemptedEndDate",
  "effectiveStartDate", "effectiveEndDate",
  "preflightStatus", "preflightMessages",
  "uiCagr", "uiSharpe", "uiMaxDrawdown", "uiVolatility",
  "uiWinRate", "uiProfitFactor", "uiTurnover", "uiCalmar",
  "reportFilename",
  "holdingsWeightSum", "holdingsCount", "tradesCount",
  "mlInsightsPresent",
  "chartStartLabel", "chartEndLabel",
  "startedAt", "completedAt", "runCompletionMs",
  "failureCount",
]

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return ""
  const s = String(val)
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function exportTargetedCsv(results: Map<string, AuditResult>): void {
  fs.mkdirSync(path.dirname(TARGETED_CSV_FILE), { recursive: true })
  const arr = Array.from(results.values()).sort((a, b) => a.index - b.index)
  const rows = [
    TARGETED_CSV_HEADERS.join(","),
    ...arr.map((r) => {
      const row: unknown[] = [
        r.index, r.key, r.testName ?? "", r.strategy, r.universe, r.benchmark,
        r.verdict, r.verdictReason, r.failCause ?? "",
        r.runId ?? "", r.runName ?? "",
        r.attemptedStartDate, r.attemptedEndDate,
        r.effectiveStartDate ?? "", r.effectiveEndDate ?? "",
        r.preflightStatus ?? "", r.preflightMessages.join("; "),
        r.uiCagr ?? "", r.uiSharpe ?? "", r.uiMaxDrawdown ?? "", r.uiVolatility ?? "",
        r.uiWinRate ?? "", r.uiProfitFactor ?? "", r.uiTurnover ?? "", r.uiCalmar ?? "",
        r.reportFilename ?? "",
        r.holdingsWeightSum ?? "", r.holdingsCount ?? "", r.tradesCount ?? "",
        r.mlInsightsPresent ?? "",
        r.chartStartLabel ?? "", r.chartEndLabel ?? "",
        r.startedAt, r.completedAt ?? "", r.runCompletionMs ?? "",
        r.failures.length,
      ]
      return row.map(csvEscape).join(",")
    }),
  ]
  fs.writeFileSync(TARGETED_CSV_FILE, rows.join("\n"), "utf-8")
  console.log(`[targeted] CSV exported to ${TARGETED_CSV_FILE}`)
}

// ── Markdown report ────────────────────────────────────────────────────────

export function exportTargetedMarkdown(results: Map<string, AuditResult>): void {
  fs.mkdirSync(path.dirname(TARGETED_MARKDOWN_FILE), { recursive: true })
  const arr = Array.from(results.values()).sort((a, b) => a.index - b.index)

  const passCount = arr.filter((r) => r.verdict === "PASS").length
  const blockCount = arr.filter((r) => r.verdict === "VALID-BLOCK").length
  const failCount = arr.filter((r) => r.verdict === "FAIL").length

  const lines: string[] = [
    "# FactorLab Targeted Edge-Case QA Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Planned targeted tests | 28 |`,
    `| Executed | ${arr.length} |`,
    `| PASS | ${passCount} |`,
    `| VALID-BLOCK | ${blockCount} |`,
    `| FAIL | ${failCount} |`,
    `| Remaining | ${28 - arr.length} |`,
    "",
    "> **VALID-BLOCK** = preflight or scenario correctly blocked an invalid operation (expected behavior).",
    "",
  ]

  // Group tests by category
  const categories: Record<string, AuditResult[]> = {
    "Preflight Boundary (T1–T8)": [],
    "ML Edge (T9–T16)": [],
    "Chart / Tearsheet Full-Range (T17–T22)": [],
    "Benchmark Overlap / Holdings Truth (T23–T25)": [],
    "Reliability / Stuck-State (T26–T28)": [],
  }

  for (const r of arr) {
    const idx = r.index - 1000
    if (idx >= 1 && idx <= 8) categories["Preflight Boundary (T1–T8)"].push(r)
    else if (idx >= 9 && idx <= 16) categories["ML Edge (T9–T16)"].push(r)
    else if (idx >= 17 && idx <= 22) categories["Chart / Tearsheet Full-Range (T17–T22)"].push(r)
    else if (idx >= 23 && idx <= 25) categories["Benchmark Overlap / Holdings Truth (T23–T25)"].push(r)
    else if (idx >= 26 && idx <= 28) categories["Reliability / Stuck-State (T26–T28)"].push(r)
  }

  for (const [category, items] of Object.entries(categories)) {
    if (items.length === 0) continue
    lines.push(`## ${category}`, "")
    lines.push(
      "| # | Test Name | Strategy | Universe | Benchmark | Verdict | Reason |",
      "|---|-----------|----------|----------|-----------|---------|--------|"
    )
    for (const r of items) {
      const verdictEmoji = r.verdict === "PASS" ? "✅" : r.verdict === "VALID-BLOCK" ? "🔶" : "❌"
      const reason = r.verdictReason.slice(0, 60).replace(/\|/g, "\\|")
      const testIdx = r.index - 1000
      lines.push(
        `| T${testIdx} | ${r.testName ?? r.key} | ${r.strategy} | ${r.universe} | ${r.benchmark} | ${verdictEmoji} ${r.verdict} | ${reason} |`
      )
    }
    lines.push("")
  }

  // Defects section
  const defects = arr.filter((r) => r.verdict === "FAIL")
  lines.push("## Defects", "")
  if (defects.length === 0) {
    lines.push("No targeted test failures.")
  } else {
    for (const r of defects) {
      const testIdx = r.index - 1000
      lines.push(
        `### T${testIdx}: ${r.testName ?? r.key}`,
        "",
        `- **Key:** ${r.key}`,
        `- **Run ID:** ${r.runId ?? "N/A"}`,
        `- **Fail cause:** ${r.failCause ?? "check_failure"}`,
        `- **Verdict reason:** ${r.verdictReason}`,
        `- **Failures:**`,
        ...r.failures.map((f) => `  - ${f}`),
        ""
      )
    }
  }

  // Per-check detail for all tests
  lines.push("## Check Detail", "")
  for (const r of arr) {
    if (r.checks.length === 0) continue
    const testIdx = r.index - 1000
    const verdictEmoji = r.verdict === "PASS" ? "✅" : r.verdict === "VALID-BLOCK" ? "🔶" : "❌"
    lines.push(`### T${testIdx}: ${verdictEmoji} ${r.testName ?? r.key}`, "")
    for (const c of r.checks) {
      lines.push(`- ${c.passed ? "✅" : "❌"} \`${c.name}\`: ${c.detail}`)
    }
    lines.push("")
  }

  fs.writeFileSync(TARGETED_MARKDOWN_FILE, lines.join("\n"), "utf-8")
  console.log(`[targeted] Markdown report exported to ${TARGETED_MARKDOWN_FILE}`)
}

// ── Generate all targeted reports ─────────────────────────────────────────

export function generateTargetedReports(results?: Map<string, AuditResult>): void {
  const r = results ?? loadTargetedResults()
  exportTargetedCsv(r)
  exportTargetedMarkdown(r)
}

// ── Shared run helper ──────────────────────────────────────────────────────

/**
 * Create a run with the given config and wait for it to complete.
 * Returns the AuditResult partially filled with run state after completion.
 * Caller must still call finalizeVerdict().
 */
export async function createAndWaitForRun(
  page: import("@playwright/test").Page,
  config: {
    runName: string
    strategy: string
    universe: string
    benchmark: string
    startDate: string
    endDate: string
    costsBps: number
    topN: number
    benchmarkReadyTimeoutMs?: number
    runCompletionTimeoutMs?: number
  },
  result: AuditResult
): Promise<{ completed: boolean; finalStatus: string }> {
  const { RunFormPage } = await import("../pages/RunFormPage")
  const { RunDetailPage } = await import("../pages/RunDetailPage")
  const {
    BENCHMARK_READY_TIMEOUT_MS,
    RUN_COMPLETION_TIMEOUT_MS,
  } = await import("../audit.config")

  const formPage = new RunFormPage(page)
  const detailPage = new RunDetailPage(page)

  const benchmarkReadyMs = config.benchmarkReadyTimeoutMs ?? BENCHMARK_READY_TIMEOUT_MS
  const runCompletionMs = config.runCompletionTimeoutMs ?? RUN_COMPLETION_TIMEOUT_MS

  await formPage.goto()
  result.cutoffDateUsed = await formPage.getCutoffDate()

  const { runId, preflight } = await formPage.fillAndSubmit({
    runName: config.runName,
    strategy: config.strategy,
    universe: config.universe,
    benchmark: config.benchmark,
    startDate: config.startDate,
    endDate: config.endDate,
    costsBps: config.costsBps,
    topN: config.topN,
  })

  result.attemptedStartDate = config.startDate
  result.attemptedEndDate = config.endDate

  if (preflight) {
    result.preflightStatus = preflight.status
    result.preflightMessages.push(...preflight.messages)

    if (preflight.status === "block") {
      return { completed: false, finalStatus: "blocked_preflight" }
    }
    if (preflight.status === "error") {
      return { completed: false, finalStatus: "form_error" }
    }
    if (preflight.status === "warn") {
      const { runId: ackRunId } = await formPage.acknowledgeWarningAndQueue()
      if (ackRunId) result.runId = ackRunId
    }
  } else {
    result.preflightStatus = "ok"
  }

  const finalRunId = runId ?? result.runId
  if (!finalRunId) {
    return { completed: false, finalStatus: "no_run_id" }
  }
  result.runId = finalRunId

  await detailPage.goto(finalRunId)
  const initialStatus = await detailPage.readStatus()

  if (initialStatus === "waiting_for_data") {
    const benchResult = await detailPage.waitUntilBenchmarkReady(finalRunId, benchmarkReadyMs)
    result.benchmarkWaitMs = benchResult.elapsedMs
    if (!benchResult.ready) {
      result.benchmarkPendingRunId = finalRunId
      result.failCause = "benchmark_ingestion_timeout"
      return { completed: false, finalStatus: "waiting_for_data_timeout" }
    }
  }

  const finalStatus = await detailPage.waitForCompletion(finalRunId, runCompletionMs)

  if (finalStatus === "completed") {
    const { startDate, endDate } = await detailPage.readEffectiveDates()
    result.effectiveStartDate = startDate
    result.effectiveEndDate = endDate
  }

  return { completed: finalStatus === "completed", finalStatus }
}
