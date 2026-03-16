import type { Page, Download } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"
import {
  BASE_URL,
  BENCHMARK_READY_TIMEOUT_MS,
  RUN_COMPLETION_TIMEOUT_MS,
  RUN_POLL_INTERVAL_MS,
  REPORTS_DIR,
  ML_STRATEGIES,
  type StrategyId,
} from "../audit.config"

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "waiting_for_data"
  | "unknown"

export type KPIs = {
  cagr: string | null
  sharpe: string | null
  maxDrawdown: string | null
  volatility: string | null
  winRate: string | null
  profitFactor: string | null
  turnover: string | null
  calmar: string | null
}

export type RunConfig = {
  strategy: string | null
  universe: string | null
  benchmark: string | null
  period: string | null
  costs: string | null
  rebalance: string | null
  construction: string | null
  topN: string | null
  cutoffDate: string | null
}

export type HoldingsData = {
  count: number
  weightSum: number
  positions: { symbol: string; weight: number }[]
}

export type TradesData = {
  rebalanceCount: number
}

export type MLInsightsData = {
  featureImportancePresent: boolean
  latestPicksWeightSum: number | null
  latestPicksCount: number | null
  trainWindow: string | null
  rebalancesCount: string | null
  modelDetails: Record<string, string>
}

export class RunDetailPage {
  constructor(private page: Page) {}

  async goto(runId: string): Promise<void> {
    await this.page.goto(`${BASE_URL}/runs/${runId}`)
    await this.page.waitForSelector('[role="tab"]', { timeout: 30_000 })
  }

  /**
   * Phase 1: Wait until the run leaves `waiting_for_data` (benchmark ingestion complete).
   * Returns { ready: true } once status is anything other than waiting_for_data.
   * Returns { ready: false } if the timeout elapses while still waiting.
   */
  async waitUntilBenchmarkReady(
    runId: string,
    timeoutMs: number = BENCHMARK_READY_TIMEOUT_MS
  ): Promise<{ ready: boolean; elapsedMs: number; finalStatus: RunStatus }> {
    const startMs = Date.now()

    while (Date.now() - startMs < timeoutMs) {
      const status = await this.readStatus()
      if (status !== 'waiting_for_data') {
        return { ready: true, elapsedMs: Date.now() - startMs, finalStatus: status }
      }
      const elapsed = Math.round((Date.now() - startMs) / 1000)
      console.log(`[RunDetail] run=${runId} waiting_for_data (benchmark ingestion) — ${elapsed}s elapsed`)
      await this.page.waitForTimeout(RUN_POLL_INTERVAL_MS)
      await this.page.reload()
      await this.page.waitForSelector('[role="tab"]', { timeout: 30_000 })
    }

    return { ready: false, elapsedMs: Date.now() - startMs, finalStatus: 'waiting_for_data' }
  }

  /**
   * Phase 2: Wait for the run to reach a terminal status (completed/failed/blocked).
   * Assumes the run has already left waiting_for_data. Pass an explicit timeoutMs
   * to decouple this from the benchmark-readiness phase.
   */
  async waitForCompletion(
    runId: string,
    timeoutMs: number = RUN_COMPLETION_TIMEOUT_MS
  ): Promise<RunStatus> {
    const startMs = Date.now()

    while (Date.now() - startMs < timeoutMs) {
      const status = await this.readStatus()
      if (status === 'completed' || status === 'failed' || status === 'blocked') {
        return status
      }
      console.log(`[RunDetail] run=${runId} status=${status} (${Math.round((Date.now() - startMs) / 1000)}s elapsed)`)

      // Reload the page to get fresh status (SSR page)
      await this.page.waitForTimeout(RUN_POLL_INTERVAL_MS)
      await this.page.reload()
      await this.page.waitForSelector('[role="tab"]', { timeout: 30_000 })
    }

    return 'unknown'
  }

  async readStatus(): Promise<RunStatus> {
    // Status badges have predictable text
    const statusEl = this.page.locator(
      '[class*="badge"], [class*="StatusBadge"], span'
    ).filter({
      hasText: /^(queued|running|completed|failed|blocked|Waiting for Data|waiting_for_data)$/i,
    }).first()

    try {
      const text = await statusEl.textContent({ timeout: 5_000 })
      const lower = text?.toLowerCase().trim() ?? ""
      if (lower.includes("completed")) return "completed"
      if (lower.includes("running")) return "running"
      if (lower.includes("failed")) return "failed"
      if (lower.includes("blocked")) return "blocked"
      if (lower.includes("waiting")) return "waiting_for_data"
      if (lower.includes("queued")) return "queued"
    } catch {
      // fallback: check page title/heading for status cues
    }

    // Try reading status from the page title/heading area
    const heading = await this.page.locator('h1, h2').first().textContent().catch(() => "")
    if (!heading) return "unknown"

    return "unknown"
  }

  async readKPIs(): Promise<KPIs> {
    // KPI labels and their display text:
    // "CAGR", "Sharpe", "Max Drawdown" (label includes "(peak-to-trough)"),
    // "Volatility", "Win Rate", "Profit Factor", "Turnover (Ann.)", "Calmar"
    async function readKpi(page: Page, labelPattern: RegExp | string): Promise<string | null> {
      // Each KPI card: <CardContent class="p-3.5"><div class="text-[10px]...">LABEL</div><div class="text-lg...">VALUE</div></CardContent>
      try {
        const cards = page.locator('[class*="p-3.5"]')
        const count = await cards.count()
        for (let i = 0; i < count; i++) {
          const card = cards.nth(i)
          const labelText = await card.locator('div').first().textContent()
          if (!labelText) continue
          const matches = typeof labelPattern === 'string'
            ? labelText.includes(labelPattern)
            : labelPattern.test(labelText)
          if (matches) {
            const valueDivs = card.locator('div')
            const valueText = await valueDivs.nth(1).textContent()
            return valueText?.trim() ?? null
          }
        }
      } catch {}
      return null
    }

    // Alternative: look for text content pattern "LABEL" followed by a value
    // The overview-tab renders KPIs in a grid, each as:
    // <div class="bg-card border-border"><CardContent class="p-3.5">
    //   <div class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">CAGR</div>
    //   <div class="text-lg font-semibold font-mono leading-none">12.3%</div>
    // </CardContent></div>

    const kpiGrid = this.page.locator('[class*="grid-cols-2"][class*="gap-3"], [class*="grid-cols-4"][class*="gap-3"]').first()

    async function extractKpiFromGrid(page: Page, labelText: string): Promise<string | null> {
      try {
        // Find the card that contains a div with the label text
        const cards = page.locator('[class*="p-3"]')
        const count = await cards.count()
        for (let i = 0; i < count; i++) {
          const card = cards.nth(i)
          const fullText = await card.textContent()
          if (!fullText?.toLowerCase().includes(labelText.toLowerCase())) continue
          // The value is the last meaningful text in the card
          const divs = card.locator('div')
          const divCount = await divs.count()
          for (let j = divCount - 1; j >= 0; j--) {
            const t = await divs.nth(j).textContent()
            if (t && t.trim() !== '' && !t.toLowerCase().includes(labelText.toLowerCase())) {
              return t.trim()
            }
          }
        }
      } catch {}
      return null
    }

    // Use text-based extraction
    const cagr = await this.extractKpiByLabel('CAGR')
    const sharpe = await this.extractKpiByLabel('Sharpe')
    const maxDrawdown = await this.extractKpiByLabel('Max Drawdown')
    const volatility = await this.extractKpiByLabel('Volatility')
    const winRate = await this.extractKpiByLabel('Win Rate')
    const profitFactor = await this.extractKpiByLabel('Profit Factor')
    const turnover = await this.extractKpiByLabel('Turnover')
    const calmar = await this.extractKpiByLabel('Calmar')

    return { cagr, sharpe, maxDrawdown, volatility, winRate, profitFactor, turnover, calmar }
  }

  private async extractKpiByLabel(label: string): Promise<string | null> {
    // Find all elements with "uppercase tracking-wider" (KPI labels)
    // Then get their sibling value element
    try {
      const labelEl = this.page.locator(
        '[class*="uppercase"][class*="tracking"]'
      ).filter({ hasText: new RegExp(label, 'i') }).first()

      const exists = await labelEl.count() > 0
      if (!exists) return null

      // The value is the next sibling div (font-mono)
      const parent = labelEl.locator('..')
      const valueDivs = parent.locator('[class*="font-mono"], [class*="font-semibold"]')
      const valueCount = await valueDivs.count()
      if (valueCount > 0) {
        return await valueDivs.first().textContent().then((t) => t?.trim() ?? null)
      }
    } catch {}
    return null
  }

  async readRunConfig(): Promise<RunConfig> {
    async function readField(page: Page, fieldLabel: string): Promise<string | null> {
      try {
        // Config grid: label in text-[10px] uppercase, value in text-foreground/90
        const labelEl = page.locator('[class*="uppercase"][class*="tracking"]')
          .filter({ hasText: new RegExp(`^${fieldLabel}$`, 'i') }).first()
        const exists = await labelEl.count() > 0
        if (!exists) return null
        // Value is the next element in the parent
        const parent = labelEl.locator('..')
        const valueEl = parent.locator('[class*="foreground"]').last()
        return await valueEl.textContent().then((t) => t?.trim() ?? null)
      } catch {}
      return null
    }

    const strategy = await readField(this.page, 'Strategy')
    const universe = await readField(this.page, 'Universe')
    const benchmark = await readField(this.page, 'Benchmark')
    const period = await readField(this.page, 'Period')
    const costs = await readField(this.page, 'Costs')
    const rebalance = await readField(this.page, 'Rebalance')
    const construction = await readField(this.page, 'Construction')
    const topN = await readField(this.page, 'Top N')
    const cutoffDate = await readField(this.page, 'Data Cutoff Used')

    // Also try to extract period from the page's date display
    let effectivePeriod = period
    if (!effectivePeriod) {
      // Try getting from the run detail header which may show dates
      const periodText = await this.page.locator('text=/\\d{4}-\\d{2}-\\d{2}.*\\d{4}-\\d{2}-\\d{2}/').first().textContent().catch(() => null)
      effectivePeriod = periodText?.trim() ?? null
    }

    return { strategy, universe, benchmark, period: effectivePeriod, costs, rebalance, construction, topN, cutoffDate }
  }

  async navigateToTab(tabName: 'Overview' | 'Holdings' | 'Trades' | 'ML Insights'): Promise<void> {
    await this.page.locator('[role="tab"]').filter({ hasText: tabName }).first().click()
    await this.page.waitForTimeout(500)
  }

  async readHoldings(): Promise<HoldingsData> {
    await this.navigateToTab('Holdings')
    await this.page.waitForTimeout(300)

    const positions: { symbol: string; weight: number }[] = []

    try {
      // Both baseline and ML holdings use <tbody><tr> table rows.
      // Each data row has: symbol/ticker cell + weight cell ending in '%'.
      // Header rows won't have a weight ending in '%' so they're naturally excluded.
      const rows = this.page.locator('tbody tr')
      const count = await rows.count()

      for (let i = 0; i < count && i < 100; i++) {
        const row = rows.nth(i)
        const cells = row.locator('td')
        const cellCount = await cells.count()
        if (cellCount < 2) continue

        let symbol: string | null = null
        let weight: number | null = null

        for (let j = 0; j < cellCount; j++) {
          const cellText = (await cells.nth(j).textContent() ?? "").trim()

          // Weight: a cell that ends with '%' and is a plausible percentage.
          // Use the FIRST % match per row — ML holdings tables have additional %
          // columns (predictedReturn, realizedReturn) after the weight column;
          // overwriting with the last match gives the wrong (tiny) value.
          if (weight === null && /^\d{1,3}\.\d{2}%$/.test(cellText)) {
            const pct = parseFloat(cellText.replace('%', ''))
            if (!isNaN(pct) && pct > 0 && pct <= 100) {
              weight = pct
            }
          }

          // Symbol: 1–5 uppercase letters, optionally with a hyphen (BRK-B)
          if (/^[A-Z]{1,5}(-[A-Z])?$/.test(cellText)) {
            symbol = cellText
          }
        }

        if (symbol && weight !== null) {
          // Deduplicate (same symbol might appear at different dates in ML holdings)
          const exists = positions.find((p) => p.symbol === symbol)
          if (!exists) positions.push({ symbol, weight })
        }
      }
    } catch (e) {
      console.warn(`[RunDetail] readHoldings error: ${e}`)
    }

    const weightSum = positions.reduce((s, p) => s + p.weight, 0)
    return { count: positions.length, weightSum, positions }
  }

  async readTrades(): Promise<TradesData> {
    await this.navigateToTab('Trades')

    try {
      // The rebalances count is shown as "N rebalances" in font-mono
      const countText = await this.page.locator('[class*="font-mono"]')
        .filter({ hasText: /rebalances?/i })
        .first()
        .textContent()

      if (countText) {
        const m = countText.match(/(\d+)/)
        if (m) return { rebalanceCount: parseInt(m[1]) }
      }
    } catch {}

    return { rebalanceCount: 0 }
  }

  async readMLInsights(): Promise<MLInsightsData> {
    await this.navigateToTab('ML Insights')
    await this.page.waitForTimeout(500)

    // Check if feature importance chart is present
    const featureImportancePresent = await this.page.locator(
      'text=/Feature Importance/i'
    ).count() > 0

    // Latest picks weight sum
    let latestPicksWeightSum: number | null = null
    let latestPicksCount: number | null = null

    try {
      // Each ML pick row renders a weight span with data-testid="ml-pick-weight"
      const weightCells = this.page.locator('[data-testid="ml-pick-weight"]')
      const count = await weightCells.count()
      if (count > 0) {
        let sum = 0
        for (let i = 0; i < count; i++) {
          const text = await weightCells.nth(i).textContent()
          const pct = parseFloat(text?.replace('%', '') ?? '0')
          if (!isNaN(pct) && pct > 0) sum += pct
        }
        latestPicksWeightSum = sum
        latestPicksCount = count
      }
    } catch {}

    // Model details
    const modelDetails: Record<string, string> = {}
    const trainWindow = await this.readModelDetail('Train Window')
    const rebalancesCount = await this.readModelDetail('Rebalances')

    if (trainWindow) modelDetails['trainWindow'] = trainWindow
    if (rebalancesCount) modelDetails['rebalancesCount'] = rebalancesCount

    return {
      featureImportancePresent,
      latestPicksWeightSum,
      latestPicksCount,
      trainWindow,
      rebalancesCount,
      modelDetails,
    }
  }

  private async readModelDetail(label: string): Promise<string | null> {
    try {
      const labelEl = this.page.locator('[class*="text-muted"]').filter({ hasText: new RegExp(`^${label}$`, 'i') }).first()
      if (await labelEl.count() === 0) return null
      const parent = labelEl.locator('..')
      const value = parent.locator('[class*="font-mono"]').first()
      return await value.textContent().then((t) => t?.trim() ?? null)
    } catch {}
    return null
  }

  /**
   * Read the chart date labels from the equity curve section.
   * The chart renders in recharts/SVG — we read the x-axis tick text elements.
   */
  async readChartDateRange(): Promise<{ start: string | null; end: string | null }> {
    await this.navigateToTab('Overview')
    // Give recharts time to render
    await this.page.waitForTimeout(1_000)

    try {
      // Recharts x-axis tick text elements have class "recharts-cartesian-axis-tick-value"
      const ticks = this.page.locator('.recharts-cartesian-axis-tick-value')
      const count = await ticks.count()
      if (count >= 2) {
        const texts: string[] = []
        for (let i = 0; i < count; i++) {
          const t = await ticks.nth(i).textContent()
          if (t?.trim()) texts.push(t.trim())
        }
        if (texts.length >= 2) {
          return { start: texts[0], end: texts[texts.length - 1] }
        }
      }

      // Fallback 1: any SVG <text> inside a recharts container with a 4-digit year
      const svgTexts = this.page.locator('.recharts-wrapper text, .recharts-surface text')
      const svgCount = await svgTexts.count()
      const yearTexts: string[] = []
      for (let i = 0; i < svgCount && i < 50; i++) {
        const t = (await svgTexts.nth(i).textContent() ?? "").trim()
        if (/\d{4}/.test(t)) yearTexts.push(t)
      }
      if (yearTexts.length >= 2) {
        return { start: yearTexts[0], end: yearTexts[yearTexts.length - 1] }
      }
    } catch (e) {
      console.warn(`[RunDetail] readChartDateRange error: ${e}`)
    }

    // Return null — the caller will treat missing labels as a soft warning
    return { start: null, end: null }
  }

  /**
   * Download the tearsheet HTML. Returns the file path where it was saved.
   * Returns null if the download fails or the button is not available.
   */
  async downloadTearsheet(runId: string): Promise<string | null> {
    await this.navigateToTab('Overview')
    await this.page.waitForTimeout(500)

    // Look for "Download Report" link (direct download) or "Generate Report" button
    const downloadLink = this.page.locator('a:has-text("Download Report"), a[download]').first()
    const generateBtn = this.page.locator('button:has-text("Generate Report")').first()

    const hasDownload = await downloadLink.count() > 0
    const hasGenerate = await generateBtn.count() > 0

    if (!hasDownload && !hasGenerate) {
      console.warn(`[RunDetail] No download/generate button found for run ${runId}`)
      return null
    }

    fs.mkdirSync(REPORTS_DIR, { recursive: true })
    const outputPath = path.resolve(REPORTS_DIR, `${runId}.html`)

    if (hasDownload) {
      // Get the href and download it
      const href = await downloadLink.getAttribute('href')
      if (href) {
        try {
          // Open in new tab to trigger download or fetch the URL
          const [download] = await Promise.all([
            this.page.waitForEvent('download', { timeout: 60_000 }),
            downloadLink.click(),
          ])
          await download.saveAs(outputPath)
          console.log(`[RunDetail] Report downloaded to ${outputPath}`)
          return outputPath
        } catch {
          // Fallback: fetch the URL via network
          const response = await this.page.request.get(href)
          if (response.ok()) {
            fs.writeFileSync(outputPath, await response.text(), 'utf-8')
            return outputPath
          }
        }
      }
    }

    if (hasGenerate) {
      // Click Generate Report, wait for the button to change to "Download Report"
      await generateBtn.click()
      try {
        await this.page.waitForSelector('a:has-text("Download Report")', { timeout: 60_000 })
        return await this.downloadTearsheet(runId)
      } catch {
        console.warn(`[RunDetail] Generate Report timed out for run ${runId}`)
      }
    }

    return null
  }

  /** Get the run name shown in the page heading */
  async getRunName(): Promise<string | null> {
    try {
      // The run name is typically in a h1 or large heading
      return await this.page.locator('h1, h2').first().textContent().then((t) => t?.trim() ?? null)
    } catch {}
    return null
  }

  /** Check whether the ML Insights tab is visible (only for ML strategies) */
  async isMLInsightsTabVisible(): Promise<boolean> {
    const tab = this.page.locator('[role="tab"]').filter({ hasText: 'ML Insights' })
    return await tab.count() > 0
  }

  /**
   * Read the effective start/end dates from the run configuration card.
   * Returns dates in yyyy-MM-dd format if parseable.
   */
  async readEffectiveDates(): Promise<{ startDate: string | null; endDate: string | null }> {
    const config = await this.readRunConfig()
    if (!config.period) return { startDate: null, endDate: null }

    // Period format from UI: "2019-03 – 2025-03" (YYYY-MM with em dash)
    // Also handles: "2019-01-02 → 2025-03-07" or "2019-01-02 to 2025-03-07"
    const m = config.period.match(/(\d{4}-\d{2}(?:-\d{2})?)\s*[–—→to]+\s*(\d{4}-\d{2}(?:-\d{2})?)/)
    if (m) return { startDate: m[1], endDate: m[2] }

    return { startDate: null, endDate: null }
  }
}
