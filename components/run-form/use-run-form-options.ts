"use client";

import { useEffect, useState } from "react";

import { BENCHMARK_OPTIONS } from "@/lib/benchmark";
import {
  STRATEGY_WARMUP_CALENDAR_DAYS,
  STRATEGY_WARMUP_DESCRIPTIONS,
  computeStrategyEarliestStart,
} from "@/lib/strategy-warmup";
import { UNIVERSE_SIZES } from "@/lib/universe-config";

import type { StrategyId } from "@/lib/types";
import type { UserSettings } from "@/lib/supabase/types";
import type { UniverseId } from "@/lib/universe-config";
import type { DataCoverage } from "./run-form-schema";

type UseRunFormOptionsInput = {
  dataCoverage?: DataCoverage | null;
  defaults: UserSettings | null;
  startDateStr: string | null;
  universe: UniverseId;
};

export function useRunFormOptions({
  dataCoverage,
  defaults,
  startDateStr,
  universe,
}: UseRunFormOptionsInput) {
  const [strategy, setStrategy] = useState<string>("");
  const [benchmark, setBenchmark] = useState<(typeof BENCHMARK_OPTIONS)[number]>(
    (defaults?.default_benchmark ?? "SPY") as (typeof BENCHMARK_OPTIONS)[number]
  );
  const [applyCosts, setApplyCosts] = useState(defaults?.apply_costs_default ?? true);
  const [topNValue, setTopNValue] = useState(() =>
    String(
      Math.min(
        defaults?.default_top_n ?? 5,
        UNIVERSE_SIZES[(defaults?.default_universe ?? "ETF8") as UniverseId] ?? 20
      )
    )
  );

  const topNMax = UNIVERSE_SIZES[universe] ?? 20;
  const effectiveStrategyStart = strategy
    ? computeStrategyEarliestStart(strategy as StrategyId, dataCoverage?.minDateStr ?? null)
    : null;
  const showWarmupWarning =
    effectiveStrategyStart !== null &&
    startDateStr !== null &&
    startDateStr < effectiveStrategyStart;
  const warmupDays = strategy ? (STRATEGY_WARMUP_CALENDAR_DAYS[strategy as StrategyId] ?? 0) : 0;
  const warmupDesc = strategy ? (STRATEGY_WARMUP_DESCRIPTIONS[strategy as StrategyId] ?? "") : "";

  useEffect(() => {
    const numericValue = Number(topNValue);
    if (!Number.isFinite(numericValue) || numericValue < 1) {
      setTopNValue(String(Math.min(defaults?.default_top_n ?? 5, topNMax)));
      return;
    }
    if (numericValue > topNMax) {
      setTopNValue(String(topNMax));
    }
    // NOTE: topNValue is intentionally NOT in the dependency array.
    // Including it causes a tight re-render loop that fights the user while typing
    // (e.g. can't type "10" when max is 8 — it gets clamped on every keystroke).
    // The effect only needs to run when the universe changes (topNMax) or when
    // defaults load. The HTML max attribute + server-side validation guard the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults?.default_top_n, topNMax]);

  return {
    optionsController: {
      applyCosts,
      benchmark,
      setApplyCosts,
      setBenchmark,
      setTopNValue,
      topNMax,
      topNValue,
    },
    strategyController: {
      effectiveStrategyStart,
      setValue: setStrategy,
      showWarmupWarning,
      value: strategy,
      warmupDays,
      warmupDesc,
    },
    applyCosts,
    benchmark,
    setBenchmark,
    setTopNValue,
    strategy,
    topNValue,
  };
}
