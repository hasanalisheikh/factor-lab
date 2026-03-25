/**
 * Centralized formatting helpers for financial metrics.
 *
 * Inputs are always fractions (0.224, not 22.4) unless the parameter
 * is explicitly described as a ratio or whole number.
 */

/** 0.224 → "22.4%" */
export function formatPct(fraction: number, decimals = 1): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** 0.224 → "+22.4%"  |  -0.05 → "-5.0%" */
export function formatSignedPct(fraction: number, decimals = 1): string {
  const pct = (fraction * 100).toFixed(decimals);
  return fraction >= 0 ? `+${pct}%` : `${pct}%`;
}

/**
 * Diff of two fractions expressed in percentage points.
 * 0.032 → "+3.2 pp"  |  -0.015 → "-1.5 pp"
 *
 * Use for deltas where both portfolio and benchmark values are fractions
 * (e.g. CAGR difference).
 */
export function formatSignedPctPoints(diffFraction: number, decimals = 1): string {
  const pp = (diffFraction * 100).toFixed(decimals);
  return diffFraction >= 0 ? `+${pp} pp` : `${pp} pp`;
}

/** Signed ratio / dimensionless number: 0.15 → "+0.15"  |  -0.3 → "-0.30" */
export function formatSignedNum(x: number, decimals = 2): string {
  const s = Math.abs(x).toFixed(decimals);
  return x >= 0 ? `+${s}` : `-${s}`;
}

/** Plain ratio / dimensionless number: 2.0234 → "2.02" */
export function formatNum(x: number, decimals = 2): string {
  return x.toFixed(decimals);
}

/** Max drawdown — always negative: 0.318 → "-31.8%"  or  -0.318 → "-31.8%" */
export function formatDrawdown(fraction: number, decimals = 1): string {
  return `-${(Math.abs(fraction) * 100).toFixed(decimals)}%`;
}
