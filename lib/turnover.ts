import type { PositionRow } from "@/lib/supabase/types";

export type PositionSnapshot = Pick<PositionRow, "date" | "symbol" | "weight">;

export type RebalanceTurnoverPoint = {
  date: string;
  turnover: number;
  entered: string[];
  exited: string[];
  count: number;
  isInitialEstablishment: boolean;
};

export type TurnoverSummary = {
  points: RebalanceTurnoverPoint[];
  averageTurnover: number;
  annualizedTurnover: number;
  periodsPerYear: number;
};

const ML_STRATEGIES = new Set(["ml_ridge", "ml_lightgbm"]);

export function getTurnoverPeriodsPerYear(strategyId: string): number {
  return ML_STRATEGIES.has(strategyId) ? 252 : 12;
}

function sortDatesAscending(dates: Iterable<string>): string[] {
  return Array.from(new Set(dates)).sort((a, b) => a.localeCompare(b));
}

function buildWeightMap(rows: PositionSnapshot[]): Map<string, number> {
  const weights = new Map<string, number>();
  for (const row of rows) {
    const weight = Number(row.weight);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    weights.set(row.symbol, weight);
  }
  return weights;
}

function computeOneWayTurnover(
  prevWeights: Map<string, number>,
  currWeights: Map<string, number>
): number {
  const tickers = new Set([...prevWeights.keys(), ...currWeights.keys()]);
  let deltaSum = 0;
  for (const ticker of tickers) {
    deltaSum += Math.abs((currWeights.get(ticker) ?? 0) - (prevWeights.get(ticker) ?? 0));
  }
  return deltaSum / 2;
}

export function buildTurnoverPointsFromPositions(
  positions: PositionSnapshot[]
): RebalanceTurnoverPoint[] {
  if (positions.length === 0) return [];

  const rowsByDate = new Map<string, PositionSnapshot[]>();
  for (const row of positions) {
    const rows = rowsByDate.get(row.date) ?? [];
    rows.push(row);
    rowsByDate.set(row.date, rows);
  }

  const dates = sortDatesAscending(rowsByDate.keys());
  const points: RebalanceTurnoverPoint[] = [];
  let prevWeights = new Map<string, number>();

  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    const currWeights = buildWeightMap(rowsByDate.get(date) ?? []);
    const currSelected = new Set(currWeights.keys());
    const prevSelected = new Set(prevWeights.keys());
    const rawTurnover = computeOneWayTurnover(prevWeights, currWeights);
    const isInitialEstablishment = index === 0;

    points.push({
      date,
      turnover: isInitialEstablishment ? 0 : rawTurnover,
      entered: [...currSelected].filter((ticker) => !prevSelected.has(ticker)).sort(),
      exited: [...prevSelected].filter((ticker) => !currSelected.has(ticker)).sort(),
      count: currSelected.size,
      isInitialEstablishment,
    });

    prevWeights = currWeights;
  }

  return points;
}

export function buildTurnoverSummaryFromPositions(
  positions: PositionSnapshot[],
  periodsPerYear: number
): TurnoverSummary | null {
  const points = buildTurnoverPointsFromPositions(positions);
  if (points.length === 0) return null;

  const annualizablePoints = points.filter((point) => !point.isInitialEstablishment);
  const averageTurnover =
    annualizablePoints.length > 0
      ? annualizablePoints.reduce((sum, point) => sum + point.turnover, 0) /
        annualizablePoints.length
      : 0;

  return {
    points,
    averageTurnover,
    annualizedTurnover: averageTurnover * periodsPerYear,
    periodsPerYear,
  };
}
