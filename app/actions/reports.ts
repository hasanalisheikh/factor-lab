"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import {
  getBenchmarkOverlapStateForRun,
  type EquityCurveRow,
  type RunMetricsRow,
  type RunRow,
} from "@/lib/supabase/queries"
import { getRunBenchmark } from "@/lib/benchmark"

const REPORTS_BUCKET = process.env.SUPABASE_REPORTS_BUCKET ?? "reports"

function isMissingPositionsTableError(message?: string): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return m.includes("public.positions") && m.includes("could not find the table")
}

function fmtPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`
}

function fmtRatio(value: number, digits = 2): string {
  return value.toFixed(digits)
}

function fmtMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`
}

/** Compact money for SVG axis labels: $100K, $1.2M, etc. */
function fmtMoneyCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}K`
  return `$${Math.round(value)}`
}

/**
 * Format a cost drag fraction as a percentage.
 * Avoids misleading "0.00%" for small but non-zero values.
 */
function fmtCostDrag(value: number): string {
  if (value === 0) return "0.00%"
  const pct = value * 100
  if (pct < 0.005) return "<0.01%"
  if (pct < 0.01) return `${pct.toFixed(3)}%`
  return `${pct.toFixed(2)}%`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

/**
 * Map a series of values to SVG polyline points using each series' own min/max scale.
 * padLeft defaults to pad (symmetric), allowing a wider left margin for y-axis labels.
 */
function makePolyline(
  points: number[],
  width: number,
  height: number,
  pad = 16,
  padLeft = pad,
): string {
  if (points.length === 0) return ""
  const min = Math.min(...points)
  const max = Math.max(...points)
  const ySpan = max - min || 1
  const xSpan = Math.max(points.length - 1, 1)
  return points
    .map((v, i) => {
      const x = padLeft + (i / xSpan) * (width - padLeft - pad)
      const y = height - pad - ((v - min) / ySpan) * (height - pad * 2)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")
}

/**
 * Like makePolyline but uses a caller-supplied shared [min, max] scale.
 * Both portfolio and benchmark lines must use the same min/max to be comparable.
 */
function makePolylineShared(
  points: number[],
  min: number,
  max: number,
  width: number,
  height: number,
  pad = 16,
  padLeft = pad,
): string {
  if (points.length === 0) return ""
  const ySpan = max - min || 1
  const xSpan = Math.max(points.length - 1, 1)
  return points
    .map((v, i) => {
      const x = padLeft + (i / xSpan) * (width - padLeft - pad)
      const y = height - pad - ((v - min) / ySpan) * (height - pad * 2)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")
}

function computeDrawdownSeries(equity: EquityCurveRow[]): number[] {
  let peak = -Infinity
  return equity.map((pt) => {
    if (pt.portfolio > peak) peak = pt.portfolio
    return peak > 0 ? (pt.portfolio - peak) / peak : 0
  })
}

function trimWarmup(equity: EquityCurveRow[]): { series: EquityCurveRow[]; trimmedPoints: number } {
  if (equity.length < 3) return { series: equity, trimmedPoints: 0 }

  const startNav = equity[0].portfolio
  const firstActiveIdx = equity.findIndex((pt) => Math.abs(pt.portfolio - startNav) > 1e-9)
  if (firstActiveIdx <= 0) return { series: equity, trimmedPoints: 0 }

  const series = equity.slice(firstActiveIdx)
  if (series.length < 2) return { series: equity, trimmedPoints: 0 }
  return { series, trimmedPoints: firstActiveIdx }
}

const STRATEGY_LABELS: Record<string, string> = {
  equal_weight: "Equal Weight",
  momentum_12_1: "Momentum 12-1",
  ml_ridge: "ML Ridge",
  ml_lightgbm: "ML LightGBM",
  low_vol: "Low Volatility",
  trend_filter: "Trend Filter",
}

function buildReportHtml(params: {
  runName: string
  strategyId: string
  startDate: string
  endDate: string
  generatedAt: string
  benchmarkTicker: string
  benchmarkOverlapDetected: boolean
  metrics: RunMetricsRow
  equityCurve: EquityCurveRow[]
  universe: string
  universeSymbols: string[] | null
  costsBps: number
  topN: number
  runParams: Record<string, unknown>
}): string {
  const {
    runName,
    strategyId,
    startDate,
    endDate,
    generatedAt,
    benchmarkTicker,
    benchmarkOverlapDetected,
    metrics,
    equityCurve,
    universe,
    universeSymbols,
    costsBps,
    topN,
    runParams,
  } = params

  const strategyLabel = STRATEGY_LABELS[strategyId] ?? strategyId
  const { series: chartSeries, trimmedPoints } = trimWarmup(equityCurve)
  const drawdown = computeDrawdownSeries(chartSeries)
  const portfolioSeries = chartSeries.map((pt) => pt.portfolio)
  const benchmarkSeries = chartSeries.map((pt) => pt.benchmark)

  // ── Chart dimensions ───────────────────────────────────────────────────────
  const eqWidth = 1040
  const eqHeight = 340
  const ddWidth = 1040
  const ddHeight = 260
  const pad = 16

  // Equity chart: shared scale so both lines are directly comparable on one y-axis.
  const eqPadLeft = 66
  const allEquityPoints = [...portfolioSeries, ...benchmarkSeries]
  const eqMin = allEquityPoints.length > 0 ? Math.min(...allEquityPoints) : 0
  const eqMax = allEquityPoints.length > 0 ? Math.max(...allEquityPoints) : 1
  const portfolioLine = makePolylineShared(portfolioSeries, eqMin, eqMax, eqWidth, eqHeight, pad, eqPadLeft)
  const benchmarkLine = makePolylineShared(benchmarkSeries, eqMin, eqMax, eqWidth, eqHeight, pad, eqPadLeft)

  // Drawdown chart: wider left margin for y-axis labels.
  const ddPadLeft = 46
  const drawdownLine = makePolyline(drawdown, ddWidth, ddHeight, pad, ddPadLeft)
  const drawdownMax = Math.min(...drawdown, 0) // ≤ 0

  const first = chartSeries[0]
  const last = chartSeries[chartSeries.length - 1]

  // ── X-axis date context ────────────────────────────────────────────────────
  const chartDates = chartSeries.map((pt) => pt.date)
  const xDateStart = chartDates[0] ?? ""
  const xDateMid = chartDates[Math.floor(chartDates.length / 2)] ?? ""
  const xDateEnd = chartDates[chartDates.length - 1] ?? ""

  const eqXAxis = `<div style="display:flex;justify-content:space-between;font-size:10px;color:#475569;padding:2px 16px 0 ${eqPadLeft}px;font-family:inherit;">`
    + `<span>${escapeHtml(xDateStart)}</span>`
    + `<span>${escapeHtml(xDateMid)}</span>`
    + `<span>${escapeHtml(xDateEnd)}</span>`
    + `</div>`

  const ddXAxis = `<div style="display:flex;justify-content:space-between;font-size:10px;color:#475569;padding:2px 16px 0 ${ddPadLeft}px;font-family:inherit;">`
    + `<span>${escapeHtml(xDateStart)}</span>`
    + `<span>${escapeHtml(xDateMid)}</span>`
    + `<span>${escapeHtml(xDateEnd)}</span>`
    + `</div>`

  // ── Equity chart y-axis SVG labels (shared scale) ─────────────────────────
  // top of data area y=pad → eqMax; bottom y=height-pad → eqMin
  const eqYMid = (eqMin + eqMax) / 2
  const eqYAxisLabels = [
    `<text x="${eqPadLeft - 4}" y="${pad + 4}" text-anchor="end" font-size="9" fill="#94a3b8">${escapeHtml(fmtMoneyCompact(eqMax))}</text>`,
    `<text x="${eqPadLeft - 4}" y="${(eqHeight / 2).toFixed(0)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="#94a3b8">${escapeHtml(fmtMoneyCompact(eqYMid))}</text>`,
    `<text x="${eqPadLeft - 4}" y="${eqHeight - pad - 4}" text-anchor="end" dominant-baseline="auto" font-size="9" fill="#94a3b8">${escapeHtml(fmtMoneyCompact(eqMin))}</text>`,
  ].join("\n        ")

  // ── Drawdown chart y-axis SVG labels ──────────────────────────────────────
  // top y=pad → 0%; bottom y=height-pad → drawdownMax (most negative → shown as positive magnitude)
  const ddWorstMag = Math.abs(drawdownMax)
  const ddMidMag = ddWorstMag / 2
  const ddYAxisLabels = [
    `<text x="${ddPadLeft - 4}" y="${pad + 4}" text-anchor="end" font-size="9" fill="#94a3b8">0%</text>`,
    `<text x="${ddPadLeft - 4}" y="${(ddHeight / 2).toFixed(0)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="#94a3b8">${escapeHtml(fmtPercent(ddMidMag))}</text>`,
    `<text x="${ddPadLeft - 4}" y="${ddHeight - pad - 4}" text-anchor="end" dominant-baseline="auto" font-size="9" fill="#94a3b8">${escapeHtml(fmtPercent(ddWorstMag))}</text>`,
  ].join("\n        ")

  // ── Cost drag calculations ─────────────────────────────────────────────────
  // turnover is a fraction (e.g. 0.08 = 8% one-way per rebalance)
  // cost_rate = costs_bps / 10_000 (e.g. 10 bps → 0.001)
  const turnoverFrac = metrics.turnover
  const costRate = costsBps / 10_000
  const perRebalanceCostDrag = turnoverFrac * costRate
  const annualizedCostDrag = perRebalanceCostDrag * 12 // monthly → ×12

  // ── Run-params extraction (best-effort; older runs may lack these fields) ──
  const initialCapital = typeof runParams.initial_capital === "number" ? runParams.initial_capital : null
  const applyCosts = typeof runParams.apply_costs === "boolean" ? runParams.apply_costs : null
  const slippageBps = typeof runParams.slippage_bps === "number" ? runParams.slippage_bps : null
  // Intended cost rate before the apply_costs flag was applied
  const intendedCostsBps = typeof runParams.costs_bps === "number" ? runParams.costs_bps : costsBps

  const costsDisplay = applyCosts === false
    ? `${intendedCostsBps} bps configured, costs disabled (effective: 0 bps)`
    : `${costsBps} bps${applyCosts === true ? " (applied)" : ""}`

  // ── Universe metadata ──────────────────────────────────────────────────────
  const universeCount = universeSymbols?.length ?? null
  const universeLabel = universeCount !== null
    ? `${universe} (${universeCount} symbols at execution)`
    : universe

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FactorLab Report - ${escapeHtml(runName)}</title>
  <style>
    :root {
      --bg: #ffffff;
      --text: #0f172a;
      --muted: #475569;
      --border: #e2e8f0;
      --panel: #f8fafc;
      --portfolio: #0f766e;
      --benchmark: #2563eb;
      --drawdown: #b91c1c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px;
      background: var(--bg);
      color: var(--text);
      font-family: "SF Mono", "Menlo", "Consolas", monospace;
      line-height: 1.45;
    }
    .wrap { max-width: 1080px; margin: 0 auto; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    h2 { font-size: 18px; margin: 28px 0 12px; }
    p { margin: 4px 0; color: var(--muted); }
    .meta { padding: 14px; border: 1px solid var(--border); background: var(--panel); border-radius: 10px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .kpi {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      background: #fff;
    }
    .kpi .label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    .kpi .value { font-size: 20px; margin-top: 4px; color: var(--text); }
    .kpi-defs { font-size: 11px; color: var(--muted); margin-top: 10px; line-height: 1.65; border-left: 3px solid var(--border); padding-left: 10px; }
    .panel {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      background: #fff;
    }
    .legend { display: flex; gap: 18px; font-size: 12px; color: var(--muted); margin-bottom: 8px; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 10px; height: 10px; border-radius: 99px; display: inline-block; }
    ul { margin: 8px 0 0 18px; color: var(--muted); }
    li { margin: 6px 0; }
    @media (max-width: 900px) {
      body { padding: 18px; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      svg { width: 100%; height: auto; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Strategy Tearsheet</h1>
    <div class="meta">
      <p><strong>Run:</strong> ${escapeHtml(runName)}</p>
      <p><strong>Strategy:</strong> ${escapeHtml(strategyLabel)} <span style="color:var(--muted)">(${escapeHtml(strategyId)})</span></p>
      <p><strong>Benchmark:</strong> ${escapeHtml(benchmarkTicker)}</p>
      <p><strong>Window:</strong> ${escapeHtml(startDate)} to ${escapeHtml(endDate)}</p>
      <p><strong>Universe:</strong> ${escapeHtml(universeLabel)}</p>
      <p><strong>Rebalance frequency:</strong> Monthly</p>
      <p><strong>Top N:</strong> ${topN}</p>
      <p><strong>Transaction costs:</strong> ${escapeHtml(costsDisplay)}</p>
      ${typeof slippageBps === "number" && slippageBps > 0 ? `<p><strong>Slippage:</strong> ${slippageBps} bps (configured)</p>` : ""}
      ${initialCapital !== null ? `<p><strong>Initial capital:</strong> ${fmtMoney(initialCapital)}</p>` : ""}
      <p><strong>Equity curve data points:</strong> ${chartSeries.length}${trimmedPoints > 0 ? ` (${trimmedPoints} warmup point(s) excluded before first active position)` : ""}</p>
      ${benchmarkOverlapDetected ? `<p><strong>Benchmark overlap:</strong> portfolio holds ${escapeHtml(benchmarkTicker)} at some rebalances.</p>` : ""}
      <p><strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
    </div>

    <h2>KPIs</h2>
    <div class="grid">
      <div class="kpi"><div class="label">CAGR</div><div class="value">${fmtPercent(metrics.cagr)}</div></div>
      <div class="kpi"><div class="label">Sharpe</div><div class="value">${fmtRatio(metrics.sharpe)}</div></div>
      <div class="kpi"><div class="label">Max Drawdown</div><div class="value">${fmtPercent(Math.abs(metrics.max_drawdown))}</div></div>
      <div class="kpi"><div class="label">Volatility</div><div class="value">${fmtPercent(metrics.volatility)}</div></div>
      <div class="kpi"><div class="label">Win Rate</div><div class="value">${fmtPercent(metrics.win_rate)}</div></div>
      <div class="kpi"><div class="label">Profit Factor</div><div class="value">${fmtRatio(metrics.profit_factor)}</div></div>
      <div class="kpi"><div class="label">Turnover</div><div class="value">${fmtPercent(metrics.turnover)}</div></div>
      <div class="kpi"><div class="label">Calmar</div><div class="value">${fmtRatio(metrics.calmar)}</div></div>
    </div>
    <div class="kpi-defs">
      <strong>Max Drawdown</strong>: peak-to-trough decline shown as positive magnitude (e.g. 25.8% means a 25.8% drop from peak).<br />
      <strong>Win rate</strong>: % of trading days with positive portfolio return (daily granularity).<br />
      <strong>Profit factor</strong>: sum(positive daily returns) ÷ |sum(negative daily returns)| — daily granularity.<br />
      <strong>Turnover</strong>: average one-way turnover per rebalance period (fraction of portfolio replaced).
    </div>

    <h2>Equity Curve vs ${escapeHtml(benchmarkTicker)}</h2>
    <div class="panel">
      <div class="legend">
        <span><i class="dot" style="background: var(--portfolio)"></i>Portfolio</span>
        <span><i class="dot" style="background: var(--benchmark)"></i>${escapeHtml(benchmarkTicker)} (Benchmark)</span>
      </div>
      <svg viewBox="0 0 ${eqWidth} ${eqHeight}" width="${eqWidth}" height="${eqHeight}" role="img" aria-label="Equity curve chart">
        <rect x="0" y="0" width="${eqWidth}" height="${eqHeight}" fill="#ffffff" />
        ${eqYAxisLabels}
        <polyline fill="none" stroke="var(--benchmark)" stroke-width="2" points="${benchmarkLine}" />
        <polyline fill="none" stroke="var(--portfolio)" stroke-width="3" points="${portfolioLine}" />
      </svg>
      ${eqXAxis}
      <p style="margin-top:6px;"><strong>Start NAV:</strong> ${fmtMoney(first?.portfolio ?? 0)} | <strong>End NAV:</strong> ${fmtMoney(last?.portfolio ?? 0)}</p>
      <p><strong>Benchmark End:</strong> ${fmtMoney(last?.benchmark ?? 0)}</p>
      ${trimmedPoints > 0 ? `<p><strong>Warmup:</strong> Excluded first ${trimmedPoints} trading day(s) before first rebalance/active position.</p>` : ""}
    </div>

    <h2>Drawdown</h2>
    <div class="panel">
      <svg viewBox="0 0 ${ddWidth} ${ddHeight}" width="${ddWidth}" height="${ddHeight}" role="img" aria-label="Drawdown chart">
        <rect x="0" y="0" width="${ddWidth}" height="${ddHeight}" fill="#ffffff" />
        ${ddYAxisLabels}
        <polyline fill="none" stroke="var(--drawdown)" stroke-width="2.5" points="${drawdownLine}" />
      </svg>
      ${ddXAxis}
      <p style="margin-top:6px;"><strong>Worst Drawdown:</strong> ${fmtPercent(Math.abs(drawdownMax))} (positive magnitude; peak-to-trough decline)</p>
    </div>

    <h2>Turnover and Cost Assumptions</h2>
    <div class="panel">
      <ul>
        <li>Turnover shown is average one-way turnover per rebalance period (fraction of portfolio replaced).</li>
        <li>Transaction cost rate: ${costsBps} bps per 100% one-way turnover (cost_rate = ${(costRate * 100).toFixed(4)}%).</li>
        <li>Per-rebalance cost drag: ${fmtCostDrag(perRebalanceCostDrag)} (= ${fmtPercent(turnoverFrac, 2)} turnover × ${costsBps} bps).</li>
        <li>Annualized cost drag (monthly rebalancing, 12 periods/year): ${fmtCostDrag(annualizedCostDrag)}.</li>
        ${costsBps === 0 ? "<li>Note: no transaction costs were applied in this run (effective costs_bps = 0).</li>" : ""}
        <li>Slippage${slippageBps !== null && slippageBps > 0 ? `: ${slippageBps} bps configured` : " not modeled"}. No explicit market impact model applied.</li>
      </ul>
    </div>

    ${strategyId === "trend_filter" ? `
    <h2>Strategy Methodology</h2>
    <div class="panel">
      <ul>
        <li>Risk-on when benchmark &gt; 200D SMA; risk-off allocates to TLT.</li>
        <li>Risk-on holdings: top 50% of universe by Momentum 12-1 score (positive scores only). Falls back to equal-weight universe when no asset qualifies.</li>
        <li>Risk-off defensive asset: TLT (falls back to BIL if TLT data is unavailable).</li>
        <li>Regime transitions generate near-full-portfolio turnover; sustained regimes produce normal momentum-level turnover.</li>
      </ul>
    </div>
    ` : ""}

    <h2>Limitations</h2>
    <div class="panel">
      <ul>
        <li>Backtest outputs are historical simulations and not investment advice.</li>
        <li>Corporate actions, borrow costs, taxes, and liquidity constraints may not be fully modeled.</li>
        <li>Survivorship bias and look-ahead bias controls depend on the underlying data pipeline.</li>
        <li>Use out-of-sample validation and stress testing before deployment.</li>
      </ul>
    </div>
  </div>
</body>
</html>`
}

export async function ensureRunReport(runId: string): Promise<void> {
  // Verify the caller owns this run
  const serverClient = await createClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) {
    throw new Error("Authentication required.")
  }

  const supabase = createAdminClient()

  // Confirm ownership before generating
  const { data: ownerCheck, error: ownerError } = await supabase
    .from("runs")
    .select("id")
    .eq("id", runId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (ownerError || !ownerCheck) {
    throw new Error("Run not found or access denied.")
  }

  const [
    { data: run, error: runError },
    { data: metrics, error: metricsError },
    { data: equity, error: equityError },
  ] = await Promise.all([
    supabase
      .from("runs")
      .select("*")
      .eq("id", runId)
      .maybeSingle(),
    supabase
      .from("run_metrics")
      .select("*")
      .eq("run_id", runId)
      .maybeSingle(),
    supabase
      .from("equity_curve")
      .select("*")
      .eq("run_id", runId)
      .order("date", { ascending: true }),
  ])

  if (runError || !run) {
    throw new Error(`Failed to load run: ${runError?.message ?? "not found"}`)
  }
  if (metricsError || !metrics) {
    throw new Error(`Failed to load run metrics: ${metricsError?.message ?? "not found"}`)
  }
  if (equityError) {
    throw new Error(`Failed to load equity curve: ${equityError.message}`)
  }
  const runRow = run as RunRow
  const benchmarkTicker = getRunBenchmark(runRow)
  const overlapState = await getBenchmarkOverlapStateForRun(runRow)
  let benchmarkOverlapDetected = overlapState.confirmed
  if (!benchmarkOverlapDetected) {
    const { data: overlapRows, error: overlapError } = await supabase
      .from("positions")
      .select("date")
      .eq("run_id", runId)
      .eq("symbol", benchmarkTicker)
      .gt("weight", 0)
      .limit(1)
    if (!overlapError || isMissingPositionsTableError(overlapError.message)) {
      if ((overlapRows?.length ?? 0) > 0) {
        benchmarkOverlapDetected = true
      }
    } else {
      console.error("ensureRunReport overlap query error:", overlapError.message)
    }
  }
  if (runRow.status !== "completed") {
    throw new Error("Report generation is only available for completed runs")
  }

  if (!equity || equity.length === 0) {
    throw new Error("Missing equity curve data")
  }

  // Safely extract run_params fields (best-effort; older runs may lack them)
  const runParamsObj =
    typeof runRow.run_params === "object" &&
    runRow.run_params !== null &&
    !Array.isArray(runRow.run_params)
      ? (runRow.run_params as Record<string, unknown>)
      : {}

  const html = buildReportHtml({
    runName: runRow.name,
    strategyId: runRow.strategy_id,
    startDate: runRow.start_date,
    endDate: runRow.end_date,
    generatedAt: new Date().toISOString(),
    benchmarkTicker,
    benchmarkOverlapDetected,
    metrics: metrics as RunMetricsRow,
    equityCurve: equity as EquityCurveRow[],
    universe: runRow.universe ?? "",
    universeSymbols: runRow.universe_symbols,
    costsBps: runRow.costs_bps ?? 0,
    topN: runRow.top_n ?? 0,
    runParams: runParamsObj,
  })

  const storagePath = `${runId}/tearsheet.html`
  const fileData = new Blob([html], { type: "text/html; charset=utf-8" })

  let { error: uploadError } = await supabase.storage
    .from(REPORTS_BUCKET)
    .upload(storagePath, fileData, {
      upsert: true,
      contentType: "text/html; charset=utf-8",
    })

  if (uploadError && uploadError.message.toLowerCase().includes("bucket")) {
    const { error: createBucketError } = await supabase.storage.createBucket(
      REPORTS_BUCKET,
      { public: true }
    )
    if (createBucketError) {
      throw new Error(`Failed to create reports bucket: ${createBucketError.message}`)
    }
    const retry = await supabase.storage.from(REPORTS_BUCKET).upload(storagePath, fileData, {
      upsert: true,
      contentType: "text/html; charset=utf-8",
    })
    uploadError = retry.error
  }

  if (uploadError) {
    throw new Error(`Failed to upload report: ${uploadError.message}`)
  }

  const { data: urlData } = supabase.storage
    .from(REPORTS_BUCKET)
    .getPublicUrl(storagePath)

  const { error: reportError } = await supabase.from("reports").upsert(
    {
      run_id: runId,
      storage_path: storagePath,
      url: urlData.publicUrl,
    },
    { onConflict: "run_id" }
  )

  if (reportError) {
    throw new Error(`Failed to persist report row: ${reportError.message}`)
  }
}

export async function generateRunReport(runId: string) {
  await ensureRunReport(runId)
  revalidatePath(`/runs/${runId}`)
  redirect(`/runs/${runId}`)
}
