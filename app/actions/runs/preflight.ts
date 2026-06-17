"use server";

import {
  getUniverseBatchStatus,
  getUniverseConstraintsSnapshot,
  type UniverseBatchStatusSummary,
} from "@/lib/supabase/queries";
import type { UniverseId } from "@/lib/universe-config";
import { getAuthenticatedUserId } from "./auth";
import { ensureUniverseDataReadyInternal } from "./data-readiness";
import { nextDate, normalizeDate } from "./date-utils";
import { buildErrorPreflightResult } from "./preflight-error";
import { defaultIngestStartDate, ensureSymbolRepairsInternal } from "./repairs";
import { getTickerStatsSnapshot } from "./preflight-issues";
import { preflightRunInternal } from "./preflight-result";
import type {
  EnsureUniverseDataReadyResult,
  EnsureUniverseOptions,
  RetryPreflightRepairsResult,
  RunConfigInput,
  RunPreflightResult,
} from "./types";

export async function ensureUniverseDataReady(
  universe: UniverseId,
  options: EnsureUniverseOptions = {}
): Promise<EnsureUniverseDataReadyResult> {
  const userId = await getAuthenticatedUserId();
  const constraints = await getUniverseConstraintsSnapshot(universe);

  if (!userId) {
    return {
      ready: false,
      batchId: null,
      queuedSymbols: [],
      widenedSymbols: [],
      activeSymbols: [],
      failedSymbols: [],
      constraints,
    };
  }

  return ensureUniverseDataReadyInternal(universe, userId, options);
}

export async function getUniverseBatchStatusAction(
  batchId: string
): Promise<UniverseBatchStatusSummary | null> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return null;
  return getUniverseBatchStatus(batchId);
}

export async function retryPreflightRepairs(params: {
  symbols: string[];
  required_end: string;
}): Promise<RetryPreflightRepairsResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { ok: false, error: "Authentication required. Please sign in." };
  }

  const requiredEnd = normalizeDate(params.required_end);
  if (!requiredEnd) {
    return { ok: false, error: "A valid repair end date is required." };
  }

  const stats = await getTickerStatsSnapshot(params.symbols);
  const plans = params.symbols.map((rawSymbol) => {
    const symbol = rawSymbol.toUpperCase();
    const snapshot = stats.get(symbol);
    return {
      symbol,
      desiredStart:
        snapshot?.lastDate && snapshot.lastDate < requiredEnd
          ? nextDate(snapshot.lastDate)
          : defaultIngestStartDate(symbol),
      desiredEnd: requiredEnd,
    };
  });

  const repairBatch = await ensureSymbolRepairsInternal({
    plans,
    userId,
    requestedBy: `run-preflight-retry:${userId}`,
  });

  return {
    ok: true,
    ...repairBatch,
  };
}

export async function preflightRun(input: RunConfigInput): Promise<RunPreflightResult> {
  const userId = await getAuthenticatedUserId();
  const universe = (input.universe ?? "ETF8") as UniverseId;
  const constraints = await getUniverseConstraintsSnapshot(universe);

  if (!userId) {
    return buildErrorPreflightResult("Authentication required. Please sign in.", constraints);
  }

  return preflightRunInternal(input, userId);
}
