import type { PositionRow } from "@/lib/supabase/types";

export type PositionSnapshot = Pick<PositionRow, "date" | "symbol" | "weight">;

export type RebalanceTurnoverPoint = {
  date: string;
  turnover: number;
  entered: string[];
  exited: string[];
  count: number;
  isInitialEstablishment: boolean;
  isAllCash?: boolean;
};

export type TurnoverSummary = {
  points: RebalanceTurnoverPoint[];
  averageTurnover: number;
  annualizedTurnover: number;
  periodsPerYear: number;
};

const ML_STRATEGIES = new Set(["ml_ridge", "ml_lightgbm"]);

/**
 * Sentinel symbol written to the positions table by the engine for rebalance dates
 * where a strategy holds no risky assets (e.g. momentum_12_1 with all-negative scores).
 * Weight is always 0.  Must be filtered out before treating position rows as real holdings.
 */
export const ALL_CASH_SENTINEL = "_CASH";

export function getTurnoverPeriodsPerYear(strategyId: string): number {
  return ML_STRATEGIES.has(strategyId) ? 252 : 12;
}

function sortDatesAscending(dates: Iterable<string>): string[] {
  return Array.from(new Set(dates)).sort((a, b) => a.localeCompare(b));
}

function buildWeightMap(rows: PositionSnapshot[]): Map<string, number> {
  const weights = new Map<string, number>();
  for (const row of rows) {
    if (row.symbol === ALL_CASH_SENTINEL) continue; // sentinel is not a real asset
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
    const rawRows = rowsByDate.get(date) ?? [];
    // A date is stored-all-cash when the engine wrote exactly one _CASH sentinel row.
    const isStoredAllCash = rawRows.length === 1 && rawRows[0].symbol === ALL_CASH_SENTINEL;
    const currWeights = isStoredAllCash ? new Map<string, number>() : buildWeightMap(rawRows);
    const currSelected = new Set(currWeights.keys());
    const prevSelected = new Set(prevWeights.keys());
    const rawTurnover = computeOneWayTurnover(prevWeights, currWeights);
    const isInitialEstablishment = index === 0;

    points.push({
      date,
      turnover: isInitialEstablishment ? 0 : rawTurnover,
      entered: [...currSelected].filter((ticker) => !prevSelected.has(ticker)).sort(),
      exited: [...prevSelected].filter((ticker) => !currSelected.has(ticker)).sort(),
      count: isStoredAllCash ? 0 : currSelected.size,
      isInitialEstablishment,
      isAllCash: isStoredAllCash || undefined,
    });

    prevWeights = currWeights;
  }

  return points;
}

// Calendar-day threshold above which a gap between consecutive position dates is considered
// an all-cash period (rather than normal monthly rebalancing with no constituent changes).
// Used only for OLD runs that predate the _CASH sentinel; new runs have explicit sentinel rows.
const ALL_CASH_GAP_DAYS = 35;

/**
 * Returns a copy of `points` with synthetic "(all-cash)" entries inserted for each
 * inter-rebalance gap longer than ALL_CASH_GAP_DAYS calendar days.
 *
 * For new runs the engine persists explicit _CASH sentinel rows, so
 * `buildTurnoverPointsFromPositions` already emits isAllCash:true points for those dates.
 * This function skips synthetic injection for any calendar month already covered by a
 * stored sentinel to avoid duplicates while remaining backward-compatible with old runs.
 */
export function injectAllCashGaps(points: RebalanceTurnoverPoint[]): RebalanceTurnoverPoint[] {
  if (points.length < 2) return points;

  // Build a set of YYYY-MM strings for months already represented by stored all-cash points.
  const storedAllCashMonths = new Set(
    points.filter((p) => p.isAllCash).map((p) => p.date.slice(0, 7))
  );

  const result: RebalanceTurnoverPoint[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prevDate = new Date(points[i - 1].date);
    const currDate = new Date(points[i].date);
    const gapDays = Math.round((currDate.getTime() - prevDate.getTime()) / 86_400_000);

    if (gapDays > ALL_CASH_GAP_DAYS) {
      // Synthesize one all-cash entry per missing month in the gap, unless a stored
      // sentinel already covers that month.
      const syntheticDate = new Date(prevDate);
      syntheticDate.setUTCMonth(syntheticDate.getUTCMonth() + 1);
      syntheticDate.setUTCDate(1);

      while (syntheticDate < currDate) {
        const monthKey = syntheticDate.toISOString().slice(0, 7);
        if (!storedAllCashMonths.has(monthKey)) {
          result.push({
            date: syntheticDate.toISOString().slice(0, 10),
            turnover: 0,
            entered: [],
            exited: [],
            count: 0,
            isInitialEstablishment: false,
            isAllCash: true,
          });
        }
        syntheticDate.setUTCMonth(syntheticDate.getUTCMonth() + 1);
      }
    }

    result.push(points[i]);
  }

  return result;
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
