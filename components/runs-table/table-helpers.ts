import type { RunMetricsRow, RunWithMetrics } from "@/lib/supabase/types";

import type { MobileSortKey, SortableKey, SortDirection } from "./types";

export const MOBILE_SORT_OPTIONS: Array<{
  value: MobileSortKey;
  label: string;
  direction: SortDirection;
}> = [
  { value: "created_at", label: "Created", direction: "desc" },
  { value: "name", label: "Name", direction: "asc" },
  { value: "cagr", label: "CAGR", direction: "desc" },
  { value: "status", label: "Status", direction: "asc" },
];

export function getMetrics(value: RunMetricsRow[] | RunMetricsRow | null): RunMetricsRow | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export function sortRuns(runs: RunWithMetrics[], sortKey: SortableKey, sortDir: SortDirection) {
  const sorted = [...runs];
  sorted.sort((a, b) => {
    const am = getMetrics(a.run_metrics);
    const bm = getMetrics(b.run_metrics);
    let cmp = 0;

    switch (sortKey) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "strategy_id":
        cmp = a.strategy_id.localeCompare(b.strategy_id);
        break;
      case "status":
        cmp = a.status.localeCompare(b.status);
        break;
      case "start_date":
        cmp = String(a.start_date ?? "").localeCompare(String(b.start_date ?? ""));
        break;
      case "created_at":
        cmp = String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
        break;
      case "cagr":
        cmp = (am?.cagr ?? Number.NEGATIVE_INFINITY) - (bm?.cagr ?? Number.NEGATIVE_INFINITY);
        break;
      case "sharpe":
        cmp = (am?.sharpe ?? Number.NEGATIVE_INFINITY) - (bm?.sharpe ?? Number.NEGATIVE_INFINITY);
        break;
      case "max_drawdown":
        cmp =
          Math.abs(am?.max_drawdown ?? Number.POSITIVE_INFINITY) -
          Math.abs(bm?.max_drawdown ?? Number.POSITIVE_INFINITY);
        break;
    }

    return sortDir === "asc" ? cmp : -cmp;
  });
  return sorted;
}
