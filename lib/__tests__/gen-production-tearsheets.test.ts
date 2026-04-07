/**
 * Generate production-code tearsheets for the 6 validation runs.
 * Uses the actual buildReportHtml from lib/report-builder.ts.
 * Output written to /tmp/factorlab-validation/production-tearsheets/
 *
 * Run:  npx vitest run lib/__tests__/gen-production-tearsheets.test.ts
 */
import { describe, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { buildReportHtml } from "@/lib/report-builder";
import type { EquityCurveRow, RunMetricsRow } from "@/lib/supabase/types";
import type { TurnoverSummary } from "@/lib/turnover";

const OUT_DIR = "/tmp/factorlab-validation/production-tearsheets";
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Shared config ────────────────────────────────────────────────────────────

const RUN_START = "2021-04-05";
const RUN_END = "2026-04-02";
const UNIVERSE = "ETF8";
const UNIVERSE_SYMBOLS = ["SPY", "QQQ", "IWM", "EFA", "EEM", "TLT", "GLD", "VNQ"];
const COSTS_BPS = 10;
const TOP_N = 5;
const BENCHMARK = "SPY";
const GENERATED_AT = "2026-04-06T17:35:00.000Z";

const BASE_METADATA = {
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

// ── Synthetic equity curves (index to $100k, 1256 trading days) ─────────────

function makeEquityCurve(
  startNav: number,
  endNav: number,
  _isMl: boolean = false
): EquityCurveRow[] {
  const dates: string[] = [];
  const start = new Date(`${RUN_START}T00:00:00Z`);
  const end = new Date(`${RUN_END}T00:00:00Z`);
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    dates.push(d.toISOString().slice(0, 10));
  }

  const n = dates.length;
  const daily = Math.pow(endNav / startNav, 1 / n);
  const dailyBench = Math.pow(172799 / 100000, 1 / n);
  return dates.map((date, i) => ({
    id: `eq-${i}`,
    run_id: "val-run",
    date,
    portfolio: parseFloat((startNav * Math.pow(daily, i)).toFixed(2)),
    benchmark: parseFloat((100000 * Math.pow(dailyBench, i)).toFixed(2)),
  }));
}

// ── Turnover summaries (constituent-change from position rows, not drift-reset) ─

function makeTurnoverSummary(avgPerRebalance: number, periodsPerYear: number): TurnoverSummary {
  return {
    points: [],
    averageTurnover: avgPerRebalance,
    annualizedTurnover: avgPerRebalance * periodsPerYear,
    periodsPerYear,
  };
}

// ── Strategy configs ─────────────────────────────────────────────────────────

const STRATEGIES: Array<{
  id: string;
  name: string;
  metrics: RunMetricsRow;
  equityCurve: EquityCurveRow[];
  turnoverSummary: TurnoverSummary;
  overlapDetected: boolean;
  metadata: typeof BASE_METADATA & Record<string, unknown>;
}> = [
  {
    id: "equal_weight",
    name: "Equal Weight — ETF8/SPY/10bps/2021-04-05→2026-04-02",
    metrics: {
      id: "m1",
      run_id: "val-ew",
      cagr: 0.0787,
      sharpe: 0.6215,
      max_drawdown: -0.2692,
      turnover: 0.1389, // run-window-only corrected value
      volatility: 0.1371,
      win_rate: 0.5207,
      profit_factor: 1.1133,
      calmar: 0.2925,
    },
    equityCurve: makeEquityCurve(100000, 145903),
    turnoverSummary: makeTurnoverSummary(0.0, 12), // constituent-change = 0 for stable universe
    overlapDetected: true,
    metadata: BASE_METADATA,
  },
  {
    id: "momentum_12_1",
    name: "Momentum 12-1 — ETF8/SPY/10bps/2021-04-05→2026-04-02",
    metrics: {
      id: "m2",
      run_id: "val-mom",
      cagr: 0.0583,
      sharpe: 0.4726,
      max_drawdown: -0.3,
      turnover: 1.6999, // run-window-only corrected value
      volatility: 0.1411,
      win_rate: 0.4801,
      profit_factor: 1.0915,
      calmar: 0.1945,
    },
    equityCurve: makeEquityCurve(100000, 132660),
    turnoverSummary: makeTurnoverSummary(0.14, 12), // constituent rotation
    overlapDetected: false,
    metadata: BASE_METADATA,
  },
  {
    id: "low_vol",
    name: "Low Volatility — ETF8/SPY/10bps/2021-04-05→2026-04-02",
    metrics: {
      id: "m3",
      run_id: "val-lv",
      cagr: 0.0841,
      sharpe: 0.7332,
      max_drawdown: -0.2653,
      turnover: 1.2872, // run-window-only corrected value
      volatility: 0.12,
      win_rate: 0.5358,
      profit_factor: 1.1325,
      calmar: 0.3171,
    },
    equityCurve: makeEquityCurve(100000, 149567),
    turnoverSummary: makeTurnoverSummary(0.107, 12),
    overlapDetected: false,
    metadata: BASE_METADATA,
  },
  {
    id: "trend_filter",
    name: "Trend Filter — ETF8/SPY/10bps/2021-04-05→2026-04-02",
    metrics: {
      id: "m4",
      run_id: "val-tf",
      cagr: 0.0213,
      sharpe: 0.2155,
      max_drawdown: -0.3964,
      turnover: 2.7151, // run-window-only corrected value
      volatility: 0.1499,
      win_rate: 0.5318,
      profit_factor: 1.0365,
      calmar: 0.0537,
    },
    equityCurve: makeEquityCurve(100000, 111065),
    turnoverSummary: makeTurnoverSummary(0.226, 12),
    overlapDetected: false,
    metadata: BASE_METADATA,
  },
  {
    id: "ml_ridge",
    name: "ML Ridge — ETF8/SPY/10bps/2021-04-05→2026-04-02",
    metrics: {
      id: "m5",
      run_id: "val-ridge",
      cagr: 0.0636,
      sharpe: 0.4757,
      max_drawdown: -0.3035,
      turnover: 17.4292,
      volatility: 0.1546,
      win_rate: 0.5199,
      profit_factor: 1.0876,
      calmar: 0.2094,
    },
    equityCurve: makeEquityCurve(100443, 135951),
    turnoverSummary: makeTurnoverSummary(0.0276, 252),
    overlapDetected: false,
    metadata: {
      ...BASE_METADATA,
      modelImpl: "ridge",
      modelVersion: "1.0.0",
      featureSet: "mom_5d,mom_20d,mom_60d,mom_252d,vol_20d,vol_60d,drawdown_252d,beta_60d",
      randomSeed: "42",
      determinismMode: "strict",
    },
  },
  {
    id: "ml_lightgbm",
    name: "ML LightGBM — ETF8/SPY/10bps/2021-04-05→2026-04-02",
    metrics: {
      id: "m6",
      run_id: "val-lgbm",
      cagr: 0.0043,
      sharpe: 0.1013,
      max_drawdown: -0.3391,
      turnover: 52.5284,
      volatility: 0.1422,
      win_rate: 0.508,
      profit_factor: 1.0178,
      calmar: 0.0128,
    },
    equityCurve: makeEquityCurve(100302, 102176),
    turnoverSummary: makeTurnoverSummary(0.0833, 252),
    overlapDetected: false,
    metadata: {
      ...BASE_METADATA,
      modelImpl: "lightgbm",
      modelVersion: "1.0.0",
      featureSet: "mom_5d,mom_20d,mom_60d,mom_252d,vol_20d,vol_60d,drawdown_252d,beta_60d",
      randomSeed: "42",
      determinismMode: "strict",
    },
  },
];

// ── Generate tearsheets ──────────────────────────────────────────────────────

describe("Production tearsheet generation", () => {
  for (const s of STRATEGIES) {
    it(`generates production tearsheet for ${s.id}`, () => {
      const html = buildReportHtml({
        runName: s.name,
        strategyId: s.id,
        startDate: RUN_START,
        endDate: RUN_END,
        generatedAt: GENERATED_AT,
        benchmarkTicker: BENCHMARK,
        benchmarkOverlapDetected: s.overlapDetected,
        metrics: s.metrics,
        equityCurve: s.equityCurve,
        universe: UNIVERSE,
        universeSymbols: UNIVERSE_SYMBOLS,
        costsBps: COSTS_BPS,
        topN: TOP_N,
        runParams: {},
        runMetadata: s.metadata as Parameters<typeof buildReportHtml>[0]["runMetadata"],
        turnoverSummary: s.turnoverSummary,
      });

      const outPath = path.join(OUT_DIR, `${s.id}_production_tearsheet.html`);
      fs.writeFileSync(outPath, html, "utf-8");
      console.log(`  Written: ${outPath} (${html.length} chars)`);
    });
  }
});
