import type { KeyboardEvent } from "react";

import type { RunWithMetrics } from "@/lib/supabase/types";

export type DesktopSortKey =
  | "name"
  | "strategy_id"
  | "status"
  | "cagr"
  | "sharpe"
  | "max_drawdown"
  | "start_date";

export type SortableKey = DesktopSortKey | "created_at";
export type SortDirection = "asc" | "desc";
export type MobileSortKey = "name" | "cagr" | "created_at" | "status";

export interface RunsTableProps {
  runs: RunWithMetrics[];
  searchQuery?: string;
  /** runId → progress % (0-100) for active runs. Populated by the server page. */
  progressMap?: Record<string, number>;
  /** runId → report URL for runs with a generated report. */
  reportUrls?: Record<string, string>;
}

export type HandleRunCardKeyDown = (event: KeyboardEvent<HTMLElement>, runId: string) => void;
