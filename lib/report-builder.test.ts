import { describe, expect, it } from "vitest"
import { buildReportHtml } from "@/lib/report-builder"
import type { EquityCurveRow, RunMetricsRow } from "@/lib/supabase/types"

// ── Fixtures ─────────────────────────────────────────────────────────────────

const METRICS: RunMetricsRow = {
  id: "test-metrics-id",
  run_id: "test-run-id",
  cagr: 0.12,
  sharpe: 1.1,
  max_drawdown: -0.22,
  turnover: 0.15,
  volatility: 0.18,
  win_rate: 0.55,
  profit_factor: 1.4,
  calmar: 0.55,
}

const EQUITY: EquityCurveRow[] = Array.from({ length: 10 }, (_, i) => ({
  id: `eq-${i}`,
  run_id: "test-run-id",
  date: `2023-0${Math.floor(i / 3) + 1}-${String((i % 3) * 10 + 1).padStart(2, "0")}`,
  portfolio: 100_000 + i * 1_000,
  benchmark: 100_000 + i * 800,
}))

const BASE_PARAMS = {
  runName: "Test Run",
  startDate: "2023-01-01",
  endDate: "2023-12-31",
  generatedAt: "2026-03-08T00:00:00.000Z",
  benchmarkTicker: "SPY",
  benchmarkOverlapDetected: false,
  metrics: METRICS,
  equityCurve: EQUITY,
  universe: "ETF8",
  universeSymbols: ["SPY", "QQQ", "IWM", "EFA"],
  costsBps: 10,
  topN: 4,
  runParams: {},
  runMetadata: {
    modelImpl: null,
    modelVersion: null,
    featureSet: null,
    positionsDigest: null,
    equityDigest: null,
  },
}

function makeTradingDayCurve(startDate: string, endDate: string): EquityCurveRow[] {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  const curve: EquityCurveRow[] = []
  let nav = 100_000
  let bench = 100_000

  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay()
    if (weekday === 0 || weekday === 6) continue

    const date = day.toISOString().slice(0, 10)
    nav += 50
    bench += 40
    curve.push({ id: `eq-${date}`, run_id: "test-run-id", date, portfolio: nav, benchmark: bench })
  }

  return curve
}

// ── Mojibake regression ───────────────────────────────────────────────────────

const MOJIBAKE_PATTERNS = ["â€\u201c", "Ã—", "Ã·", "â€\u201d", "â€˜", "â€™"]

describe("buildReportHtml - encoding", () => {
  it("contains no mojibake substrings for equal_weight strategy", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "equal_weight" })
    for (const pattern of MOJIBAKE_PATTERNS) {
      expect(html, `HTML must not contain mojibake "${pattern}"`).not.toContain(pattern)
    }
  })

  it("contains no mojibake substrings for ml_lightgbm strategy", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "ml_lightgbm" })
    for (const pattern of MOJIBAKE_PATTERNS) {
      expect(html, `HTML must not contain mojibake "${pattern}"`).not.toContain(pattern)
    }
  })

  it("profit factor definition uses HTML entities not raw Unicode", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "equal_weight" })
    expect(html).toContain("&divide;")
    expect(html).toContain("&mdash;")
    // raw chars must not appear in output
    expect(html).not.toContain("\u00F7") // ÷
    expect(html).not.toContain("\u2014") // —
  })
})

// ── Rebalance frequency ───────────────────────────────────────────────────────

describe("buildReportHtml - rebalance frequency", () => {
  it("ML ridge strategy shows Daily rebalance frequency", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "ml_ridge" })
    expect(html).toContain("Rebalance frequency:</strong> Daily")
  })

  it("ML lightgbm strategy shows Daily rebalance frequency", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "ml_lightgbm" })
    expect(html).toContain("Rebalance frequency:</strong> Daily")
  })

  it("non-ML strategy defaults to Monthly rebalance frequency", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "momentum_12_1" })
    expect(html).toContain("Rebalance frequency:</strong> Monthly")
  })

  it("non-ML strategy respects rebalance_frequency from run_params", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      runParams: { rebalance_frequency: "Weekly" },
    })
    expect(html).toContain("Rebalance frequency:</strong> Weekly")
  })
})

// ── Cost annualization ────────────────────────────────────────────────────────

describe("buildReportHtml - cost annualization", () => {
  it("ML strategy uses 252 periods/year in cost section", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "ml_ridge" })
    expect(html).toContain("252 periods/year")
    expect(html).not.toContain("12 periods/year")
  })

  it("monthly strategy uses 12 periods/year in cost section", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "equal_weight" })
    expect(html).toContain("12 periods/year")
  })

  it("weekly strategy uses 52 periods/year in cost section", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      runParams: { rebalance_frequency: "Weekly" },
    })
    expect(html).toContain("52 periods/year")
  })
})

// ── Benchmark label ───────────────────────────────────────────────────────────

describe("buildReportHtml - benchmark label", () => {
  it("uses the provided benchmark ticker throughout", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, benchmarkTicker: "QQQ", strategyId: "equal_weight" })
    expect(html).toContain("Benchmark:</strong> QQQ")
    expect(html).toContain("Equity Curve vs QQQ")
    expect(html).toContain("QQQ (Benchmark)")
    // Must not have hardcoded SPY when benchmark is QQQ
    expect(html).not.toContain("Benchmark:</strong> SPY")
  })
})

// ── Benchmark overlap flag ────────────────────────────────────────────────────

describe("buildReportHtml - benchmark overlap", () => {
  it("includes overlap notice when benchmarkOverlapDetected is true", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "equal_weight", benchmarkOverlapDetected: true })
    expect(html).toContain("Benchmark overlap:")
  })

  it("omits overlap notice when benchmarkOverlapDetected is false", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "equal_weight", benchmarkOverlapDetected: false })
    expect(html).not.toContain("Benchmark overlap:")
  })
})

// ── Dual-class share disclosure ───────────────────────────────────────────────

describe("buildReportHtml - dual-class disclosure", () => {
  it("includes dual-class note when universe contains both GOOGL and GOOG", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      universeSymbols: ["AAPL", "MSFT", "GOOGL", "GOOG", "META"],
    })
    expect(html).toContain("Dual-class shares:")
  })

  it("omits dual-class note when universe has only GOOGL", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      universeSymbols: ["AAPL", "MSFT", "GOOGL", "META"],
    })
    expect(html).not.toContain("Dual-class shares:")
  })

  it("omits dual-class note for ETF8 universe (no GOOGL/GOOG)", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "equal_weight" })
    expect(html).not.toContain("Dual-class shares:")
  })
})

// ── Max Drawdown label ────────────────────────────────────────────────────────

describe("buildReportHtml - max drawdown label", () => {
  it("KPI label includes peak-to-trough clarification", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "equal_weight" })
    expect(html).toContain("Max Drawdown (peak-to-trough)")
  })
})

// ── Max Drawdown display convention ───────────────────────────────────────────

describe("buildReportHtml - max drawdown display convention", () => {
  /**
   * The DB stores max_drawdown as a NEGATIVE fraction (e.g. -0.22 for a 22% decline).
   * The report builder must display it as a POSITIVE magnitude via Math.abs().
   * This is enforced in the KPI grid: fmtPercent(Math.abs(metrics.max_drawdown)).
   */
  it("Negative DB value −0.22 is displayed as positive '22.0%'", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      metrics: { ...METRICS, max_drawdown: -0.22 },
    })
    // Must contain positive display
    expect(html).toContain(">22.0%<")
    // Must NOT display a minus sign immediately before the MDD percentage
    // (this would indicate Math.abs is missing)
    expect(html).not.toMatch(/>-22\./)
  })

  it("Positive DB value +0.22 (hypothetical) is also displayed as '22.0%' via abs()", () => {
    // If max_drawdown were accidentally stored positive, Math.abs() still produces
    // the correct display. Verify the output is identical.
    const htmlNeg = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      metrics: { ...METRICS, max_drawdown: -0.22 },
    })
    const htmlPos = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      metrics: { ...METRICS, max_drawdown: 0.22 },
    })
    // Both must show "22.0%" in the MDD KPI — abs() handles both conventions
    expect(htmlNeg).toContain(">22.0%<")
    expect(htmlPos).toContain(">22.0%<")
  })

  it("Max Drawdown worst-case line in drawdown section also uses abs magnitude", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      metrics: { ...METRICS, max_drawdown: -0.35 },
    })
    // Worst Drawdown paragraph: "35.0% (positive magnitude; peak-to-trough decline)"
    expect(html).toContain("peak-to-trough")
    // Must show positive magnitude in the text; "-35" must not appear
    expect(html).not.toContain("-35")
  })
})

// ── Calmar consistency (CAGR / |Max DD|) ─────────────────────────────────────

describe("buildReportHtml - calmar ratio display", () => {
  /**
   * Calmar is displayed as a ratio (fmtRatio = toFixed(2)), not a percentage.
   * For METRICS fixture: cagr=0.12, max_drawdown=-0.22, calmar=0.55.
   * The stored calmar is passed through directly: 0.55 → "0.55".
   */
  it("Calmar displayed as ratio (e.g. '0.77'), not as percentage", () => {
    // Use 0.77 so it doesn't collide with win_rate=0.55 (which renders as "55.0%")
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      metrics: { ...METRICS, calmar: 0.77 },
    })
    // Should appear as "0.77" in a KPI value div
    expect(html).toContain(">0.77<")
    // Must NOT be formatted as "77.0%" (which would indicate fmtPercent was used)
    expect(html).not.toContain(">77.0%<")
  })

  /**
   * Verify that displayed calmar is consistent with |CAGR / max_drawdown|.
   * Uses metrics where Calmar = |0.10 / 0.40| = 0.25 exactly.
   */
  it("Calmar KPI = |cagr / max_drawdown| to 2dp for exact values", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      metrics: {
        ...METRICS,
        cagr: 0.10,
        max_drawdown: -0.40,
        calmar: 0.25, // 0.10 / 0.40 = 0.25
      },
    })
    expect(html).toContain(">0.25<")
  })
})

// ── Metric formatting precision ────────────────────────────────────────────────

describe("buildReportHtml - metric formatting precision", () => {
  /**
   * CAGR is a fraction (0.12 = 12%); fmtPercent multiplies by 100 and appends "%".
   * Convention: fmtPercent(v) = `${(v*100).toFixed(1)}%`
   */
  it("CAGR 0.12 is displayed as '12.0%'", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      metrics: { ...METRICS, cagr: 0.12 },
    })
    expect(html).toContain(">12.0%<")
  })

  it("Negative CAGR -0.05 is displayed as '-5.0%'", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      metrics: { ...METRICS, cagr: -0.05 },
    })
    expect(html).toContain(">-5.0%<")
  })

  it("Volatility 0.18 is displayed as '18.0%'", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      metrics: { ...METRICS, volatility: 0.18 },
    })
    expect(html).toContain(">18.0%<")
  })

  it("Win Rate 0.55 is displayed as '55.0%'", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      metrics: { ...METRICS, win_rate: 0.55 },
    })
    expect(html).toContain(">55.0%<")
  })

  it("Turnover 0.15 is displayed as '15.0%'", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      metrics: { ...METRICS, turnover: 0.15 },
    })
    expect(html).toContain(">15.0%<")
  })

  it("Sharpe 1.1 is displayed as '1.10' (ratio to 2dp)", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      metrics: { ...METRICS, sharpe: 1.1 },
    })
    expect(html).toContain(">1.10<")
  })

  it("Profit Factor 1.4 is displayed as '1.40' (ratio to 2dp)", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      metrics: { ...METRICS, profit_factor: 1.4 },
    })
    expect(html).toContain(">1.40<")
  })
})

// ── Turnover and cost-drag convention ─────────────────────────────────────────

describe("buildReportHtml - turnover convention and cost drag", () => {
  /**
   * Turnover definition in the report must say "one-way" to match the computation
   * in worker.py: per-rebalance turnover = sum(abs(weight_changes)) / 2.
   */
  it("Turnover definition text includes 'one-way' to match computation convention", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "equal_weight" })
    expect(html).toContain("one-way")
  })

  it("Turnover definition text references 'per rebalance period'", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "equal_weight" })
    expect(html).toContain("per rebalance period")
  })

  /**
   * Cost drag formula: annualizedCostDrag = turnoverFrac × (costsBps/10000) × periods
   * With turnover=0.08 (8%), costs=10bps, monthly (12 periods):
   *   perRebalance = 0.08 × 0.001 = 0.00008 = 0.008%
   *   annualized   = 0.00008 × 12 = 0.00096 ≈ 0.10%
   */
  it("Cost drag is computed correctly: 8% turnover × 10bps × 12 periods = 0.096%", () => {
    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      costsBps: 10,
      metrics: { ...METRICS, turnover: 0.08 },
    })
    // Per-rebalance: 0.08 × 0.001 = 0.00008 → fmtCostDrag → "0.008%"
    expect(html).toContain("0.008%")
    // Annualized: 0.00008 × 12 = 0.00096 → fmtCostDrag → "0.10%"
    expect(html).toContain("0.10%")
  })

  /**
   * Higher costs produce higher displayed drag.
   */
  it("Higher costsBps → higher displayed annualized cost drag", () => {
    const paramsLow = { ...BASE_PARAMS, strategyId: "equal_weight", costsBps: 5 }
    const paramsHigh = { ...BASE_PARAMS, strategyId: "equal_weight", costsBps: 50 }
    const htmlLow = buildReportHtml(paramsLow)
    const htmlHigh = buildReportHtml(paramsHigh)
    // High costs must mention a larger bps in the transaction cost line
    expect(htmlHigh).toContain("50 bps")
    expect(htmlLow).toContain("5 bps")
    expect(htmlHigh).not.toContain("5 bps per 100%")
  })

  /**
   * Profit factor definition must use HTML entity &divide; (not raw ÷ char)
   * and must reference "daily granularity".
   */
  it("Profit factor definition: sum(positive) &divide; |sum(negative)| at daily granularity", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "equal_weight" })
    expect(html).toContain("&divide;")
    expect(html).toContain("daily granularity")
  })

  /**
   * Win rate definition must reference "positive portfolio return" and "daily granularity".
   */
  it("Win rate definition references positive portfolio return and daily granularity", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "equal_weight" })
    expect(html).toContain("positive portfolio return")
    expect(html).toContain("daily granularity")
  })
})

// ── X-axis date range regression ──────────────────────────────────────────────

describe("buildReportHtml - x-axis date range", () => {
  it("keeps the true last date and reports plotted vs raw points for a 2021→2026 run", () => {
    const curve = makeTradingDayCurve("2021-03-01", "2026-03-13")
    const lastDate = curve[curve.length - 1].date

    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      equityCurve: curve,
      startDate: "2021-03-01",
      endDate: "2026-03-13",
    })

    expect(curve.length).toBeGreaterThan(1200)
    expect(lastDate).toMatch(/^2026-/)
    expect(html).toContain("Equity curve points:</strong> 1000 (from")
    expect(html).toContain(`<span>${lastDate}</span>`)
  })
})
