import { BENCHMARK_OPTIONS } from "@/lib/benchmark"
import { UNIVERSE_PRESETS } from "@/lib/universe-config"

export const DATA_STATE_SINGLETON_ID = 1

export type DataUpdateMode = "monthly" | "daily" | "manual"
export type DataIngestRequestMode = DataUpdateMode | "preflight"

export const MONTHLY_CATCH_UP_LOOKBACK_TRADING_DAYS = 10
export const MONTHLY_GAP_REPAIR_LOOKBACK_TRADING_DAYS = 30
export const DAILY_CATCH_UP_LOOKBACK_TRADING_DAYS = 5
export const DAILY_GAP_REPAIR_LOOKBACK_TRADING_DAYS = 10
export const DAILY_PATCH_RUN_HOUR_UTC = 19

function toUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`)
}

export function formatUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function minIsoDate(a: string, b: string): string {
  return a <= b ? a : b
}

export function maxIsoDate(a: string, b: string): string {
  return a >= b ? a : b
}

export function subtractTradingDays(dateStr: string, tradingDays: number): string {
  if (tradingDays <= 0) return dateStr

  const cursor = toUtcDate(dateStr)
  let remaining = tradingDays

  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() - 1)
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) {
      remaining -= 1
    }
  }

  return formatUtcDate(cursor)
}

export function getLastCompleteTradingDayUtc(now = new Date()): string {
  const cursor = new Date(now)
  cursor.setUTCHours(0, 0, 0, 0)
  cursor.setUTCDate(cursor.getUTCDate() - 1)

  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }

  return formatUtcDate(cursor)
}

export function getNextMonthStartUtc(now = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return formatUtcDate(next)
}

export function isDailyUpdatesEnabled(): boolean {
  const value = process.env.ENABLE_DAILY_UPDATES?.trim().toLowerCase()
  if (value === undefined || value === "") return true
  return value === "true"
}

export function getRequiredTickers(): string[] {
  return [...new Set([...BENCHMARK_OPTIONS, ...Object.values(UNIVERSE_PRESETS).flat()])].sort()
}

export function buildScheduledRefreshWindow(params: {
  existingLastDate: string | null
  inceptionDate: string
  targetCutoffDate: string
  requestMode: Extract<DataIngestRequestMode, "monthly" | "daily">
}): { startDate: string; endDate: string } {
  const { existingLastDate, inceptionDate, targetCutoffDate, requestMode } = params
  const endDate = targetCutoffDate

  if (!existingLastDate) {
    return { startDate: inceptionDate, endDate }
  }

  const catchUpLookback =
    requestMode === "monthly"
      ? MONTHLY_CATCH_UP_LOOKBACK_TRADING_DAYS
      : DAILY_CATCH_UP_LOOKBACK_TRADING_DAYS
  const gapRepairLookback =
    requestMode === "monthly"
      ? MONTHLY_GAP_REPAIR_LOOKBACK_TRADING_DAYS
      : DAILY_GAP_REPAIR_LOOKBACK_TRADING_DAYS

  const catchUpStart = subtractTradingDays(existingLastDate, catchUpLookback)
  const gapRepairStart = subtractTradingDays(targetCutoffDate, gapRepairLookback)
  const desiredStart = minIsoDate(catchUpStart, gapRepairStart)

  return {
    startDate: maxIsoDate(desiredStart, inceptionDate),
    endDate,
  }
}
