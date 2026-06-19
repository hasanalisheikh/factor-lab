"use client";

import { useState } from "react";

import { createRun, retryPreflightRepairs } from "@/app/actions/runs";
import { BENCHMARK_OPTIONS } from "@/lib/benchmark";

import { parseLocalDate, toInputDate } from "./run-form-schema";

import type { FormEvent, RefObject } from "react";
import type {
  EnsureUniverseDataReadyResult,
  RunConfigInput,
  RunPreflightResult,
} from "@/app/actions/runs";
import type { StrategyId } from "@/lib/types";
import type { UniverseId } from "@/lib/universe-config";

type RunFormRouter = {
  push: (href: string) => void;
};

type UseRunFormSubmitInput = {
  applyCosts: boolean;
  benchmark: (typeof BENCHMARK_OPTIONS)[number];
  capitalValue: number;
  endDate?: Date;
  formRef: RefObject<HTMLFormElement | null>;
  loadUniverseState: (universeId: UniverseId, options?: { createBatch?: boolean }) => Promise<void>;
  router: RunFormRouter;
  setBenchmark: (value: (typeof BENCHMARK_OPTIONS)[number]) => void;
  setDateAdjustmentMessage: (message: string | null) => void;
  setEndDate: (value: Date | undefined) => void;
  setStartDate: (value: Date | undefined) => void;
  setTopNValue: (value: string) => void;
  startDate?: Date;
  topNValue: string;
  universe: UniverseId;
  universeState: EnsureUniverseDataReadyResult;
};

export function useRunFormSubmit({
  applyCosts,
  benchmark,
  capitalValue,
  endDate,
  formRef,
  loadUniverseState,
  router,
  setBenchmark,
  setDateAdjustmentMessage,
  setEndDate,
  setStartDate,
  setTopNValue,
  startDate,
  topNValue,
  universe,
  universeState,
}: UseRunFormSubmitInput) {
  const [isPreflighting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [blockResult, setBlockResult] = useState<RunPreflightResult | null>(null);
  const [warnResult, setWarnResult] = useState<RunPreflightResult | null>(null);

  function collectRunInput(): RunConfigInput | null {
    if (!formRef.current || !startDate || !endDate) return null;
    const formData = new FormData(formRef.current);

    return {
      name: String(formData.get("name") ?? ""),
      strategy_id: String(formData.get("strategy_id") ?? "") as StrategyId,
      start_date: toInputDate(startDate),
      end_date: toInputDate(endDate),
      benchmark,
      universe,
      costs_bps: Number(formData.get("costs_bps") ?? 0),
      top_n: Number(topNValue ?? 1),
      initial_capital: capitalValue,
      apply_costs: applyCosts,
      slippage_bps: Number(formData.get("slippage_bps") ?? 0),
    };
  }

  async function runCreate(acknowledgeWarnings: boolean) {
    const input = collectRunInput();
    if (!input) {
      setSubmitError("Please complete the form before queueing a backtest.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await createRun({
        ...input,
        acknowledge_warnings: acknowledgeWarnings,
      });
      if (result.ok) {
        router.push(`/runs/${result.runId}`);
        return;
      }

      if (result.preflight?.status === "block") {
        setBlockResult(result.preflight);
      } else if (result.preflight?.status === "warn") {
        setWarnResult(result.preflight);
      } else {
        setSubmitError(result.error);
      }
    } catch (error) {
      console.error("[RunForm] createRun failed:", error);
      setSubmitError("Failed to queue the backtest. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    setDateAdjustmentMessage(null);

    await runCreate(false);
  }

  async function applySuggestedFix(kind: string, value?: string | number | string[]) {
    if (kind === "clamp_start_date" && typeof value === "string") {
      setStartDate(parseLocalDate(value));
      setDateAdjustmentMessage(`We've moved your start date to ${value}.`);
      setBlockResult(null);
      setWarnResult(null);
      return;
    }
    if (kind === "clamp_end_date" && typeof value === "string") {
      setEndDate(parseLocalDate(value));
      setDateAdjustmentMessage(`We've moved your end date to ${value}.`);
      setBlockResult(null);
      setWarnResult(null);
      return;
    }
    if (kind === "set_top_n" && typeof value === "number") {
      setTopNValue(String(value));
      setDateAdjustmentMessage(`We've reduced Top N to ${value}.`);
      setBlockResult(null);
      setWarnResult(null);
      return;
    }
    if (kind === "reduce_top_n" && typeof value === "number") {
      setTopNValue(String(value));
      setDateAdjustmentMessage(`We've reduced Top N to ${value}.`);
      setBlockResult(null);
      setWarnResult(null);
      return;
    }
    if (kind === "change_benchmark" && typeof value === "string") {
      setBenchmark(value as (typeof BENCHMARK_OPTIONS)[number]);
      setDateAdjustmentMessage(`We've switched the benchmark to ${value}.`);
      setBlockResult(null);
      setWarnResult(null);
      return;
    }
    if (kind === "retry_repairs" && Array.isArray(value)) {
      setSubmitError(null);
      const input = collectRunInput();
      if (!input) return;
      const result = await retryPreflightRepairs({
        symbols: value,
        required_end: blockResult?.requiredEnd ?? warnResult?.requiredEnd ?? input.end_date,
      });
      if (!result.ok) {
        setSubmitError(result.error);
        return;
      }
      if (value.some((symbol) => universeState.constraints.missingTickers.includes(symbol))) {
        await loadUniverseState(universe, { createBatch: false });
      }
      setBlockResult(null);
      setWarnResult(null);
      setDateAdjustmentMessage(
        "We restarted the data repair. Try queueing the run again once it finishes."
      );
    }
  }

  return {
    applySuggestedFix,
    blockResult,
    handleSubmit,
    isPreflighting,
    isSubmitting,
    runCreate,
    setBlockResult,
    setSubmitError,
    setWarnResult,
    submitError,
    warnResult,
  };
}
