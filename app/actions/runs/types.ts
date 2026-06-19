import type { z } from "zod";

import type { RunPreflightResult } from "@/lib/coverage-check";
import type { UniverseConstraintsSnapshot } from "@/lib/supabase/queries";
import type { runConfigSchema } from "./schema";

export type { RunPreflightResult } from "@/lib/coverage-check";
export type { UniverseBatchStatusSummary } from "@/lib/supabase/queries";

export type RunConfigInput = z.input<typeof runConfigSchema>;

export type EnsureUniverseDataReadyResult = {
  ready: boolean;
  batchId: string | null;
  queuedSymbols: string[];
  widenedSymbols: string[];
  activeSymbols: string[];
  failedSymbols: string[];
  constraints: UniverseConstraintsSnapshot;
};

export type EnsureUniverseOptions = {
  createBatch?: boolean;
};

export type RepairBatchResult = {
  batchId: string | null;
  queuedSymbols: string[];
  widenedSymbols: string[];
  activeSymbols: string[];
  failedSymbols: string[];
};

export type CreateRunResult =
  | { ok: true; runId: string; preflight: RunPreflightResult }
  | { ok: false; error: string; preflight?: RunPreflightResult | null };

export type RetryPreflightRepairsResult =
  | ({ ok: true } & RepairBatchResult)
  | { ok: false; error: string };

export type DeleteRunActionResult = { error: string };
export type RetryQueuedRunWakeReason =
  | "triggered"
  | "claimed"
  | "not_queued"
  | "too_early"
  | "unauthorized"
  | "not_found"
  | "maxed"
  | "trigger_failed";
export type RetryQueuedRunWakeResult = {
  attempted: boolean;
  reason: RetryQueuedRunWakeReason;
};

export type ActiveIngestJobRow = {
  id: string;
  symbol: string;
  status: string;
  next_retry_at: string | null;
  start_date: string | null;
  end_date: string | null;
  batch_id: string | null;
  request_mode: string | null;
};

export type SymbolRepairPlan = {
  symbol: string;
  desiredStart: string;
  desiredEnd: string;
};

export type TickerStatsSnapshot = {
  symbol: string;
  firstDate: string | null;
  lastDate: string | null;
};

export type CloneRunResult =
  | { ok: true; newRunId: string }
  | { ok: false; error: string; alreadyCurrent?: boolean };
