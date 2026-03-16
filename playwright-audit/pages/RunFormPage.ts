import type { Page, Locator } from "@playwright/test"
import { BASE_URL, FORM_READY_TIMEOUT_MS } from "../audit.config"

export type PreflightOutcome = {
  status: "ok" | "warn" | "block" | "error"
  messages: string[]
  /** For warn: the texts of suggested-fix action buttons */
  actionLabels: string[]
}

export type RunFormConfig = {
  runName: string
  strategy: string
  universe: string
  benchmark: string
  startDate: string  // yyyy-MM-dd
  endDate: string    // yyyy-MM-dd
  costsBps: number
  topN: number
}

export class RunFormPage {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(`${BASE_URL}/runs/new`)
    // Wait for the form card to appear
    await this.page.waitForSelector('input#name', { timeout: FORM_READY_TIMEOUT_MS })
  }

  /** Fill all form fields and submit. Returns the preflight outcome or null if run was created. */
  async fillAndSubmit(config: RunFormConfig): Promise<{ runId: string | null; preflight: PreflightOutcome | null }> {
    await this.setRunName(config.runName)
    await this.setStrategy(config.strategy)
    await this.setUniverse(config.universe)

    // Wait for universe readiness check to complete
    await this.waitForUniverseReady()

    // Set dates
    await this.setStartDate(config.startDate)
    await this.setEndDate(config.endDate)

    await this.setBenchmark(config.benchmark)
    await this.setCostsBps(config.costsBps)
    await this.setTopN(config.topN)

    // Submit
    return await this.submit()
  }

  async setRunName(name: string): Promise<void> {
    await this.page.locator('input#name').fill(name)
  }

  async setStrategy(strategyId: string): Promise<void> {
    await this.page.locator('select[name="strategy_id"]').selectOption(strategyId)
    // Brief pause to let React state settle
    await this.page.waitForTimeout(300)
  }

  async setUniverse(universeId: string): Promise<void> {
    await this.page.locator('select[name="universe"]').selectOption(universeId)
    // Universe change triggers async load
    await this.page.waitForTimeout(500)
  }

  /**
   * Wait until the "Queue Backtest" button is enabled (universe ready).
   * This may take a while if universe data needs to be ingested.
   */
  async waitForUniverseReady(timeout = FORM_READY_TIMEOUT_MS): Promise<void> {
    const submitBtn = this.page.locator('button[type="submit"]:has-text("Queue Backtest"), button[type="submit"]:has-text("Checking"), button[type="submit"]:has-text("Queueing")')

    try {
      // Wait for button to be enabled (not disabled)
      await this.page.waitForFunction(
        () => {
          const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement | null
          return btn && !btn.disabled
        },
        { timeout }
      )
    } catch {
      // Button may still be disabled due to universe not ready — that's acceptable
      // We'll detect this at submission time
      console.warn('[RunFormPage] Universe may not be ready — submit button still disabled')
    }
  }

  /**
   * Set start date using the calendar popover.
   * DayPicker with captionLayout="dropdown-years" renders year/month selects.
   */
  async setStartDate(dateStr: string): Promise<void> {
    await this.setCalendarDate('start', dateStr)
  }

  async setEndDate(dateStr: string): Promise<void> {
    await this.setCalendarDate('end', dateStr)
  }

  private async setCalendarDate(type: 'start' | 'end', dateStr: string): Promise<void> {
    const [year, month, day] = dateStr.split('-').map(Number)

    // Find the appropriate date button. The start button appears before the end button.
    // Both buttons show either placeholder text ("Start date"/"End date") or a formatted date.
    const dateButtons = this.page.locator('button.h-8.w-full.justify-start')
    const btnIndex = type === 'start' ? 0 : 1

    // Click to open popover
    await dateButtons.nth(btnIndex).click()
    await this.page.waitForTimeout(300)

    // The popover content renders in a Radix portal
    const popover = this.page.locator('[data-radix-popper-content-wrapper]').last()
    await popover.waitFor({ state: 'visible', timeout: 5_000 })

    // DayPicker with captionLayout="dropdown-years" renders <select> elements
    // for month and year inside the calendar caption
    const selects = popover.locator('select')
    const selectCount = await selects.count()

    if (selectCount >= 2) {
      // Typically: first select = month (0-indexed values), second = year
      // But some DayPicker versions use month first then year, or reversed.
      // Detect by checking option values.
      const firstOptions = await selects.first().evaluate((el: HTMLSelectElement) =>
        Array.from(el.options).map((o) => o.value)
      )
      const secondOptions = await selects.last().evaluate((el: HTMLSelectElement) =>
        Array.from(el.options).map((o) => o.value)
      )

      // Year values are 4 digits; month values are 0-11 or 1-12
      const firstIsYear = firstOptions.some((v) => v.length === 4)
      const secondIsYear = secondOptions.some((v) => v.length === 4)

      let monthSelect: Locator
      let yearSelect: Locator

      if (secondIsYear) {
        monthSelect = selects.first()
        yearSelect = selects.last()
      } else if (firstIsYear) {
        yearSelect = selects.first()
        monthSelect = selects.last()
      } else {
        // Fallback: assume first=month, second=year
        monthSelect = selects.first()
        yearSelect = selects.last()
      }

      // Select year — check the option exists first (future years beyond cutoff are not listed)
      const yearOptions = await yearSelect.evaluate((el: HTMLSelectElement) =>
        Array.from(el.options).map((o) => o.value)
      )
      if (!yearOptions.includes(String(year))) {
        await this.page.keyboard.press('Escape')
        await this.page.waitForTimeout(200)
        const maxYear = yearOptions.filter((v) => /^\d{4}$/.test(v)).sort().at(-1) ?? 'unknown'
        throw new Error(`CALENDAR_DATE_DISABLED: year ${year} not available in calendar dropdown (max available: ${maxYear})`)
      }
      await yearSelect.selectOption(String(year))
      await this.page.waitForTimeout(200)

      // Select month — try 0-indexed first (0=Jan), then 1-indexed (1=Jan)
      const monthValue0 = String(month - 1)  // 0-indexed
      const monthValue1 = String(month)       // 1-indexed
      const monthOptions = await monthSelect.evaluate((el: HTMLSelectElement) =>
        Array.from(el.options).map((o) => o.value)
      )
      if (monthOptions.includes(monthValue0)) {
        await monthSelect.selectOption(monthValue0)
      } else if (monthOptions.includes(monthValue1)) {
        await monthSelect.selectOption(monthValue1)
      } else {
        // Try month name
        const monthNames = ["January","February","March","April","May","June",
          "July","August","September","October","November","December"]
        await monthSelect.selectOption({ label: monthNames[month - 1] })
      }
      await this.page.waitForTimeout(200)
    } else if (selectCount === 1) {
      // Only one select — probably year only (dropdown-years without month select)
      const soloYearOptions = await selects.first().evaluate((el: HTMLSelectElement) =>
        Array.from(el.options).map((o) => o.value)
      )
      if (!soloYearOptions.includes(String(year))) {
        await this.page.keyboard.press('Escape')
        await this.page.waitForTimeout(200)
        const maxYear = soloYearOptions.filter((v) => /^\d{4}$/.test(v)).sort().at(-1) ?? 'unknown'
        throw new Error(`CALENDAR_DATE_DISABLED: year ${year} not available in calendar dropdown (max available: ${maxYear})`)
      }
      await selects.first().selectOption(String(year))
      await this.page.waitForTimeout(200)
      // Navigate to the correct month using prev/next arrows
      await this.navigateCalendarToMonth(popover, year, month)
    } else {
      // No selects — use prev/next navigation
      await this.navigateCalendarToMonth(popover, year, month)
    }

    // Click the day button
    // DayPicker renders day buttons — use exact number matching
    const dayBtn = popover
      .locator(`button`)
      .filter({ hasText: new RegExp(`^${day}$`) })
      .first()

    // If the day is disabled (date before calendar minimum), close the popover
    // and throw a descriptive error so callers can detect this as expected behaviour.
    const isDisabledDay = await dayBtn
      .evaluate((el) => (el as HTMLButtonElement).disabled)
      .catch(() => false)
    if (isDisabledDay) {
      await this.page.keyboard.press('Escape')
      await this.page.waitForTimeout(200)
      throw new Error(`CALENDAR_DATE_DISABLED: ${dateStr} is before the minimum allowed date in the calendar`)
    }

    await dayBtn.click()

    // Wait for popover to close
    await this.page.waitForTimeout(200)
  }

  private async navigateCalendarToMonth(
    popover: Locator,
    targetYear: number,
    targetMonth: number
  ): Promise<void> {
    // Read current month/year from caption
    // Navigate using prev/next month buttons
    for (let attempt = 0; attempt < 48; attempt++) {
      const caption = await popover.locator('[class*="caption"]').textContent().catch(() => "")
      if (!caption) break

      // Parse "March 2024" or similar
      const monthNames = ["January","February","March","April","May","June",
        "July","August","September","October","November","December"]
      const captionMatch = caption.match(/(\w+)\s+(\d{4})/)
      if (!captionMatch) break

      const captionMonth = monthNames.indexOf(captionMatch[1]) + 1
      const captionYear = parseInt(captionMatch[2])

      if (captionYear === targetYear && captionMonth === targetMonth) break

      const targetTotal = targetYear * 12 + targetMonth
      const currentTotal = captionYear * 12 + captionMonth

      if (targetTotal < currentTotal) {
        await popover.locator('[aria-label="Go to previous month"], button[name="previous-month"]').first().click()
      } else {
        await popover.locator('[aria-label="Go to next month"], button[name="next-month"]').first().click()
      }
      await this.page.waitForTimeout(150)
    }
  }

  async setBenchmark(benchmarkId: string): Promise<void> {
    await this.page.locator('select#benchmark').selectOption(benchmarkId)
  }

  async setCostsBps(bps: number): Promise<void> {
    await this.page.locator('input#costs_bps').fill(String(bps))
  }

  async setTopN(n: number): Promise<void> {
    await this.page.locator('input#top_n').fill(String(n))
  }

  /**
   * Submit the form. Returns:
   * - { runId, preflight: null } if run was created successfully
   * - { runId: null, preflight } if preflight blocked or warned
   */
  async submit(): Promise<{ runId: string | null; preflight: PreflightOutcome | null }> {
    // Check if submit button is enabled
    const btn = this.page.locator('button[type="submit"]')
    const isDisabled = await btn.getAttribute('disabled')
    if (isDisabled !== null) {
      return {
        runId: null,
        preflight: {
          status: 'error',
          messages: ['Submit button was disabled at time of submission (universe not ready?)'],
          actionLabels: [],
        },
      }
    }

    // Capture current URL before submitting
    const urlBefore = this.page.url()

    await btn.click()

    // Wait for one of: navigation to /runs/{id}, block dialog, warn dialog, or error.
    // Use 90s to cover slow preflight on large universes (SP100/NASDAQ100 = 20 stocks).
    const result = await Promise.race([
      // Successful navigation
      this.page.waitForURL(/\/runs\/[a-f0-9-]{36}/, { timeout: 90_000 })
        .then(() => 'navigated' as const)
        .catch(() => null),

      // Block dialog
      this.page.waitForSelector('[role="alertdialog"]:has-text("This run is blocked")', { timeout: 90_000 })
        .then(() => 'blocked' as const)
        .catch(() => null),

      // Warn dialog
      this.page.waitForSelector('[role="dialog"]:has-text("Warning")', { timeout: 90_000 })
        .then(() => 'warned' as const)
        .catch(() => null),
    ])

    // After the race, always check the current URL first — the navigation may have completed
    // just as the timeout fired (race condition on slow preflight for large universes).
    const currentUrl = this.page.url()
    const currentRunIdMatch = currentUrl.match(/\/runs\/([a-f0-9-]{36})/)
    if (currentRunIdMatch) {
      return { runId: currentRunIdMatch[1], preflight: null }
    }

    if (result === 'navigated') {
      const newUrl = this.page.url()
      const runIdMatch = newUrl.match(/\/runs\/([a-f0-9-]{36})/)
      return { runId: runIdMatch?.[1] ?? null, preflight: null }
    }

    if (result === 'blocked') {
      const messages = await this.extractBlockMessages()
      // Close the dialog
      await this.page.locator('[role="alertdialog"] button:has-text("Close")').click().catch(() => {})
      return {
        runId: null,
        preflight: { status: 'block', messages, actionLabels: [] },
      }
    }

    if (result === 'warned') {
      const { messages, actionLabels } = await this.extractWarnMessages()
      return {
        runId: null,
        preflight: { status: 'warn', messages, actionLabels },
      }
    }

    // Check for inline error
    const errorText = await this.page.locator('.text-destructive').textContent().catch(() => null)
    if (errorText) {
      return {
        runId: null,
        preflight: { status: 'error', messages: [errorText.trim()], actionLabels: [] },
      }
    }

    return {
      runId: null,
      preflight: { status: 'error', messages: ['Submit timed out with no recognizable response'], actionLabels: [] },
    }
  }

  /**
   * Acknowledge a warning and proceed with run creation.
   * Call this after submit() returns preflight.status === 'warn'.
   */
  async acknowledgeWarningAndQueue(): Promise<{ runId: string | null }> {
    const dialog = this.page.locator('[role="dialog"]:has-text("Warning")')
    await dialog.locator('button:has-text("Acknowledge and Queue")').click()

    try {
      await this.page.waitForURL(/\/runs\/[a-f0-9-]{36}/, { timeout: 60_000 })
      const newUrl = this.page.url()
      const runIdMatch = newUrl.match(/\/runs\/([a-f0-9-]{36})/)
      return { runId: runIdMatch?.[1] ?? null }
    } catch {
      return { runId: null }
    }
  }

  /**
   * Apply the suggested fix from the block dialog (e.g., clamp dates).
   * Call this after submit() returns preflight.status === 'block'.
   */
  async applyBlockFix(): Promise<void> {
    const dialog = this.page.locator('[role="alertdialog"]')
    const fixBtn = dialog.locator('button').filter({ hasNotText: /Close|Cancel/ }).first()
    const hasFixBtn = await fixBtn.count() > 0
    if (hasFixBtn) {
      await fixBtn.click()
      await this.page.waitForTimeout(500)
    }
  }

  private async extractBlockMessages(): Promise<string[]> {
    const dialog = this.page.locator('[role="alertdialog"]')
    const issues = await dialog.locator('.rounded-md.border p.text-sm').allTextContents()
    const fixes = await dialog.locator('.rounded-md.border p.text-\\[12px\\]').allTextContents()
    const messages: string[] = []
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i]?.trim() ?? ""
      const fix = fixes[i]?.trim() ?? ""
      messages.push(fix ? `${issue} — Fix: ${fix}` : issue)
    }
    return messages.length > 0 ? messages : [await dialog.textContent().then((t) => t?.trim() ?? "Block dialog")]
  }

  private async extractWarnMessages(): Promise<{ messages: string[]; actionLabels: string[] }> {
    const dialog = this.page.locator('[role="dialog"]:has-text("Warning")')
    const issues = await dialog.locator('.rounded-md.border p.text-sm').allTextContents()
    const fixes = await dialog.locator('.rounded-md.border p.text-\\[12px\\]').allTextContents()
    const actionBtns = await dialog.locator('.rounded-md.border button').allTextContents()
    const messages: string[] = []
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i]?.trim() ?? ""
      const fix = fixes[i]?.trim() ?? ""
      messages.push(fix ? `${issue} — Fix: ${fix}` : issue)
    }
    return {
      messages: messages.length > 0 ? messages : [await dialog.textContent().then((t) => t?.trim() ?? "Warn dialog")],
      actionLabels: actionBtns.map((t) => t.trim()).filter(Boolean),
    }
  }

  /** Read the date adjustment message shown below the date fields */
  async getDateAdjustmentMessage(): Promise<string | null> {
    const msg = await this.page.locator('.text-amber-300.bg-amber-950\\/30').textContent().catch(() => null)
    return msg?.trim() ?? null
  }

  /** Read the current value shown on the start date button */
  async getStartDateDisplay(): Promise<string | null> {
    const btns = this.page.locator('button.h-8.w-full.justify-start')
    return await btns.nth(0).textContent().then((t) => t?.trim() ?? null).catch(() => null)
  }

  /** Read the current value shown on the end date button */
  async getEndDateDisplay(): Promise<string | null> {
    const btns = this.page.locator('button.h-8.w-full.justify-start')
    return await btns.nth(1).textContent().then((t) => t?.trim() ?? null).catch(() => null)
  }

  /** Read the cutoff date shown on the form */
  async getCutoffDate(): Promise<string | null> {
    const text = await this.page.locator('p:has-text("Data current through")').textContent().catch(() => null)
    if (!text) return null
    const m = text.match(/(\d{4}-\d{2}-\d{2})/)
    return m?.[1] ?? null
  }
}
