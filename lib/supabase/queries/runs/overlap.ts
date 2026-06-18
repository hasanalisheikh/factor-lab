import "server-only";

import {
  getRunBenchmark,
  inferPossibleOverlapFromUniverse,
  isBenchmarkHeldAtLatestRebalance,
  type BenchmarkOverlapState,
} from "@/lib/benchmark";

import { createClient } from "../../server";
import type { PositionRow } from "../../types";
import type { RunBenchmarkContext } from "../shared";

export async function getBenchmarkOverlapStateForRun(
  run: RunBenchmarkContext
): Promise<BenchmarkOverlapState> {
  const benchmark = getRunBenchmark(run);
  const fallbackPossible = inferPossibleOverlapFromUniverse({
    benchmark,
    strategyId: run.strategy_id,
    universeSymbols: run.universe_symbols,
  });

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("positions")
      .select("date, symbol, weight")
      .eq("run_id", run.id)
      .order("date", { ascending: false })
      .order("symbol", { ascending: true })
      .limit(50);

    if (error) {
      return { confirmed: false, possible: fallbackPossible };
    }

    const positions = (data ?? []) as Pick<PositionRow, "date" | "symbol" | "weight">[];
    if (positions.length === 0) {
      return { confirmed: false, possible: fallbackPossible };
    }

    return {
      confirmed: isBenchmarkHeldAtLatestRebalance(positions, benchmark),
      possible: false,
    };
  } catch {
    return { confirmed: false, possible: fallbackPossible };
  }
}
