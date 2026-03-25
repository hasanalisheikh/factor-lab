/**
 * ETA computation utilities for backtest and data-ingest progress bars.
 *
 * Used by JobStatusPanel to show "~2m remaining" next to progress bars.
 * All functions are pure (no I/O) so they are safely importable in both
 * server and client components.
 */

/**
 * Estimate seconds remaining based on elapsed time and current progress.
 *
 * Formula: eta = elapsed * (100 - progress) / progress
 * Returns null when there is insufficient data to estimate reliably.
 */
export function computeEtaSeconds(progressPct: number, startedAt: string | null): number | null {
  if (!startedAt || progressPct <= 0 || progressPct >= 100) return null;
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  if (elapsedMs < 3000) return null; // too early — avoid wild initial estimates
  const etaMs = (elapsedMs * (100 - progressPct)) / progressPct;
  return Math.round(etaMs / 1000);
}

/**
 * Format an ETA in seconds to a human-readable string.
 *
 * Examples:
 *   null          → ""
 *   30            → "< 1m remaining"
 *   90            → "~2m remaining"
 *   3700          → "~1h 2m remaining"
 */
export function formatEtaSeconds(seconds: number | null): string {
  if (seconds === null) return "";
  if (seconds < 60) return "< 1m remaining";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `~${mins}m remaining`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `~${hrs}h ${rem}m remaining` : `~${hrs}h remaining`;
}
