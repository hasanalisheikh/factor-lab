import * as fs from "fs"
import * as path from "path"
import {
  RESULTS_FILE,
  CSV_FILE,
  MARKDOWN_FILE,
  ARTIFACTS_DIR,
} from "../audit.config"
import type { AuditResult } from "./verdict"

// ── Persistence ───────────────────────────────────────────────────────────

export function loadResults(): Map<string, AuditResult> {
  const map = new Map<string, AuditResult>()
  if (!fs.existsSync(RESULTS_FILE)) return map
  try {
    const raw = fs.readFileSync(RESULTS_FILE, "utf-8")
    const arr: AuditResult[] = JSON.parse(raw)
    for (const r of arr) map.set(r.key, r)
    console.log(`[results] Loaded ${map.size} existing results from ${RESULTS_FILE}`)
  } catch (e) {
    console.warn(`[results] Failed to load existing results: ${e}`)
  }
  return map
}

export function saveResults(results: Map<string, AuditResult>): void {
  fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true })
  const arr = Array.from(results.values()).sort((a, b) => a.index - b.index)
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(arr, null, 2), "utf-8")
}

export function upsertResult(results: Map<string, AuditResult>, result: AuditResult): void {
  results.set(result.key, result)
  saveResults(results)
}

// ── CSV export ────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  "index", "attempt", "strategy", "universe", "benchmark",
  "verdict", "verdictReason", "failCause",
  "firstAttemptVerdict", "benchmarkPendingRunId", "benchmarkWaitMs",
  "runId", "runName",
  "attemptedStartDate", "attemptedEndDate",
  "effectiveStartDate", "effectiveEndDate", "cutoffDateUsed",
  "preflightStatus", "preflightMessages",
  "uiCagr", "uiSharpe", "uiMaxDrawdown", "uiVolatility",
  "uiWinRate", "uiProfitFactor", "uiTurnover", "uiCalmar",
  "reportCagr", "reportSharpe", "reportMaxDrawdown", "reportVolatility",
  "holdingsWeightSum", "holdingsCount", "tradesCount",
  "mlInsightsPresent", "reportFilename",
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

export function exportCsv(results: Map<string, AuditResult>): void {
  fs.mkdirSync(path.dirname(CSV_FILE), { recursive: true })
  const arr = Array.from(results.values()).sort((a, b) => a.index - b.index)
  const rows = [
    CSV_HEADERS.join(","),
    ...arr.map((r) => {
      const row: unknown[] = [
        r.index, r.attempt ?? 1, r.strategy, r.universe, r.benchmark,
        r.verdict, r.verdictReason, r.failCause ?? "",
        r.firstAttemptVerdict ?? "", r.benchmarkPendingRunId ?? "", r.benchmarkWaitMs ?? "",
        r.runId, r.runName,
        r.attemptedStartDate, r.attemptedEndDate,
        r.effectiveStartDate, r.effectiveEndDate, r.cutoffDateUsed,
        r.preflightStatus, r.preflightMessages.join("; "),
        r.uiCagr, r.uiSharpe, r.uiMaxDrawdown, r.uiVolatility,
        r.uiWinRate, r.uiProfitFactor, r.uiTurnover, r.uiCalmar,
        r.reportCagr, r.reportSharpe, r.reportMaxDrawdown, r.reportVolatility,
        r.holdingsWeightSum, r.holdingsCount, r.tradesCount,
        r.mlInsightsPresent, r.reportFilename,
        r.startedAt, r.completedAt, r.runCompletionMs,
        r.failures.length,
      ]
      return row.map(csvEscape).join(",")
    }),
  ]
  fs.writeFileSync(CSV_FILE, rows.join("\n"), "utf-8")
  console.log(`[results] CSV exported to ${CSV_FILE}`)
}

// ── Markdown report ───────────────────────────────────────────────────────

export function exportMarkdown(results: Map<string, AuditResult>): void {
  fs.mkdirSync(path.dirname(MARKDOWN_FILE), { recursive: true })
  const arr = Array.from(results.values()).sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index
    return (a.attempt ?? 1) - (b.attempt ?? 1)
  })

  // Separate attempt-1 and attempt-2 records
  const attempt1 = arr.filter((r) => (r.attempt ?? 1) === 1)
  const attempt2 = arr.filter((r) => r.attempt === 2)

  const passCount = attempt1.filter((r) => r.verdict === "PASS").length
  const blockCount = attempt1.filter((r) => r.verdict === "VALID-BLOCK").length
  const failCount = attempt1.filter((r) => r.verdict === "FAIL").length
  const ingestionFails = attempt1.filter((r) => r.failCause === "benchmark_ingestion_timeout")
  const executedCount = attempt1.filter((r) => r.preflightStatus !== null).length

  const rerunPass = attempt2.filter((r) => r.verdict === "PASS").length
  const rerunFail = attempt2.filter((r) => r.verdict === "FAIL").length

  const lines: string[] = [
    "# FactorLab Live QA Audit Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Planned runs | 162 |`,
    `| Executed (attempt 1) | ${executedCount} |`,
    `| PASS | ${passCount} |`,
    `| VALID-BLOCK | ${blockCount} |`,
    `| FAIL (attempt 1) | ${failCount} |`,
    `| — of which: benchmark ingestion timeout | ${ingestionFails.length} |`,
    `| Rerun attempts (attempt 2) | ${attempt2.length} |`,
    `| — rerun PASS | ${rerunPass} |`,
    `| — rerun FAIL | ${rerunFail} |`,
    `| Remaining | ${162 - executedCount} |`,
    "",
  ]

  // ── Benchmark Ingestion Findings ──────────────────────────────────────────
  if (ingestionFails.length > 0) {
    lines.push("## Benchmark Ingestion Findings", "")
    lines.push(
      "These combos failed on their **first attempt** because the benchmark ticker was not yet ingested",
      "when the run was created (run entered `waiting_for_data` and timed out waiting for benchmark data).",
      "This represents a gap in the preflight system: the UI queues data ingestion transparently,",
      "but does not communicate a realistic ETA to the user. The matrix continues after recording this FAIL.",
      ""
    )
    lines.push("| Combo | First Attempt | Run ID | Wait Time | Rerun Result |")
    lines.push("|-------|---------------|--------|-----------|--------------|")
    for (const r of ingestionFails) {
      const a2 = attempt2.find((x) => x.key === `${r.key}__a2`)
      const rerunCell = a2
        ? `${a2.verdict === "PASS" ? "✅" : "❌"} ${a2.verdict} (run ${a2.runId?.slice(0, 8) ?? "?"}…)`
        : "Not yet retried"
      const waitMin = r.benchmarkWaitMs ? `${Math.round(r.benchmarkWaitMs / 60000)}m` : "—"
      lines.push(
        `| ${r.strategy} × ${r.universe} × ${r.benchmark} | ❌ FAIL (ingestion timeout) | ${r.benchmarkPendingRunId?.slice(0, 8) ?? "—"}… | ${waitMin} | ${rerunCell} |`
      )
    }
    lines.push("")
  }

  // ── Results Table ─────────────────────────────────────────────────────────
  lines.push("## Results Table (Attempt 1)", "")
  lines.push("| # | Strategy | Universe | Benchmark | Effective Period | Cutoff | Verdict | Cause | Reason | Report |")
  lines.push("|---|----------|----------|-----------|------------------|--------|---------|-------|--------|--------|")

  for (const r of attempt1) {
    const verdictEmoji = r.verdict === "PASS" ? "✅" : r.verdict === "VALID-BLOCK" ? "🔶" : "❌"
    const effective = r.effectiveStartDate
      ? `${r.effectiveStartDate} / ${r.effectiveEndDate ?? "?"}`
      : "—"
    const reportLink = r.reportFilename ? `[HTML](${r.reportFilename})` : "—"
    const reason = r.verdictReason.slice(0, 55).replace(/\|/g, "\\|")
    const cause = r.failCause ? `\`${r.failCause}\`` : ""

    lines.push(
      `| ${r.index + 1} | ${r.strategy} | ${r.universe} | ${r.benchmark} | ${effective} | ${r.cutoffDateUsed ?? "—"} | ${verdictEmoji} ${r.verdict} | ${cause} | ${reason} | ${reportLink} |`
    )
  }

  if (attempt2.length > 0) {
    lines.push("", "## Results Table (Attempt 2 — Reruns After Benchmark Readiness)", "")
    lines.push("| Combo | First Attempt Verdict | Rerun Verdict | Run ID | Report |")
    lines.push("|-------|-----------------------|---------------|--------|--------|")
    for (const r of attempt2) {
      const verdictEmoji = r.verdict === "PASS" ? "✅" : "❌"
      const reportLink = r.reportFilename ? `[HTML](${r.reportFilename})` : "—"
      const runIdShort = r.runId ? r.runId.slice(0, 8) + "…" : "—"
      lines.push(
        `| ${r.strategy} × ${r.universe} × ${r.benchmark} | ${r.firstAttemptVerdict ?? "—"} | ${verdictEmoji} ${r.verdict} | ${runIdShort} | ${reportLink} |`
      )
    }
    lines.push("")
  }

  // ── Defects section ────────────────────────────────────────────────────────
  // Show attempt-1 non-ingestion failures and attempt-2 failures separately
  const realFailures = attempt1.filter(
    (r) => r.verdict === "FAIL" && r.failCause !== "benchmark_ingestion_timeout"
  )
  const rerunFailures = attempt2.filter((r) => r.verdict === "FAIL")
  const allDefects = [...realFailures, ...rerunFailures]

  lines.push("", "## Defects", "")
  lines.push(
    "_Benchmark ingestion timeouts are listed in the Benchmark Ingestion Findings section above, not here._",
    ""
  )

  if (allDefects.length === 0) {
    lines.push("No failures detected (excluding benchmark ingestion timeouts).")
  } else {
    const groups: Record<string, AuditResult[]> = {
      "Preflight contradictions": [],
      "KPI / numbers incorrect": [],
      "Config mismatch": [],
      "Chart truncation / wrong date range": [],
      "Holdings / trades errors": [],
      "ML Insights errors": [],
      "Encoding / tearsheet issues": [],
      "Reliability / stuck jobs": [],
      "Missing evidence": [],
      "Other": [],
    }

    for (const r of allDefects) {
      const f = r.verdictReason.toLowerCase()
      if (f.includes("preflight") || f.includes("block")) {
        groups["Preflight contradictions"].push(r)
      } else if (f.includes("kpi") || f.includes("cagr") || f.includes("sharpe") || (f.includes("mismatch") && f.includes("report"))) {
        groups["KPI / numbers incorrect"].push(r)
      } else if (f.includes("config") || f.includes("strategy") || f.includes("benchmark") || f.includes("universe")) {
        groups["Config mismatch"].push(r)
      } else if (f.includes("chart") || f.includes("date range") || f.includes("truncat")) {
        groups["Chart truncation / wrong date range"].push(r)
      } else if (f.includes("holding") || f.includes("trade") || f.includes("weight")) {
        groups["Holdings / trades errors"].push(r)
      } else if (f.includes("ml") || f.includes("feature") || f.includes("insight")) {
        groups["ML Insights errors"].push(r)
      } else if (f.includes("encod") || f.includes("mojibake") || f.includes("tearsheet")) {
        groups["Encoding / tearsheet issues"].push(r)
      } else if (f.includes("timeout") || f.includes("stuck") || f.includes("stall")) {
        groups["Reliability / stuck jobs"].push(r)
      } else if (f.includes("missing") || f.includes("evidence") || f.includes("not started")) {
        groups["Missing evidence"].push(r)
      } else {
        groups["Other"].push(r)
      }
    }

    for (const [group, items] of Object.entries(groups)) {
      if (items.length === 0) continue
      lines.push(`### ${group}`, "")
      for (const r of items) {
        const attemptLabel = r.attempt === 2 ? " [Attempt 2]" : ""
        lines.push(
          `**${r.strategy} × ${r.universe} × ${r.benchmark}**${attemptLabel} (run ${r.index + 1})`,
          "",
          `- **Run ID:** ${r.runId ?? "N/A"}`,
          `- **Fail cause:** ${r.failCause ?? "check_failure"}`,
          `- **Verdict reason:** ${r.verdictReason}`,
          `- **Failures:**`,
          ...r.failures.map((f) => `  - ${f}`),
          ""
        )
      }
    }
  }

  // ── Aggregate by strategy ──────────────────────────────────────────────────
  lines.push("", "## Aggregate by Strategy (Attempt 1)", "")
  lines.push("| Strategy | PASS | VALID-BLOCK | FAIL | Ingestion Timeouts | Total |")
  lines.push("|----------|------|-------------|------|---------------------|-------|")

  const strategies = ["equal_weight", "momentum_12_1", "low_vol", "trend_filter", "ml_ridge", "ml_lightgbm"]
  for (const s of strategies) {
    const subset = attempt1.filter((r) => r.strategy === s)
    const p = subset.filter((r) => r.verdict === "PASS").length
    const vb = subset.filter((r) => r.verdict === "VALID-BLOCK").length
    const f = subset.filter((r) => r.verdict === "FAIL").length
    const it = subset.filter((r) => r.failCause === "benchmark_ingestion_timeout").length
    lines.push(`| ${s} | ${p} | ${vb} | ${f} | ${it} | ${subset.length} |`)
  }

  fs.writeFileSync(MARKDOWN_FILE, lines.join("\n"), "utf-8")
  console.log(`[results] Markdown report exported to ${MARKDOWN_FILE}`)
}

export function generateReports(results?: Map<string, AuditResult>): void {
  const r = results ?? loadResults()
  exportCsv(r)
  exportMarkdown(r)
}
