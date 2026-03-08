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

// ── Max Drawdown label ────────────────────────────────────────────────────────

describe("buildReportHtml - max drawdown label", () => {
  it("KPI label includes peak-to-trough clarification", () => {
    const html = buildReportHtml({ ...BASE_PARAMS, strategyId: "equal_weight" })
    expect(html).toContain("Max Drawdown (peak-to-trough)")
  })
})

// ── X-axis date range regression ──────────────────────────────────────────────

describe("buildReportHtml - x-axis date range", () => {
  it("xDateEnd label is the true last date in a 5-year series (2021→2026)", () => {
    // Build a synthetic 5-year daily equity curve: 2021-03-01 → 2026-03-06
    const start = new Date("2021-03-01T00:00:00Z")
    const end = new Date("2026-03-06T00:00:00Z")
    const curve: EquityCurveRow[] = []
    let nav = 100_000
    let bench = 100_000
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10)
      nav += 50
      bench += 40
      curve.push({ id: `eq-${date}`, run_id: "test-run-id", date, portfolio: nav, benchmark: bench })
    }
    const lastDate = curve[curve.length - 1].date

    const html = buildReportHtml({
      ...BASE_PARAMS,
      strategyId: "equal_weight",
      equityCurve: curve,
      startDate: "2021-03-01",
      endDate: "2026-03-06",
    })

    // The x-axis end label must be the actual last date (a 2026 date)
    expect(lastDate).toMatch(/^2026-/)
    expect(html).toContain(`<span>${lastDate}</span>`)
  })
})
