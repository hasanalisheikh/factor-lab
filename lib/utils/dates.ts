/**
 * Format a date string (YYYY-MM-DD) to ISO format, unchanged.
 * Handles timestamps by extracting the date portion (UTC).
 */
export function formatISODate(value: string | null | undefined): string {
  if (!value) return "N/A";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (isNaN(d.getTime())) return "N/A";
  return d.toISOString().split("T")[0];
}

/**
 * Format a timestamp to "YYYY-MM-DD HH:mm UTC".
 */
export function formatISOTimestamp(value: string | null | undefined): string {
  if (!value) return "N/A";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "N/A";
  const date = d.toISOString().split("T")[0];
  const time = d.toISOString().split("T")[1].substring(0, 5);
  return `${date} ${time} UTC`;
}

/**
 * Returns the number of full days elapsed since the given timestamp.
 */
export function daysAgoFromNow(value: string | null | undefined): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export function getFreshnessStatus(
  value: string | null | undefined
): "fresh" | "stale" | "outdated" | "unknown" {
  const days = daysAgoFromNow(value);
  if (days === null) return "unknown";
  if (days < 1) return "fresh";
  if (days <= 7) return "stale";
  return "outdated";
}

/**
 * Count Mon–Fri business days between start and end (inclusive), UTC.
 */
export function countBusinessDaysInclusive(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
}
