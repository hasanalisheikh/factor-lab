import type { Page } from "@playwright/test"
import { BASE_URL } from "../audit.config"

// All 9 benchmarks in the matrix — used to bound per-ticker row context
const ALL_BENCHMARKS = ["SPY", "QQQ", "IWM", "VTI", "EFA", "EEM", "TLT", "GLD", "VNQ"]

/**
 * Slice a page-text context so it stops before the next benchmark ticker
 * or 250 chars, whichever comes first. Prevents row-parsing bleed-over.
 */
function boundRowContext(context: string, currentTicker: string): string {
  let end = context.length
  for (const t of ALL_BENCHMARKS) {
    if (t === currentTicker) continue
    const idx = context.indexOf(t, 5) // skip the first few chars (the ticker itself)
    if (idx > 5 && idx < end) end = idx
  }
  return context.slice(0, end)
}

export type BenchmarkHealthRow = {
  ticker: string
  coveragePct: string | null
  status: "healthy" | "needs_backfill" | "not_ingested" | "retrying" | "blocked" | "failed" | "partial" | "unknown"
  /**
   * True when the ticker has data (status="healthy") but its latest price date
   * is behind the monitored window end (i.e. latestDate < windowEnd).
   * The UI shows this ticker as "Healthy" but the backtest preflight will still
   * queue a tail-end ingestion job, putting the run into waiting_for_data.
   * Detected by the presence of the "Enable diagnostics" link in the ticker row
   * — that link only appears when the row has a repair action available.
   */
  isBehindCutoff: boolean
}

export type DataPageHealth = {
  overallVerdict: "GOOD" | "WARNING" | "BLOCKED" | "NO_DATA" | "unknown"
  cutoffDate: string | null
  benchmarkRows: BenchmarkHealthRow[]
  completeness: string | null
  backtestReady: boolean
}

export class DataPage {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(`${BASE_URL}/data`)
    await this.page.waitForSelector('text=/Data Health|Data current/i', { timeout: 30_000 })
  }

  async readHealth(): Promise<DataPageHealth> {
    // Read overall verdict from the health card
    const overallVerdict = await this.readOverallVerdict()
    const cutoffDate = await this.readCutoffDate()
    const completeness = await this.readCompleteness()
    const benchmarkRows = await this.readBenchmarkRows()

    // If completeness is near 100% and there are no blocked rows, backtest-ready
    const hasBlocked = benchmarkRows.some((r) => r.status === "blocked" || r.status === "needs_backfill")
    const backtestReady = overallVerdict === "GOOD" && !hasBlocked

    return { overallVerdict, cutoffDate, benchmarkRows, completeness, backtestReady }
  }

  private async readOverallVerdict(): Promise<DataPageHealth['overallVerdict']> {
    try {
      const verdictEl = this.page.locator('text=/Data Health:/').first()
      const text = await verdictEl.textContent()
      if (!text) return "unknown"
      if (text.includes("GOOD")) return "GOOD"
      if (text.includes("WARNING")) return "WARNING"
      if (text.includes("BLOCKED")) return "BLOCKED"
      if (text.includes("NO_DATA")) return "NO_DATA"
    } catch {}
    return "unknown"
  }

  private async readCutoffDate(): Promise<string | null> {
    try {
      // "Current Through" metric shows the cutoff date
      const el = this.page.locator('text=/Current Through/').locator('..').locator('..')
      const text = await el.textContent()
      const m = text?.match(/(\d{4}-\d{2}-\d{2})/)
      return m?.[1] ?? null
    } catch {}

    try {
      // Alternative: look for a date pattern near "current" text
      const el = this.page.locator('text=/current through/i').first()
      const text = await el.textContent()
      const m = text?.match(/(\d{4}-\d{2}-\d{2})/)
      return m?.[1] ?? null
    } catch {}
    return null
  }

  private async readCompleteness(): Promise<string | null> {
    try {
      const el = this.page.locator('text=/Completeness/').locator('..').locator('..')
      const text = await el.textContent()
      const m = text?.match(/(\d+\.?\d*%?)/)
      return m?.[1] ?? null
    } catch {}
    return null
  }

  private async readBenchmarkRows(): Promise<BenchmarkHealthRow[]> {
    const rows: BenchmarkHealthRow[] = []
    const benchmarks = ["SPY", "QQQ", "IWM", "VTI", "EFA", "EEM", "TLT", "GLD", "VNQ"]

    for (const ticker of benchmarks) {
      const row = await this.readBenchmarkRow(ticker)
      rows.push(row)
    }

    return rows
  }

  async readBenchmarkRow(ticker: string): Promise<BenchmarkHealthRow> {
    try {
      // Strategy: scan the full page text for each row, then parse.
      // The Benchmark Coverage card renders a list where each row contains:
      //   <ticker> <coverage%> <status text>
      // Since the component uses flex rows without stable IDs, we read the
      // card's full text and parse the row for this ticker.
      const pageText = await this.page.locator('body').textContent() ?? ""

      // Check if the ticker appears anywhere at all
      if (!pageText.includes(ticker)) {
        return { ticker, coveragePct: null, status: "not_ingested", isBehindCutoff: false }
      }

      // The coverage % is typically adjacent to the ticker in the page text.
      // Pattern: "SPY100.0%Healthy" or "SPY—Not ingested" or "SPYHealthy"
      // Build a regex that captures coverage% and status near the ticker.
      const rowRe = new RegExp(
        `${ticker}\\s*(\\d{1,3}\\.\\d%?|—)?\\s*(Healthy|Blocked|Retrying|Stalled|Failed|Needs backfill|Not ingested|Partial)?`,
        'i'
      )
      const rowMatch = pageText.match(rowRe)

      let coverageText: string | null = null
      let statusText = ""
      if (rowMatch) {
        coverageText = rowMatch[1]?.trim() ?? null
        statusText = rowMatch[2]?.trim() ?? ""
      }

      // Also scan for status keywords near the ticker in a wider context.
      // Bound the context to end before the next benchmark ticker so we don't
      // accidentally read the next row's data.
      const tickerIdx = pageText.indexOf(ticker)
      const rawContext = pageText.slice(tickerIdx, tickerIdx + 250)
      const context = boundRowContext(rawContext, ticker)

      if (!statusText) {
        if (context.includes("Healthy")) statusText = "Healthy"
        else if (context.includes("Blocked")) statusText = "Blocked"
        else if (context.includes("Retrying")) statusText = "Retrying"
        else if (context.includes("Failed")) statusText = "Failed"
        else if (context.includes("Needs backfill") || context.includes("backfill")) statusText = "Needs backfill"
        else if (context.includes("Not ingested")) statusText = "Not ingested"
        else if (context.includes("Partial")) statusText = "Partial"
      }
      if (!coverageText) {
        const pctMatch = context.match(/(\d{2,3}\.\d%)/)
        coverageText = pctMatch?.[1] ?? null
      }

      let status: BenchmarkHealthRow['status'] = "unknown"
      if (statusText.includes("Healthy")) status = "healthy"
      else if (statusText.includes("Blocked")) status = "blocked"
      else if (statusText.includes("Retrying") || statusText.includes("retrying")) status = "retrying"
      else if (statusText.includes("Failed") || statusText.includes("failed")) status = "failed"
      else if (statusText.includes("Needs backfill") || statusText.includes("backfill")) status = "needs_backfill"
      else if (statusText.includes("Not ingested")) status = "not_ingested"
      else if (statusText.includes("Partial") || statusText.includes("partial")) status = "partial"
      else if (coverageText && coverageText !== "—") status = "healthy"

      // ── isBehindCutoff detection ───────────────────────────────────────────
      // The component renders an "Enable diagnostics" link inside the ticker row
      // whenever there is a repair action available (needsWindowBackfill OR
      // isBehindCutoff OR not_ingested OR failed). For a ticker with status=ok
      // and coverage=100%, only isBehindCutoff (latestDate < windowEnd) can
      // trigger this link. We use that as our proxy.
      const hasEnableDiagnostics = context.includes("Enable diagnostics")
      const coveragePctNum = coverageText && coverageText !== "—" ? parseFloat(coverageText) : null
      const isBehindCutoff =
        hasEnableDiagnostics &&
        status === "healthy" &&
        (coveragePctNum === null || coveragePctNum >= 99.5)

      return {
        ticker,
        coveragePct: coverageText === "—" ? null : coverageText,
        status,
        isBehindCutoff,
      }
    } catch (e) {
      console.warn(`[DataPage] Error reading benchmark row for ${ticker}: ${e}`)
      return { ticker, coveragePct: null, status: "unknown", isBehindCutoff: false }
    }
  }
}
