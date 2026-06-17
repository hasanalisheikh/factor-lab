"use client";

import { useEffect, useRef, useState } from "react";

import { ensureUniverseDataReady, getUniverseBatchStatusAction } from "@/app/actions/runs";
import { resolveMinStartDate } from "./run-form-schema";

import type { EnsureUniverseDataReadyResult, UniverseBatchStatusSummary } from "@/app/actions/runs";
import type { UserSettings } from "@/lib/supabase/types";
import type { UniverseId } from "@/lib/universe-config";

type UseUniverseReadinessInput = {
  defaults: UserSettings | null;
  initialUniverseState: EnsureUniverseDataReadyResult;
};

export function useUniverseReadiness({
  defaults,
  initialUniverseState,
}: UseUniverseReadinessInput) {
  const [value, setValue] = useState<UniverseId>(
    (defaults?.default_universe ?? "ETF8") as UniverseId
  );
  const [state, setState] = useState(initialUniverseState);
  const [batchStatus, setBatchStatus] = useState<UniverseBatchStatusSummary | null>(null);
  const [allowBatchPolling, setAllowBatchPolling] = useState(Boolean(initialUniverseState.batchId));
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastLoadedUniverseRef = useRef(initialUniverseState.constraints.universe);

  async function loadState(universeId: UniverseId, options?: { createBatch?: boolean }) {
    setIsLoading(true);
    setLoadError(null);
    setBatchStatus(null);
    lastLoadedUniverseRef.current = universeId;
    try {
      const nextState = await ensureUniverseDataReady(universeId, options);
      setAllowBatchPolling(options?.createBatch !== false && Boolean(nextState.batchId));
      setState(nextState);
    } catch (error) {
      console.error("[RunForm] ensureUniverseDataReady failed:", error);
      setLoadError("Failed to load universe data readiness. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (value === lastLoadedUniverseRef.current) return;
    void loadState(value, { createBatch: true });
  }, [value]);

  useEffect(() => {
    const batchId = state.batchId;
    if (!batchId || state.ready || !allowBatchPolling) return;
    const currentBatchId = batchId;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      const nextStatus = await getUniverseBatchStatusAction(currentBatchId);
      if (cancelled) return;

      setBatchStatus(nextStatus);

      if (!nextStatus || (nextStatus.status !== "pending" && nextStatus.status !== "running")) {
        const refreshed = await ensureUniverseDataReady(value, { createBatch: false });
        if (cancelled) return;
        setAllowBatchPolling(false);
        setState(refreshed);
        return;
      }

      timeoutId = setTimeout(poll, 2000);
    }

    void poll();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [allowBatchPolling, state.batchId, state.ready, value]);

  const minStartDateStr = resolveMinStartDate(
    state.constraints.universeEarliestStart,
    state.constraints.universeValidFrom
  );
  const missingTickers = state.constraints.missingTickers;
  const hasMissingTickers = missingTickers.length > 0;
  const isReady = state.ready && !hasMissingTickers;

  return {
    controller: {
      batchId: state.batchId,
      batchStatus,
      hasMissingTickers,
      isLoading,
      isReady,
      loadState,
      minStartDateStr,
      missingTickers,
      setValue,
      value,
    },
    hasMissingTickers,
    isLoading,
    isReady,
    loadError,
    loadState,
    minStartDateStr,
    state,
    value,
  };
}
