import "server-only";

import { createAdminClient } from "../../admin";
import { createClient } from "../../server";
import type { EquityCurveRow, PositionRow } from "../../types";
import { isMissingPositionsTableError } from "../shared";

const EQUITY_CURVE_PAGE_SIZE = 1000;
const POSITIONS_PAGE_SIZE = 1000;

export async function fetchAllEquityCurve(runId: string): Promise<EquityCurveRow[]> {
  const supabase = createAdminClient();
  const all: EquityCurveRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("equity_curve")
      .select("run_id,date,portfolio,benchmark") // id column intentionally excluded — not used by any consumer
      .eq("run_id", runId)
      .order("date", { ascending: true })
      .range(offset, offset + EQUITY_CURVE_PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to load equity curve: ${error.message}`);
    }

    const page = (data ?? []) as EquityCurveRow[];
    if (page.length === 0) break;

    all.push(...page);
    if (page.length < EQUITY_CURVE_PAGE_SIZE) break;
    offset += EQUITY_CURVE_PAGE_SIZE;
  }

  return all;
}

export async function getEquityCurve(runId: string): Promise<EquityCurveRow[]> {
  try {
    return await fetchAllEquityCurve(runId);
  } catch (err) {
    console.error("getEquityCurve exception:", err);
    return [];
  }
}

export async function fetchAllPositionsByRunId(runId: string): Promise<PositionRow[]> {
  const supabase = await createClient();
  const all: PositionRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("positions")
      .select("run_id, date, symbol, weight")
      .eq("run_id", runId)
      .order("date", { ascending: true })
      .order("symbol", { ascending: true })
      .range(offset, offset + POSITIONS_PAGE_SIZE - 1);

    if (error) {
      if (isMissingPositionsTableError(error.message)) {
        return [];
      }
      throw new Error(`Failed to load positions: ${error.message}`);
    }

    const page = (data ?? []) as PositionRow[];
    if (page.length === 0) break;

    all.push(...page);
    if (page.length < POSITIONS_PAGE_SIZE) break;
    offset += POSITIONS_PAGE_SIZE;
  }

  return all;
}

export async function getPositionsByRunId(runId: string): Promise<PositionRow[]> {
  try {
    return await fetchAllPositionsByRunId(runId);
  } catch (err) {
    console.error("getPositionsByRunId exception:", err);
    return [];
  }
}
