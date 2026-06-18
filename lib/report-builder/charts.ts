import type { EquityCurveRow } from "@/lib/supabase/types";

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
