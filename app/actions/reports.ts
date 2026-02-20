"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import type { EquityCurveRow, RunMetricsRow, RunRow } from "@/lib/supabase/queries"

const REPORTS_BUCKET = process.env.SUPABASE_REPORTS_BUCKET ?? "reports"

function fmtPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`
}

function fmtRatio(value: number, digits = 2): string {
  return value.toFixed(digits)
}

function fmtMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function makePolyline(points: number[], width: number, height: number, pad = 16): string {
  if (points.length === 0) return ""
  const min = Math.min(...points)
  const max = Math.max(...points)
  const ySpan = max - min || 1
  const xSpan = Math.max(points.length - 1, 1)
  return points
    .map((v, i) => {
      const x = pad + (i / xSpan) * (width - pad * 2)
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

function buildReportHtml(params: {
  runName: string
  strategyId: string
  startDate: string
  endDate: string
  generatedAt: string
  metrics: RunMetricsRow
  equityCurve: EquityCurveRow[]
}): string {
  const { runName, strategyId, startDate, endDate, generatedAt, metrics, equityCurve } = params
  const drawdown = computeDrawdownSeries(equityCurve)
  const portfolioSeries = equityCurve.map((pt) => pt.portfolio)
  const benchmarkSeries = equityCurve.map((pt) => pt.benchmark)
  const eqWidth = 1040
  const eqHeight = 340
  const ddWidth = 1040
  const ddHeight = 260

  const portfolioLine = makePolyline(portfolioSeries, eqWidth, eqHeight)
  const benchmarkLine = makePolyline(benchmarkSeries, eqWidth, eqHeight)
  const drawdownLine = makePolyline(drawdown, ddWidth, ddHeight)
  const drawdownMax = Math.min(...drawdown, 0)
  const first = equityCurve[0]
  const last = equityCurve[equityCurve.length - 1]

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
      <p><strong>Strategy:</strong> ${escapeHtml(strategyId)}</p>
      <p><strong>Window:</strong> ${escapeHtml(startDate)} to ${escapeHtml(endDate)}</p>
      <p><strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
    </div>

    <h2>KPIs</h2>
    <div class="grid">
      <div class="kpi"><div class="label">CAGR</div><div class="value">${fmtPercent(metrics.cagr)}</div></div>
      <div class="kpi"><div class="label">Sharpe</div><div class="value">${fmtRatio(metrics.sharpe)}</div></div>
      <div class="kpi"><div class="label">Max Drawdown</div><div class="value">${fmtPercent(metrics.max_drawdown)}</div></div>
      <div class="kpi"><div class="label">Volatility</div><div class="value">${fmtPercent(metrics.volatility)}</div></div>
      <div class="kpi"><div class="label">Win Rate</div><div class="value">${fmtPercent(metrics.win_rate)}</div></div>
      <div class="kpi"><div class="label">Profit Factor</div><div class="value">${fmtRatio(metrics.profit_factor)}</div></div>
      <div class="kpi"><div class="label">Turnover</div><div class="value">${fmtPercent(metrics.turnover)}</div></div>
      <div class="kpi"><div class="label">Calmar</div><div class="value">${fmtRatio(metrics.calmar)}</div></div>
    </div>

    <h2>Equity Curve vs SPY</h2>
    <div class="panel">
      <div class="legend">
        <span><i class="dot" style="background: var(--portfolio)"></i>Portfolio</span>
        <span><i class="dot" style="background: var(--benchmark)"></i>SPY (Benchmark)</span>
      </div>
      <svg viewBox="0 0 ${eqWidth} ${eqHeight}" width="${eqWidth}" height="${eqHeight}" role="img" aria-label="Equity curve chart">
        <rect x="0" y="0" width="${eqWidth}" height="${eqHeight}" fill="#ffffff" />
        <polyline fill="none" stroke="var(--benchmark)" stroke-width="2" points="${benchmarkLine}" />
        <polyline fill="none" stroke="var(--portfolio)" stroke-width="3" points="${portfolioLine}" />
      </svg>
      <p><strong>Start NAV:</strong> ${fmtMoney(first?.portfolio ?? 0)} | <strong>End NAV:</strong> ${fmtMoney(last?.portfolio ?? 0)}</p>
      <p><strong>Benchmark End:</strong> ${fmtMoney(last?.benchmark ?? 0)}</p>
    </div>

    <h2>Drawdown</h2>
    <div class="panel">
      <svg viewBox="0 0 ${ddWidth} ${ddHeight}" width="${ddWidth}" height="${ddHeight}" role="img" aria-label="Drawdown chart">
        <rect x="0" y="0" width="${ddWidth}" height="${ddHeight}" fill="#ffffff" />
        <polyline fill="none" stroke="var(--drawdown)" stroke-width="2.5" points="${drawdownLine}" />
      </svg>
      <p><strong>Worst Drawdown:</strong> ${fmtPercent(drawdownMax)}</p>
    </div>

    <h2>Turnover and Cost Assumptions</h2>
    <div class="panel">
      <ul>
        <li>Turnover shown is average one-way turnover per rebalance period.</li>
        <li>Default transaction cost assumption for interpretation: 10 bps per 100% one-way turnover.</li>
        <li>Illustrative annualized cost drag: ${(metrics.turnover * 0.001 * 100).toFixed(2)}% (turnover x 10 bps).</li>
        <li>No explicit market impact or slippage model is applied in this MVP report.</li>
      </ul>
    </div>

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

export async function generateRunReport(runId: string) {
  const supabase = createAdminClient()

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
  if (runRow.status !== "completed") {
    throw new Error("Report generation is only available for completed runs")
  }

  if (!equity || equity.length === 0) {
    throw new Error("Missing equity curve data")
  }

  const html = buildReportHtml({
    runName: runRow.name,
    strategyId: runRow.strategy_id,
    startDate: runRow.start_date,
    endDate: runRow.end_date,
    generatedAt: new Date().toISOString(),
    metrics: metrics as RunMetricsRow,
    equityCurve: equity as EquityCurveRow[],
  })

  const storagePath = `${runId}/tearsheet.html`
  const fileData = new Blob([html], { type: "text/html; charset=utf-8" })

  const { error: uploadError } = await supabase.storage
    .from(REPORTS_BUCKET)
    .upload(storagePath, fileData, {
      upsert: true,
      contentType: "text/html; charset=utf-8",
    })

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

  revalidatePath(`/runs/${runId}`)
  redirect(`/runs/${runId}`)
}
