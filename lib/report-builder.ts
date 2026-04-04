import type { EquityCurveRow, RunMetricsRow } from "@/lib/supabase/types";
import {
  DEFAULT_EQUITY_CHART_MAX_POINTS,
  getChartDateLabels,
  getDownsampleIndices,
  pickByIndices,
} from "@/lib/equity-curve";

// ── Formatters ─────────────────────────────────────────────────────────────

export function fmtPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function fmtRatio(value: number, digits = 2): string {
  return value.toFixed(digits);
}

export function fmtMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** Compact money for SVG axis labels: $100K, $1.2M, etc. */
export function fmtMoneyCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

/**
 * Format a cost drag fraction as a percentage.
 * Avoids misleading "0.00%" for small but non-zero values.
 */
export function fmtCostDrag(value: number): string {
  if (value === 0) return "0.00%";
  const pct = value * 100;
  if (pct < 0.005) return "<0.01%";
  if (pct < 0.01) return `${pct.toFixed(3)}%`;
  return `${pct.toFixed(2)}%`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ── SVG helpers ────────────────────────────────────────────────────────────

/**
 * Map a series of values to SVG polyline points using each series' own min/max scale.
 * padLeft defaults to pad (symmetric), allowing a wider left margin for y-axis labels.
 */
export function makePolyline(
  points: number[],
  width: number,
  height: number,
  pad = 16,
  padLeft = pad
): string {
  if (points.length === 0) return "";
  const min = Math.min(...points);
  const max = Math.max(...points);
  const ySpan = max - min || 1;
  const xSpan = Math.max(points.length - 1, 1);
  return points
    .map((v, i) => {
      const x = padLeft + (i / xSpan) * (width - padLeft - pad);
      const y = height - pad - ((v - min) / ySpan) * (height - pad * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/**
 * Like makePolyline but uses a caller-supplied shared [min, max] scale.
 * Both portfolio and benchmark lines must use the same min/max to be comparable.
 */
export function makePolylineShared(
  points: number[],
  min: number,
  max: number,
  width: number,
  height: number,
  pad = 16,
  padLeft = pad
): string {
  if (points.length === 0) return "";
  const ySpan = max - min || 1;
  const xSpan = Math.max(points.length - 1, 1);
  return points
    .map((v, i) => {
      const x = padLeft + (i / xSpan) * (width - padLeft - pad);
      const y = height - pad - ((v - min) / ySpan) * (height - pad * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/**
 * Compute CAGR directly from the equity curve so it is always consistent
 * with the displayed Start NAV, End NAV, and date range.
 * Uses the full raw series (n = number of trading-day rows).
 */
export function computeCAGRFromEquityCurve(raw: EquityCurveRow[]): number {
  if (raw.length < 2) return 0;
  const startNav = raw[0].portfolio;
  const endNav = raw[raw.length - 1].portfolio;
  if (!Number.isFinite(startNav) || !Number.isFinite(endNav) || startNav <= 0) return 0;
  const n = raw.length;
  return Math.pow(endNav / startNav, 252 / n) - 1;
}

export function computeDrawdownSeries(equity: EquityCurveRow[]): number[] {
  let peak = -Infinity;
  return equity.map((pt) => {
    if (pt.portfolio > peak) peak = pt.portfolio;
    return peak > 0 ? (pt.portfolio - peak) / peak : 0;
  });
}

export function getWarmupPointCount(equity: EquityCurveRow[]): number {
  if (equity.length < 3) return 0;

  const startNav = equity[0].portfolio;
  const firstActiveIdx = equity.findIndex((pt) => Math.abs(pt.portfolio - startNav) > 1e-9);
  return firstActiveIdx > 0 ? firstActiveIdx : 0;
}

// ── Metadata ───────────────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<string, string> = {
  equal_weight: "Equal Weight",
  momentum_12_1: "Momentum 12-1",
  ml_ridge: "ML Ridge",
  ml_lightgbm: "ML LightGBM",
  low_vol: "Low Volatility",
  trend_filter: "Trend Filter",
};

const ML_STRATEGIES = new Set(["ml_ridge", "ml_lightgbm"]);

const PERIODS_PER_YEAR: Record<string, number> = {
  Daily: 252,
  Weekly: 52,
  Monthly: 12,
  Quarterly: 4,
};

export type RunMetadataView = {
  modelImpl: string | null;
  modelVersion: string | null;
  featureSet: string | null;
  randomSeed: string | null;
  determinismMode: string | null;
  lightgbmVersion: string | null;
  dataSnapshotMode: string | null;
  dataSnapshotCutoff: string | null;
  dataSnapshotDigest: string | null;
  runtimeDownloadUsed: boolean | null;
  predictionsDigest: string | null;
  positionsDigest: string | null;
  equityDigest: string | null;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringish(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function parseRunMetadata(value: unknown): RunMetadataView {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      modelImpl: null,
      modelVersion: null,
      featureSet: null,
      randomSeed: null,
      determinismMode: null,
      lightgbmVersion: null,
      dataSnapshotMode: null,
      dataSnapshotCutoff: null,
      dataSnapshotDigest: null,
      runtimeDownloadUsed: null,
      predictionsDigest: null,
      positionsDigest: null,
      equityDigest: null,
    };
  }
  const v = value as Record<string, unknown>;
  return {
    modelImpl: readString(v.model_impl),
    modelVersion: readString(v.model_version),
    featureSet: readString(v.feature_set),
    randomSeed: readStringish(v.random_seed),
    determinismMode: readString(v.determinism_mode),
    lightgbmVersion: readString(v.lightgbm_version),
    dataSnapshotMode: readString(v.data_snapshot_mode),
    dataSnapshotCutoff: readString(v.data_snapshot_cutoff),
    dataSnapshotDigest: readString(v.data_snapshot_digest),
    runtimeDownloadUsed: typeof v.runtime_download_used === "boolean" ? v.runtime_download_used : null,
    predictionsDigest: readString(v.predictions_digest),
    positionsDigest: readString(v.positions_digest),
    equityDigest: readString(v.equity_digest),
  };
}

// ── HTML builder ───────────────────────────────────────────────────────────

export function buildReportHtml(params: {
  runName: string;
  strategyId: string;
  startDate: string;
  endDate: string;
  generatedAt: string;
  benchmarkTicker: string;
  benchmarkOverlapDetected: boolean;
  metrics: RunMetricsRow;
  equityCurve: EquityCurveRow[];
  universe: string;
  universeSymbols: string[] | null;
  costsBps: number;
  topN: number;
  runParams: Record<string, unknown>;
  runMetadata: RunMetadataView;
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
    runMetadata,
  } = params;

  const strategyLabel = STRATEGY_LABELS[strategyId] ?? strategyId;
  const warmupPoints = getWarmupPointCount(equityCurve);
  const chartRawSeries = equityCurve;
  // CAGR derived from the equity curve — always consistent with displayed Start/End NAV
  const chartCagr = computeCAGRFromEquityCurve(chartRawSeries);
  // Effective window: use actual equity-curve dates, not the run-param request dates
  const effectiveStart = chartRawSeries[0]?.date ?? startDate;
  const effectiveEnd = chartRawSeries[chartRawSeries.length - 1]?.date ?? endDate;
  const windowDisplay = `${effectiveStart} to ${effectiveEnd}`;
  const plottedIndices = getDownsampleIndices(
    chartRawSeries.length,
    DEFAULT_EQUITY_CHART_MAX_POINTS
  );
  const chartSeries = pickByIndices(chartRawSeries, plottedIndices);
  const rawDrawdown = computeDrawdownSeries(chartRawSeries);
  const drawdown = pickByIndices(rawDrawdown, plottedIndices);
  const portfolioSeries = chartSeries.map((pt) => pt.portfolio);
  const benchmarkSeries = chartSeries.map((pt) => pt.benchmark);

  // ── Rebalance frequency + cost periods ────────────────────────────────────
  const rebalanceFreq = ML_STRATEGIES.has(strategyId)
    ? "Daily"
    : typeof runParams.rebalance_frequency === "string" && runParams.rebalance_frequency
      ? runParams.rebalance_frequency
      : "Monthly";
  const periods = PERIODS_PER_YEAR[rebalanceFreq] ?? 12;

  // ── Chart dimensions ───────────────────────────────────────────────────────
  const eqWidth = 1040;
  const eqHeight = 340;
  const ddWidth = 1040;
  const ddHeight = 260;
  const pad = 16;

  // Equity chart: shared scale so both lines are directly comparable on one y-axis.
  const eqPadLeft = 66;
  const rawPortfolioSeries = chartRawSeries.map((pt) => pt.portfolio);
  const rawBenchmarkSeries = chartRawSeries.map((pt) => pt.benchmark);
  const allEquityPoints = [...rawPortfolioSeries, ...rawBenchmarkSeries];
  const eqMin = allEquityPoints.length > 0 ? Math.min(...allEquityPoints) : 0;
  const eqMax = allEquityPoints.length > 0 ? Math.max(...allEquityPoints) : 1;
  const portfolioLine = makePolylineShared(
    portfolioSeries,
    eqMin,
    eqMax,
    eqWidth,
    eqHeight,
    pad,
    eqPadLeft
  );
  const benchmarkLine = makePolylineShared(
    benchmarkSeries,
    eqMin,
    eqMax,
    eqWidth,
    eqHeight,
    pad,
    eqPadLeft
  );

  // Drawdown chart: wider left margin for y-axis labels.
  const ddPadLeft = 46;
  const drawdownMax = Math.min(...rawDrawdown, 0); // <= 0
  const drawdownLine = makePolylineShared(
    drawdown,
    drawdownMax,
    0,
    ddWidth,
    ddHeight,
    pad,
    ddPadLeft
  );

  const first = chartSeries[0];
  const last = chartSeries[chartSeries.length - 1];

  // ── X-axis date context ────────────────────────────────────────────────────
  const { start: xDateStart, mid: xDateMid, end: xDateEnd } = getChartDateLabels(chartSeries);

  const eqXAxis =
    `<div style="display:flex;justify-content:space-between;font-size:10px;color:#475569;padding:2px 16px 0 ${eqPadLeft}px;font-family:inherit;">` +
    `<span>${escapeHtml(xDateStart)}</span>` +
    `<span>${escapeHtml(xDateMid)}</span>` +
    `<span>${escapeHtml(xDateEnd)}</span>` +
    `</div>`;

  const ddXAxis =
    `<div style="display:flex;justify-content:space-between;font-size:10px;color:#475569;padding:2px 16px 0 ${ddPadLeft}px;font-family:inherit;">` +
    `<span>${escapeHtml(xDateStart)}</span>` +
    `<span>${escapeHtml(xDateMid)}</span>` +
    `<span>${escapeHtml(xDateEnd)}</span>` +
    `</div>`;

  // ── Equity chart y-axis SVG labels (shared scale) ─────────────────────────
  // top of data area y=pad -> eqMax; bottom y=height-pad -> eqMin
  const eqYMid = (eqMin + eqMax) / 2;
  const eqYAxisLabels = [
    `<text x="${eqPadLeft - 4}" y="${pad + 4}" text-anchor="end" font-size="9" fill="#94a3b8">${escapeHtml(fmtMoneyCompact(eqMax))}</text>`,
    `<text x="${eqPadLeft - 4}" y="${(eqHeight / 2).toFixed(0)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="#94a3b8">${escapeHtml(fmtMoneyCompact(eqYMid))}</text>`,
    `<text x="${eqPadLeft - 4}" y="${eqHeight - pad - 4}" text-anchor="end" dominant-baseline="auto" font-size="9" fill="#94a3b8">${escapeHtml(fmtMoneyCompact(eqMin))}</text>`,
  ].join("\n        ");

  // ── Drawdown chart y-axis SVG labels ──────────────────────────────────────
  // top y=pad -> 0%; bottom y=height-pad -> drawdownMax (most negative -> shown as positive magnitude)
  const ddWorstMag = Math.abs(drawdownMax);
  const ddMidMag = ddWorstMag / 2;
  const ddYAxisLabels = [
    `<text x="${ddPadLeft - 4}" y="${pad + 4}" text-anchor="end" font-size="9" fill="#94a3b8">0%</text>`,
    `<text x="${ddPadLeft - 4}" y="${(ddHeight / 2).toFixed(0)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="#94a3b8">${escapeHtml(fmtPercent(ddMidMag))}</text>`,
    `<text x="${ddPadLeft - 4}" y="${ddHeight - pad - 4}" text-anchor="end" dominant-baseline="auto" font-size="9" fill="#94a3b8">${escapeHtml(fmtPercent(ddWorstMag))}</text>`,
  ].join("\n        ");

  // ── Cost drag calculations ─────────────────────────────────────────────────
  // turnover is a fraction (e.g. 0.08 = 8% one-way per rebalance)
  // cost_rate = costs_bps / 10_000 (e.g. 10 bps -> 0.001)
  const turnoverFrac = metrics.turnover;
  const costRate = costsBps / 10_000;
  const perRebalanceCostDrag = turnoverFrac * costRate;
  const annualizedCostDrag = perRebalanceCostDrag * periods;

  // ── Run-params extraction (best-effort; older runs may lack these fields) ──
  const initialCapital =
    typeof runParams.initial_capital === "number" ? runParams.initial_capital : null;
  const applyCosts = typeof runParams.apply_costs === "boolean" ? runParams.apply_costs : null;
  const slippageBps = typeof runParams.slippage_bps === "number" ? runParams.slippage_bps : null;
  // Intended cost rate before the apply_costs flag was applied
  const intendedCostsBps = typeof runParams.costs_bps === "number" ? runParams.costs_bps : costsBps;

  const costsDisplay =
    applyCosts === false
      ? `${intendedCostsBps} bps configured, costs disabled (effective: 0 bps)`
      : `${costsBps} bps${applyCosts === true ? " (applied)" : ""}`;

  // ── Universe metadata ──────────────────────────────────────────────────────
  const universeCount = universeSymbols?.length ?? null;
  const universeLabel =
    universeCount !== null ? `${universe} (${universeCount} symbols at execution)` : universe;

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
      ${runMetadata.modelImpl ? `<p><strong>Model impl:</strong> ${escapeHtml(runMetadata.modelImpl)}</p>` : ""}
      ${runMetadata.modelVersion ? `<p><strong>Model version:</strong> ${escapeHtml(runMetadata.modelVersion)}</p>` : ""}
      ${runMetadata.featureSet ? `<p><strong>Feature set:</strong> ${escapeHtml(runMetadata.featureSet)}</p>` : ""}
      ${runMetadata.randomSeed ? `<p><strong>Random seed:</strong> ${escapeHtml(runMetadata.randomSeed)}</p>` : ""}
      ${runMetadata.determinismMode ? `<p><strong>Determinism mode:</strong> ${escapeHtml(runMetadata.determinismMode)}</p>` : ""}
      ${runMetadata.lightgbmVersion ? `<p><strong>LightGBM version:</strong> ${escapeHtml(runMetadata.lightgbmVersion)}</p>` : ""}
      ${runMetadata.dataSnapshotMode ? `<p><strong>Snapshot mode:</strong> ${escapeHtml(runMetadata.dataSnapshotMode)}</p>` : ""}
      ${runMetadata.dataSnapshotCutoff ? `<p><strong>Snapshot cutoff:</strong> ${escapeHtml(runMetadata.dataSnapshotCutoff)}</p>` : ""}
      ${runMetadata.dataSnapshotDigest ? `<p><strong>Snapshot digest:</strong> <span style="font-size:12px">${escapeHtml(runMetadata.dataSnapshotDigest.slice(0, 16))}</span></p>` : ""}
      ${runMetadata.runtimeDownloadUsed !== null ? `<p><strong>Runtime download used:</strong> ${runMetadata.runtimeDownloadUsed ? "Yes" : "No"}</p>` : ""}
      <p><strong>Benchmark:</strong> ${escapeHtml(benchmarkTicker)}</p>
      <p><strong>Window:</strong> ${escapeHtml(windowDisplay)}</p>
      <p><strong>Universe:</strong> ${escapeHtml(universeLabel)}</p>
      <p><strong>Rebalance frequency:</strong> ${escapeHtml(rebalanceFreq)}</p>
      <p><strong>Top N:</strong> ${topN}</p>
      <p><strong>Transaction costs:</strong> ${escapeHtml(costsDisplay)}</p>
      ${typeof slippageBps === "number" && slippageBps > 0 ? `<p><strong>Slippage:</strong> ${slippageBps} bps (configured)</p>` : ""}
      ${initialCapital !== null ? `<p><strong>Initial capital:</strong> ${fmtMoney(initialCapital)}</p>` : ""}
      <p><strong>Equity curve points:</strong> ${chartSeries.length}${chartSeries.length < chartRawSeries.length ? ` (from ${chartRawSeries.length} raw)` : ""}</p>
      ${warmupPoints > 0 ? `<p><strong>Warmup before first active position:</strong> ${warmupPoints} trading day(s) at starting NAV.</p>` : ""}
      ${benchmarkOverlapDetected ? `<p><strong>Benchmark overlap:</strong> portfolio holds ${escapeHtml(benchmarkTicker)} at some rebalances.</p>` : ""}
      ${universeSymbols?.includes("GOOGL") && universeSymbols?.includes("GOOG") ? `<p><strong>Dual-class shares:</strong> GOOGL and GOOG are both held &mdash; these are dual-class shares of Alphabet Inc. and move nearly identically; their combined weight is roughly double a single-class holding.</p>` : ""}
      ${runMetadata.predictionsDigest ? `<p><strong>Predictions digest:</strong> <span style="font-size:12px">${escapeHtml(runMetadata.predictionsDigest.slice(0, 16))}</span></p>` : ""}
      ${runMetadata.positionsDigest ? `<p><strong>Positions digest:</strong> <span style="font-size:12px">${escapeHtml(runMetadata.positionsDigest.slice(0, 16))}</span></p>` : ""}
      ${runMetadata.equityDigest ? `<p><strong>Equity digest:</strong> <span style="font-size:12px">${escapeHtml(runMetadata.equityDigest.slice(0, 16))}</span></p>` : ""}
      <p><strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
    </div>

    <h2>KPIs</h2>
    <div class="grid">
      <div class="kpi"><div class="label">CAGR</div><div class="value">${fmtPercent(chartCagr)}</div></div>
      <div class="kpi"><div class="label">Sharpe</div><div class="value">${fmtRatio(metrics.sharpe)}</div></div>
      <div class="kpi"><div class="label">Max Drawdown (peak-to-trough)</div><div class="value">${fmtPercent(Math.abs(metrics.max_drawdown))}</div></div>
      <div class="kpi"><div class="label">Volatility</div><div class="value">${fmtPercent(metrics.volatility)}</div></div>
      <div class="kpi"><div class="label">Win Rate</div><div class="value">${fmtPercent(metrics.win_rate)}</div></div>
      <div class="kpi"><div class="label">Profit Factor</div><div class="value">${fmtRatio(metrics.profit_factor)}</div></div>
      <div class="kpi"><div class="label">Turnover</div><div class="value">${fmtPercent(metrics.turnover)}</div></div>
      <div class="kpi"><div class="label">Calmar</div><div class="value">${fmtRatio(metrics.calmar)}</div></div>
    </div>
    <div class="kpi-defs">
      <strong>Max Drawdown</strong>: peak-to-trough decline shown as positive magnitude (e.g. 25.8% means a 25.8% drop from peak).<br />
      <strong>Win rate</strong>: % of trading days with positive portfolio return (daily granularity).<br />
      <strong>Profit factor</strong>: sum(positive daily returns) &divide; |sum(negative daily returns)| &mdash; daily granularity.<br />
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
      ${warmupPoints > 0 ? `<p><strong>Warmup:</strong> First ${warmupPoints} trading day(s) remained at starting NAV before the first active position.</p>` : ""}
    </div>

    <h2>Drawdown</h2>
    <div class="panel">
      <svg viewBox="0 0 ${ddWidth} ${ddHeight}" width="${ddWidth}" height="${ddHeight}" role="img" aria-label="Drawdown chart">
        <rect x="0" y="0" width="${ddWidth}" height="${ddHeight}" fill="#ffffff" />
        ${ddYAxisLabels}
        <polyline fill="none" stroke="var(--drawdown)" stroke-width="2.5" points="${drawdownLine}" />
      </svg>
      ${ddXAxis}
      <p style="margin-top:6px;"><strong>Worst Drawdown (peak-to-trough):</strong> ${fmtPercent(Math.abs(drawdownMax))} (positive magnitude; peak-to-trough decline)</p>
    </div>

    <h2>Turnover and Cost Assumptions</h2>
    <div class="panel">
      <ul>
        <li>Turnover shown is average one-way turnover per rebalance period (fraction of portfolio replaced).</li>
        <li>Transaction cost rate: ${costsBps} bps per 100% one-way turnover (cost_rate = ${(costRate * 100).toFixed(4)}%).</li>
        <li>Per-rebalance cost drag: ${fmtCostDrag(perRebalanceCostDrag)} (= ${fmtPercent(turnoverFrac, 2)} turnover &times; ${costsBps} bps).</li>
        <li>Annualized cost drag (${escapeHtml(rebalanceFreq.toLowerCase())} rebalancing, ${periods} periods/year): ${fmtCostDrag(annualizedCostDrag)}.</li>
        ${costsBps === 0 ? "<li>Note: no transaction costs were applied in this run (effective costs_bps = 0).</li>" : ""}
        <li>Slippage${slippageBps !== null && slippageBps > 0 ? `: ${slippageBps} bps configured` : " not modeled"}. No explicit market impact model applied.</li>
      </ul>
    </div>

    ${
      strategyId === "trend_filter"
        ? `
    <h2>Strategy Methodology</h2>
    <div class="panel">
      <ul>
        <li>Risk-on when benchmark &gt; 200D SMA; risk-off allocates to TLT.</li>
        <li>Risk-on holdings: top 50% of universe by Momentum 12-1 score (positive scores only). Falls back to equal-weight universe when no asset qualifies.</li>
        <li>Risk-off defensive asset: TLT (falls back to BIL if TLT data is unavailable).</li>
        <li>Regime transitions generate near-full-portfolio turnover; sustained regimes produce normal momentum-level turnover.</li>
      </ul>
    </div>
    `
        : ""
    }

    <h2>Limitations</h2>
    <div class="panel">
      <p>Research only &mdash; not financial advice. Results are simulated and may not reflect real trading. Costs/slippage are simplified; taxes, corporate actions, liquidity, and market impact are not fully modeled.</p>
      <ul>
        <li>Universe presets are static snapshots and do not account for assets delisted or replaced during the backtest window, which may overstate long-window performance.</li>
        <li>The cost model applies a flat bps &times; turnover rate and does not capture bid-ask spread, market impact, borrowing costs, or short-selling constraints.</li>
        <li>Price data is sourced from Yahoo Finance; gaps are forward-filled and significant coverage gaps may affect results.</li>
        <li>All outputs are historical simulations only &mdash; not a guarantee of future returns.</li>
      </ul>
    </div>
  </div>
</body>
</html>`;
}
