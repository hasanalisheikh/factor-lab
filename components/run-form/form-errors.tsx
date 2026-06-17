"use client";

import { RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { STRATEGY_LABELS } from "@/lib/types";

import type { UniverseBatchStatusSummary } from "@/app/actions/runs";
import type { StrategyId } from "@/lib/types";
import type { UniverseId } from "@/lib/universe-config";

type UniverseStatusNoticeProps = {
  batchStatus: UniverseBatchStatusSummary | null;
  hasMissingTickers: boolean;
  isUniverseLoading: boolean;
  isUniverseReady: boolean;
  loadUniverseState: (universeId: UniverseId, options?: { createBatch?: boolean }) => Promise<void>;
  missingTickers: string[];
  universe: UniverseId;
  universeBatchId: string | null;
};

export function UniverseStatusNotice({
  batchStatus,
  hasMissingTickers,
  isUniverseLoading,
  isUniverseReady,
  loadUniverseState,
  missingTickers,
  universe,
  universeBatchId,
}: UniverseStatusNoticeProps) {
  return (
    <>
      {hasMissingTickers && (
        <p className="text-[11px] text-amber-300/90">
          Missing tickers: {missingTickers.join(", ")}
        </p>
      )}

      {!isUniverseReady && (
        <div className="flex items-start gap-2 rounded-md border border-amber-800/40 bg-amber-950/30 px-2.5 py-2">
          <span className="mt-0.5 text-xs text-amber-400">!</span>
          <div className="space-y-1 text-xs leading-snug text-amber-300/80">
            {isUniverseLoading ? (
              <p>Checking universe data readiness...</p>
            ) : batchStatus &&
              (batchStatus.status === "pending" || batchStatus.status === "running") ? (
              <p>
                Preparing missing universe data: {batchStatus.completedJobs}/{batchStatus.totalJobs}{" "}
                jobs complete ({batchStatus.avgProgress}%).
              </p>
            ) : (
              <p>
                Queue Backtest stays disabled until the selected universe is fully ingested and
                ready.
              </p>
            )}
            {!isUniverseLoading && !universeBatchId && hasMissingTickers && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadUniverseState(universe, { createBatch: true })}
                className="h-7 border-amber-700/50 bg-transparent text-[11px] text-amber-200 hover:bg-amber-950/40"
              >
                <RefreshCcw className="mr-1.5 h-3 w-3" />
                Retry data repair
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

type WarmupWarningProps = {
  effectiveStrategyStart: string | null;
  showWarmupWarning: boolean;
  strategy: string;
  warmupDays: number;
  warmupDesc: string;
};

export function WarmupWarning({
  effectiveStrategyStart,
  showWarmupWarning,
  strategy,
  warmupDays,
  warmupDesc,
}: WarmupWarningProps) {
  if (!showWarmupWarning || !effectiveStrategyStart) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-800/40 bg-amber-950/30 px-2.5 py-2">
      <span className="mt-0.5 text-xs text-amber-400">!</span>
      <p className="text-xs leading-snug text-amber-300/80">
        <strong>{STRATEGY_LABELS[strategy as StrategyId]}</strong> needs ~{warmupDays} calendar days
        of history before it can trade.{warmupDesc ? ` ${warmupDesc}` : ""} Earliest recommended
        start: <span className="font-mono">{effectiveStrategyStart}</span>.
      </p>
    </div>
  );
}

export function FormMessages({
  dateAdjustmentMessage,
  submitError,
}: {
  dateAdjustmentMessage: string | null;
  submitError: string | null;
}) {
  return (
    <>
      {dateAdjustmentMessage && (
        <p className="rounded-md border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-300">
          {dateAdjustmentMessage}
        </p>
      )}

      {submitError && (
        <p className="text-destructive bg-destructive/8 border-destructive/20 rounded-md border px-3 py-2 text-[12px]">
          {submitError}
        </p>
      )}
    </>
  );
}
