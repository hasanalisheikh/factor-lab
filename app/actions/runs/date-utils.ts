export function addCalendarDays(dateStr: string, days: number): string {
  const next = new Date(`${dateStr}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function subtractCalendarDays(dateStr: string, days: number): string {
  return addCalendarDays(dateStr, -days);
}

export function nextDate(dateStr: string): string {
  return addCalendarDays(dateStr, 1);
}

export function normalizeDate(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function pickLaterDate(current: string | null, candidate: string | null): string | null {
  if (!current) return candidate;
  if (!candidate) return current;
  return current > candidate ? current : candidate;
}

export function getMinTrainDays(): number {
  return Number(process.env.ML_MIN_TRAIN_DAYS ?? "252");
}

export function getTrainWindowDays(): number {
  return Number(process.env.ML_TRAIN_WINDOW_DAYS ?? "504");
}

export function getTrainWindowCalendarDays(): number {
  return Math.ceil((getTrainWindowDays() * 365) / 252);
}

export function dayBefore(dateStr: string): string {
  const previous = new Date(`${dateStr}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

export function countBusinessDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}
