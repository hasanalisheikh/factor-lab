import { subtractTradingDays } from "@/lib/data-cutoff";
import { getStrategyWarmupTradingDays } from "@/lib/coverage-check/warmup";

import type { StrategyId } from "@/lib/types";

/**
 * Count Mon-Fri business days in [startDate, endDate] inclusive.
 * Labeled as "approximation" -- does not account for market holidays.
 */
export function countBusinessDays(startDate: string, endDate: string): number {
  const s = new Date(startDate + "T00:00:00Z");
  const e = new Date(endDate + "T00:00:00Z");
  if (e < s) return 0;
  let count = 0;
  const d = new Date(s);
  while (d <= e) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

/**
 * Returns the most recent "finalized" trading date -- yesterday, or last Friday
 * if today is Saturday (yesterday=Friday) or Sunday (two days ago=Friday).
 *
 * This prevents coverage checks from counting today's partially-ingested data
 * as "missing". The auto-maintain cron also uses yesterday as its staleness
 * threshold, so this keeps the two systems in sync.
 */
export function getSafeLastDate(): string {
  const now = new Date();
  const dow = now.getUTCDay();
  let daysBack = 1;
  if (dow === 0) daysBack = 2;
  if (dow === 6) daysBack = 1;
  const safe = new Date(now);
  safe.setUTCDate(safe.getUTCDate() - daysBack);
  return safe.toISOString().slice(0, 10);
}

/**
 * Subtract calendar days from a YYYY-MM-DD string.
 * Returns the new date as YYYY-MM-DD.
 */
export function subtractCalendarDays(dateStr: string, days: number): string {
  if (days <= 0) return dateStr;
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Add calendar days to a YYYY-MM-DD string, returning a new YYYY-MM-DD. */
export function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Format a YYYY-MM-DD string as "Nov 18, 2004" for user-facing messages. */
export function formatDateForMessage(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function resolveRunPreflightWindow(params: {
  strategyId: StrategyId;
  startDate: string;
  endDate: string;
  minStartDate: string | null;
}): {
  warmupStart: string;
  requiredStart: string;
  requiredEnd: string;
} {
  const requiredStart =
    params.minStartDate && params.minStartDate > params.startDate
      ? params.minStartDate
      : params.startDate;
  const requiredEnd = params.endDate;
  const warmupStart = subtractTradingDays(
    requiredStart,
    getStrategyWarmupTradingDays(params.strategyId)
  );
  return {
    warmupStart,
    requiredStart,
    requiredEnd,
  };
}

export function countDatesInRange(
  dates: readonly string[],
  startDate: string,
  endDate: string
): number {
  if (!startDate || !endDate || endDate < startDate) return 0;
  let count = 0;
  for (const date of dates) {
    if (date < startDate) continue;
    if (date > endDate) break;
    count += 1;
  }
  return count;
}

export function resolveCoverageWindowStart(params: {
  windowFloor: string;
  windowEnd: string;
  firstDate: string | null;
}): string | null {
  const { windowFloor, windowEnd, firstDate } = params;
  if (!firstDate) return null;
  const windowStart = firstDate > windowFloor ? firstDate : windowFloor;
  return windowStart <= windowEnd ? windowStart : null;
}
