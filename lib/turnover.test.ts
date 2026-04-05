import { describe, expect, it } from "vitest";
import {
  buildTurnoverPointsFromPositions,
  buildTurnoverSummaryFromPositions,
  getTurnoverPeriodsPerYear,
} from "@/lib/turnover";
import type { PositionRow } from "@/lib/supabase/types";

function positionsForDate(date: string, symbols: string[]): PositionRow[] {
  return symbols.map((symbol) => ({
    run_id: "run-1",
    date,
    symbol,
    weight: 0.2,
  }));
}

describe("turnover helpers", () => {
  it("one-name swap in a 5-position equal-weight portfolio is 20% one-way turnover", () => {
    const positions = [
      ...positionsForDate("2026-03-10", ["AAA", "BBB", "CCC", "DDD", "EEE"]),
      ...positionsForDate("2026-03-11", ["AAA", "BBB", "CCC", "DDD", "FFF"]),
    ];

    const points = buildTurnoverPointsFromPositions(positions);

    expect(points).toHaveLength(2);
    expect(points[0].turnover).toBe(0);
    expect(points[1].turnover).toBeCloseTo(0.2, 12);
    expect(points[1].entered).toEqual(["FFF"]);
    expect(points[1].exited).toEqual(["EEE"]);
  });

  it("excludes initial establishment from annualization and includes no-change dates as 0", () => {
    const positions = [
      ...positionsForDate("2026-03-10", ["AAA", "BBB", "CCC", "DDD", "EEE"]),
      ...positionsForDate("2026-03-11", ["AAA", "BBB", "CCC", "DDD", "EEE"]),
      ...positionsForDate("2026-03-12", ["AAA", "BBB", "CCC", "DDD", "FFF"]),
    ];

    const summary = buildTurnoverSummaryFromPositions(positions, 252);

    expect(summary).not.toBeNull();
    expect(summary?.averageTurnover).toBeCloseTo(0.1, 12);
    expect(summary?.annualizedTurnover).toBeCloseTo(25.2, 12);
  });

  it("computes turnover from full history before slicing visible points, avoiding a fake initial 50% bar", () => {
    const positions = [
      ...positionsForDate("2026-02-27", ["AAA", "BBB", "CCC", "DDD", "EEE"]),
      ...positionsForDate("2026-03-02", ["AAA", "BBB", "CCC", "DDD", "EEE"]),
      ...positionsForDate("2026-03-03", ["AAA", "BBB", "CCC", "DDD", "FFF"]),
    ];

    const visiblePoints = buildTurnoverPointsFromPositions(positions).filter(
      (point) => point.date >= "2026-03-02"
    );

    expect(visiblePoints[0].turnover).toBe(0);
    expect(visiblePoints[1].turnover).toBeCloseTo(0.2, 12);
  });

  it("uses 252 periods/year for ML strategies and 12 for monthly baselines", () => {
    expect(getTurnoverPeriodsPerYear("ml_ridge")).toBe(252);
    expect(getTurnoverPeriodsPerYear("ml_lightgbm")).toBe(252);
    expect(getTurnoverPeriodsPerYear("equal_weight")).toBe(12);
  });
});
