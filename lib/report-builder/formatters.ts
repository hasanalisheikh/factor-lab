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
