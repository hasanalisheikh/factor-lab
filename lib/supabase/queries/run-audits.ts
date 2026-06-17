import "server-only";

import type { RunStatus } from "@/lib/types";
import { createAdminClient } from "../admin";
import { createClient } from "../server";
import { countBusinessDays } from "./shared";

export const BACKTEST_MIN_SPAN_DAYS = 730;
export const BACKTEST_MIN_DATA_POINTS = 500;
export const BACKTEST_END_DATE_TOLERANCE_TRADING_DAYS = 5;

export type BacktestAuditOutcome = "pass" | "fail" | "skip";

export type BacktestWindowSummaryRow = {
  run_id: string;
  name: string;
  strategy_id: string;
  status: RunStatus;
  start_date: string;
  end_date: string;
  span_days: number;
  requested_span_days: number;
  equity_start_date: string | null;
  equity_end_date: string | null;
  equity_span_days: number | null;
  end_gap_trading_days: number | null;
  data_points: number;
  meets_min_span: boolean;
  meets_min_points: boolean;
  meets_end_tolerance: boolean;
  audit_outcome: BacktestAuditOutcome;
};

type BacktestAuditRunRow = {
  id: string;
  name: string;
  strategy_id: string;
  status: RunStatus;
  start_date: string;
  end_date: string;
};

type EquityCurveAuditStats = {
  data_points: number;
  equity_start_date: string | null;
  equity_end_date: string | null;
};

function getCalendarDaySpan(startDate: string, endDate: string): number {
  if (!startDate || !endDate || endDate < startDate) return 0;
  const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
  const endMs = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.floor((endMs - startMs) / (1000 * 60 * 60 * 24));
}

function getTradingDayGap(dateA: string | null, dateB: string | null): number | null {
  if (!dateA || !dateB) return null;
  if (dateA === dateB) return 0;
  const startDate = dateA <= dateB ? dateA : dateB;
  const endDate = dateA <= dateB ? dateB : dateA;
  return Math.max(countBusinessDays(startDate, endDate) - 1, 0);
}

/**
 * Fetches equity_curve audit stats for multiple runs in a single DB round-trip.
 * Returns a Map keyed by run_id. Missing run_ids get { data_points: 0, ... }.
 */
async function getEquityCurveAuditStatsBatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  runIds: string[]
): Promise<Map<string, EquityCurveAuditStats>> {
  const result = new Map<string, EquityCurveAuditStats>();
  for (const id of runIds) {
    result.set(id, { data_points: 0, equity_start_date: null, equity_end_date: null });
  }
  if (runIds.length === 0) return result;

  const { data, error } = await admin
    .from("equity_curve")
    .select("run_id, date")
    .in("run_id", runIds);

  if (error) {
    throw new Error(`equity_curve batch query failed: ${error.message}`);
  }

  for (const row of data ?? []) {
    const id = String(row.run_id);
    const date = String(row.date);
    const existing = result.get(id);
    if (!existing) {
      result.set(id, { data_points: 1, equity_start_date: date, equity_end_date: date });
    } else {
      const startDate =
        existing.equity_start_date === null || date < existing.equity_start_date
          ? date
          : existing.equity_start_date;
      const endDate =
        existing.equity_end_date === null || date > existing.equity_end_date
          ? date
          : existing.equity_end_date;
      result.set(id, {
        data_points: existing.data_points + 1,
        equity_start_date: startDate,
        equity_end_date: endDate,
      });
    }
  }

  return result;
}

/**
 * Returns a per-run backtest-window summary for visible completed runs.
 * Row counts and coverage dates come directly from equity_curve using the
 * service-role client so the audit cannot silently truncate at 1000 rows or
 * collapse to zero under RLS.
 */
export async function getRunsBacktestWindowSummary(): Promise<BacktestWindowSummaryRow[]> {
  try {
    const supabase = await createClient();

    const { data: runs, error: runsError } = await supabase
      .from("runs")
      .select("id, name, strategy_id, status, start_date, end_date")
      .eq("status", "completed")
      .order("created_at", { ascending: false });

    if (runsError) {
      console.error("getRunsBacktestWindowSummary runs error:", runsError.message);
      return [];
    }
    if (!runs?.length) return [];

    const admin = createAdminClient();
    const runIds = (runs as BacktestAuditRunRow[]).map((r) => r.id);
    const statsMap = await getEquityCurveAuditStatsBatch(admin, runIds);
    const summary: BacktestWindowSummaryRow[] = (runs as BacktestAuditRunRow[]).map((run) => {
      const stats = statsMap.get(run.id) ?? {
        data_points: 0,
        equity_start_date: null,
        equity_end_date: null,
      };
      const requestedSpanDays = getCalendarDaySpan(run.start_date, run.end_date);
      const equitySpanDays =
        stats.equity_start_date && stats.equity_end_date
          ? getCalendarDaySpan(stats.equity_start_date, stats.equity_end_date)
          : null;
      const spanDays = equitySpanDays ?? 0;
      const endGapTradingDays = getTradingDayGap(stats.equity_end_date, run.end_date);
      const meetsMinPoints = stats.data_points >= BACKTEST_MIN_DATA_POINTS;
      const meetsMinSpan = spanDays >= BACKTEST_MIN_SPAN_DAYS;
      const meetsEndTolerance =
        endGapTradingDays != null && endGapTradingDays <= BACKTEST_END_DATE_TOLERANCE_TRADING_DAYS;

      const auditOutcome: BacktestAuditOutcome =
        stats.data_points > 0 && meetsMinPoints && meetsMinSpan && meetsEndTolerance
          ? "pass"
          : "fail";

      return {
        run_id: run.id,
        name: run.name,
        strategy_id: run.strategy_id,
        status: run.status,
        start_date: run.start_date,
        end_date: run.end_date,
        span_days: spanDays,
        requested_span_days: requestedSpanDays,
        equity_start_date: stats.equity_start_date,
        equity_end_date: stats.equity_end_date,
        equity_span_days: equitySpanDays,
        end_gap_trading_days: endGapTradingDays,
        data_points: stats.data_points,
        meets_min_span: meetsMinSpan,
        meets_min_points: meetsMinPoints,
        meets_end_tolerance: meetsEndTolerance,
        audit_outcome: auditOutcome,
      };
    });

    // Console-log summary for server-side audit visibility.
    console.log(
      "[backtest-audit]",
      JSON.stringify(
        summary.map(
          ({
            run_id,
            name,
            status,
            span_days,
            data_points,
            equity_start_date,
            equity_end_date,
            end_gap_trading_days,
            audit_outcome,
          }) => ({
            run_id,
            name,
            status,
            span_days,
            data_points,
            equity_start_date,
            equity_end_date,
            end_gap_trading_days,
            audit_outcome,
          })
        )
      )
    );

    return summary;
  } catch (err) {
    console.error("getRunsBacktestWindowSummary exception:", err);
    return [];
  }
}
