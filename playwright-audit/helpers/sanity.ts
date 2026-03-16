/**
 * KPI sanity checks — basic range validation and cross-metric consistency.
 * These do NOT prove correctness; they catch obvious errors (e.g. CAGR = 1500%).
 */

export type SanityCheckResult = {
  passed: boolean
  message: string
}

function parsePercent(value: string | null): number | null {
  if (!value) return null
  const cleaned = value.replace(/%/g, "").trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n / 100
}

function parseRatio(value: string | null): number | null {
  if (!value) return null
  const n = parseFloat(value.trim())
  return isNaN(n) ? null : n
}

/**
 * CAGR sanity: should be between -95% and +200% for any realistic strategy.
 */
export function checkCagr(cagrStr: string | null): SanityCheckResult {
  const cagr = parsePercent(cagrStr)
  if (cagr === null) return { passed: false, message: `CAGR missing or unparseable: ${cagrStr}` }
  if (cagr < -0.95) return { passed: false, message: `CAGR implausibly negative: ${cagrStr}` }
  if (cagr > 2.0) return { passed: false, message: `CAGR implausibly large: ${cagrStr}` }
  return { passed: true, message: `CAGR in range: ${cagrStr}` }
}

/**
 * Sharpe sanity: should be between -5 and +10 for any realistic strategy.
 */
export function checkSharpe(sharpeStr: string | null): SanityCheckResult {
  const sharpe = parseRatio(sharpeStr)
  if (sharpe === null) return { passed: false, message: `Sharpe missing or unparseable: ${sharpeStr}` }
  if (sharpe < -5) return { passed: false, message: `Sharpe implausibly negative: ${sharpeStr}` }
  if (sharpe > 10) return { passed: false, message: `Sharpe implausibly large: ${sharpeStr}` }
  return { passed: true, message: `Sharpe in range: ${sharpeStr}` }
}

/**
 * Max Drawdown sanity: the DB stores it as a negative fraction (e.g. -0.27).
 * The UI may show the raw negative value; the tearsheet shows positive magnitude.
 * Accept both conventions — just ensure the absolute magnitude is 0–100%.
 */
export function checkMaxDrawdown(mddStr: string | null): SanityCheckResult {
  if (!mddStr) return { passed: false, message: "Max Drawdown missing" }
  const dd = parsePercent(mddStr)
  if (dd === null) return { passed: false, message: `Max DD unparseable: ${mddStr}` }
  const mag = Math.abs(dd)
  if (mag > 1.0) return { passed: false, message: `Max DD magnitude > 100% (impossible): ${mddStr}` }
  if (mag === 0) return { passed: false, message: `Max DD is 0% (suspicious for a real run)` }
  return { passed: true, message: `Max DD magnitude in range: ${mddStr}` }
}

/**
 * Volatility sanity: annualized, should be 1–100%.
 */
export function checkVolatility(volStr: string | null): SanityCheckResult {
  const vol = parsePercent(volStr)
  if (vol === null) return { passed: false, message: `Volatility missing or unparseable: ${volStr}` }
  if (vol <= 0) return { passed: false, message: `Volatility <= 0: ${volStr}` }
  if (vol > 1.5) return { passed: false, message: `Volatility > 150% (suspicious): ${volStr}` }
  return { passed: true, message: `Volatility in range: ${volStr}` }
}

/**
 * Win Rate sanity: should be 0–100%.
 */
export function checkWinRate(winRateStr: string | null): SanityCheckResult {
  const wr = parsePercent(winRateStr)
  if (wr === null) return { passed: false, message: `Win Rate missing or unparseable: ${winRateStr}` }
  if (wr < 0 || wr > 1) return { passed: false, message: `Win Rate out of [0,1]: ${winRateStr}` }
  return { passed: true, message: `Win Rate in range: ${winRateStr}` }
}

/**
 * Profit Factor sanity: should be > 0. Typical range 0.5–5.
 */
export function checkProfitFactor(pfStr: string | null): SanityCheckResult {
  const pf = parseRatio(pfStr)
  if (pf === null) return { passed: false, message: `Profit Factor missing or unparseable: ${pfStr}` }
  if (pf <= 0) return { passed: false, message: `Profit Factor <= 0: ${pfStr}` }
  if (pf > 20) return { passed: false, message: `Profit Factor > 20 (suspicious): ${pfStr}` }
  return { passed: true, message: `Profit Factor in range: ${pfStr}` }
}

/**
 * Turnover sanity: annualized % of portfolio traded.
 * Momentum and trend strategies on small universes (e.g. ETF8 top-5) routinely exceed 600%/yr
 * because 3-4 of 5 positions can rotate every month (3 × 20% × 2 sides × 12 = 1440% max).
 * Observed: momentum_12_1 ~410%, trend_filter ~775%. Cap at 1500% to catch clearly
 * broken values (off-by-100x errors) while not false-positive on high-turnover strategies.
 */
export function checkTurnover(turnoverStr: string | null): SanityCheckResult {
  const t = parsePercent(turnoverStr)
  if (t === null) return { passed: false, message: `Turnover missing or unparseable: ${turnoverStr}` }
  if (t < 0) return { passed: false, message: `Turnover < 0: ${turnoverStr}` }
  if (t > 15.0) return { passed: false, message: `Turnover > 1500% (suspicious): ${turnoverStr}` }
  return { passed: true, message: `Turnover in range: ${turnoverStr}` }
}

/**
 * Calmar sanity: |CAGR/Max DD|. Should be between -20 and +50.
 */
export function checkCalmar(calmarStr: string | null): SanityCheckResult {
  const c = parseRatio(calmarStr)
  if (c === null) return { passed: false, message: `Calmar missing or unparseable: ${calmarStr}` }
  if (c < -20) return { passed: false, message: `Calmar implausibly negative: ${calmarStr}` }
  if (c > 50) return { passed: false, message: `Calmar implausibly large: ${calmarStr}` }
  return { passed: true, message: `Calmar in range: ${calmarStr}` }
}

/**
 * Cross-check: CAGR and Sharpe sign should be consistent.
 * A strongly negative CAGR with a strongly positive Sharpe (>1) is arithmetically
 * inconsistent — Sharpe = (CAGR - Rf) / Vol, so if CAGR < -5% the Sharpe must be negative
 * unless risk-free rate is unusually high. Flags pathological combinations.
 */
export function checkCagrSignConsistency(
  cagrStr: string | null,
  sharpeStr: string | null
): SanityCheckResult {
  const cagr = parsePercent(cagrStr)
  const sharpe = parseRatio(sharpeStr)
  if (cagr === null || sharpe === null) {
    return { passed: true, message: "Cannot check CAGR/Sharpe sign consistency (missing values)" }
  }
  if (cagr < -0.05 && sharpe > 1.0) {
    return {
      passed: false,
      message: `CAGR/Sharpe sign inconsistency: CAGR=${cagrStr} (negative) but Sharpe=${sharpeStr} (strongly positive). Check for calculation error.`,
    }
  }
  if (cagr > 0.10 && sharpe < -1.0) {
    return {
      passed: false,
      message: `CAGR/Sharpe sign inconsistency: CAGR=${cagrStr} (strongly positive) but Sharpe=${sharpeStr} (negative). Check for calculation error.`,
    }
  }
  return { passed: true, message: `CAGR/Sharpe sign consistent: CAGR=${cagrStr}, Sharpe=${sharpeStr}` }
}

/**
 * Cross-check: Calmar ≈ CAGR / Max DD.
 * Uses a ±30% tolerance to account for rounding in displayed values.
 */
export function checkCalmarConsistency(
  cagrStr: string | null,
  mddStr: string | null,
  calmarStr: string | null
): SanityCheckResult {
  const cagr = parsePercent(cagrStr)
  const dd = parsePercent(mddStr)
  const calmar = parseRatio(calmarStr)
  if (cagr === null || dd === null || calmar === null) {
    return { passed: true, message: "Cannot check Calmar consistency (missing values)" }
  }
  if (dd === 0) return { passed: true, message: "Max DD is 0, cannot cross-check Calmar" }
  // Use absolute magnitude for Calmar: CAGR / |Max DD|
  // The DB stores MDD as negative; Calmar is always reported as a positive ratio.
  const ddMag = Math.abs(dd)
  const expected = Math.abs(cagr / ddMag)
  const calmarMag = Math.abs(calmar)
  const tolerance = Math.abs(expected) * 0.30 + 0.05
  if (Math.abs(calmarMag - expected) > tolerance) {
    return {
      passed: false,
      message: `Calmar inconsistency: |CAGR/MDD| expected ~${expected.toFixed(2)}, got ${calmarMag.toFixed(2)} (CAGR=${cagrStr}, MDD=${mddStr})`,
    }
  }
  return { passed: true, message: `Calmar consistent with |CAGR/MDD|` }
}

/**
 * Holdings weight sum should be ~100% (within ±2pp).
 */
export function checkHoldingsWeightSum(sum: number | null, count: number | null): SanityCheckResult {
  if (sum === null) return { passed: false, message: "Holdings weight sum could not be computed" }
  if (count === 0) return { passed: false, message: "Zero holdings" }
  if (Math.abs(sum - 100) > 2) {
    return {
      passed: false,
      message: `Holdings weights sum to ${sum.toFixed(2)}% (expected ~100%)`,
    }
  }
  return { passed: true, message: `Holdings weight sum: ${sum.toFixed(2)}% (${count} positions)` }
}

/**
 * KPI UI/tearsheet consistency: values should match between UI and downloaded report.
 * Allows ±0.1pp tolerance for rounding differences.
 */
export function checkKpiConsistency(
  field: string,
  uiValue: string | null,
  reportValue: string | null
): SanityCheckResult {
  if (!uiValue || !reportValue) {
    if (!uiValue && !reportValue) return { passed: true, message: `${field}: both missing (acceptable)` }
    return { passed: false, message: `${field}: UI=${uiValue}, report=${reportValue} (one missing)` }
  }

  // Normalize: strip % and whitespace, parse as floats
  const uiNum = parseFloat(uiValue.replace(/%/g, "").trim())
  const repNum = parseFloat(reportValue.replace(/%/g, "").trim())

  if (isNaN(uiNum) || isNaN(repNum)) {
    // Both non-numeric — do exact string comparison
    if (uiValue.trim() !== reportValue.trim()) {
      return {
        passed: false,
        message: `${field} mismatch: UI="${uiValue}" vs report="${reportValue}"`,
      }
    }
    return { passed: true, message: `${field}: strings match` }
  }

  const diff = Math.abs(uiNum - repNum)
  if (diff > 0.15) {
    return {
      passed: false,
      message: `${field} mismatch: UI=${uiValue} vs report=${reportValue} (diff=${diff.toFixed(3)})`,
    }
  }
  return { passed: true, message: `${field} consistent: UI=${uiValue}, report=${reportValue}` }
}

/**
 * Config field consistency check (string match, case-insensitive).
 */
export function checkConfigConsistency(
  field: string,
  uiValue: string | null,
  reportValue: string | null
): SanityCheckResult {
  if (!uiValue && !reportValue) {
    return { passed: true, message: `${field}: both absent` }
  }
  if (!uiValue) return { passed: false, message: `${field}: UI missing, report has "${reportValue}"` }
  if (!reportValue) return { passed: false, message: `${field}: report missing, UI has "${uiValue}"` }

  if (uiValue.toLowerCase().includes(reportValue.toLowerCase()) ||
      reportValue.toLowerCase().includes(uiValue.toLowerCase())) {
    return { passed: true, message: `${field} consistent` }
  }
  return {
    passed: false,
    message: `${field} mismatch: UI="${uiValue}" vs report="${reportValue}"`,
  }
}

/**
 * Check that the chart date range is consistent with the run's effective window.
 * Extracts 4-digit years from both the chart tick labels and the effective dates,
 * then enforces two invariants:
 *   1. Chart end must be within 1 year of effective end (silent truncation = bug).
 *   2. Chart start must not predate effective start by more than 2 years (data leakage).
 */
export function checkChartDateRange(
  chartStart: string | null,
  chartEnd: string | null,
  effectiveStart: string | null,
  effectiveEnd: string | null
): SanityCheckResult {
  if (!chartStart || !chartEnd) {
    return { passed: false, message: "Chart date labels not found — cannot verify date coverage" }
  }
  if (!effectiveStart || !effectiveEnd) {
    return { passed: true, message: `Chart range visible: ${chartStart} → ${chartEnd} (effective dates unknown, skipping comparison)` }
  }

  // Extract 4-digit years from any date format ("Jan 2020", "2020-01-01", "2020", etc.)
  const extractYear = (s: string): number | null => {
    const m = s.match(/\b(20\d{2})\b/)
    return m ? parseInt(m[1]) : null
  }

  const cS = extractYear(chartStart)
  const cE = extractYear(chartEnd)
  const eS = extractYear(effectiveStart)
  const eE = extractYear(effectiveEnd)

  if (cS === null || cE === null || eS === null || eE === null) {
    return { passed: true, message: `Chart range: ${chartStart} → ${chartEnd} (years not parseable for comparison)` }
  }

  // Invariant 1: chart end must be within 1 year of effective end
  // A chart that stops 2+ years before the run end has silently truncated the data.
  if (eE - cE > 1) {
    return {
      passed: false,
      message: `Chart truncated: ends at ${chartEnd} but run ends at ${effectiveEnd} (${eE - cE}yr gap). Chart may not show full backtest period.`,
    }
  }

  // Invariant 2: chart start should not predate effective start by more than 2 years
  // (warmup data should not bleed into the chart window)
  if (eS - cS > 2) {
    return {
      passed: false,
      message: `Chart starts before effective period: chart=${chartStart}, effective=${effectiveStart} (${eS - cS}yr before). Warmup data may be included in chart.`,
    }
  }

  return {
    passed: true,
    message: `Chart range ${chartStart} → ${chartEnd} consistent with run ${effectiveStart} → ${effectiveEnd}`,
  }
}

/**
 * Check for mojibake or encoding issues in a string.
 * Looks for common mojibake patterns (e.g. Ã©, â€™, etc.)
 */
export function checkEncoding(field: string, value: string | null): SanityCheckResult {
  if (!value) return { passed: true, message: `${field}: absent (skip encoding check)` }
  const mojibakePatterns = [/\u00c3[\u0080-\u00ff]/u, /â€[\u2122\u0153\u201c\u201d]/, /\uFFFD/, /\\u[0-9a-fA-F]{4}/]
  for (const pattern of mojibakePatterns) {
    if (pattern.test(value)) {
      return { passed: false, message: `${field}: possible mojibake/encoding issue: "${value.slice(0, 80)}"` }
    }
  }
  return { passed: true, message: `${field}: encoding OK` }
}

/** Run all standard KPI sanity checks */
export function runAllKpiChecks(kpis: {
  cagr: string | null
  sharpe: string | null
  maxDrawdown: string | null
  volatility: string | null
  winRate: string | null
  profitFactor: string | null
  turnover: string | null
  calmar: string | null
}): SanityCheckResult[] {
  return [
    checkCagr(kpis.cagr),
    checkSharpe(kpis.sharpe),
    checkMaxDrawdown(kpis.maxDrawdown),
    checkVolatility(kpis.volatility),
    checkWinRate(kpis.winRate),
    checkProfitFactor(kpis.profitFactor),
    checkTurnover(kpis.turnover),
    checkCalmar(kpis.calmar),
    checkCalmarConsistency(kpis.cagr, kpis.maxDrawdown, kpis.calmar),
    checkCagrSignConsistency(kpis.cagr, kpis.sharpe),
  ]
}
