import "server-only";

import { getLastCompleteTradingDayUtc } from "@/lib/data-cutoff";
import { getUniverseConstraintsSnapshot } from "@/lib/supabase/queries";
import { UNIVERSE_PRESETS, type UniverseId } from "@/lib/universe-config";
import { defaultIngestStartDate, ensureSymbolRepairsInternal } from "./repairs";
import type { EnsureUniverseDataReadyResult, EnsureUniverseOptions } from "./types";

export function resolveUniverseSymbols(universe: UniverseId): string[] {
  return UNIVERSE_PRESETS[universe] ? [...UNIVERSE_PRESETS[universe]] : [];
}

export async function ensureUniverseDataReadyInternal(
  universe: UniverseId,
  userId: string,
  options: EnsureUniverseOptions = {}
): Promise<EnsureUniverseDataReadyResult> {
  const { createBatch = true } = options;
  const constraints = await getUniverseConstraintsSnapshot(universe);
  if (constraints.ready) {
    return {
      ready: true,
      batchId: null,
      queuedSymbols: [],
      widenedSymbols: [],
      activeSymbols: [],
      failedSymbols: [],
      constraints,
    };
  }

  const cutoffDate = getLastCompleteTradingDayUtc();
  const missingTickers = constraints.missingTickers.map((symbol) => symbol.toUpperCase());
  const repairBatch = await ensureSymbolRepairsInternal({
    plans: missingTickers.map((symbol) => ({
      symbol,
      desiredStart: defaultIngestStartDate(symbol),
      desiredEnd: cutoffDate,
    })),
    userId,
    requestedBy: `run-readiness:${userId}:${universe}`,
    createBatch,
  });

  return {
    ready: false,
    batchId: repairBatch.batchId,
    queuedSymbols: repairBatch.queuedSymbols,
    widenedSymbols: repairBatch.widenedSymbols,
    activeSymbols: repairBatch.activeSymbols,
    failedSymbols: repairBatch.failedSymbols,
    constraints,
  };
}
