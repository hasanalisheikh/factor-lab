"use client";

import { BENCHMARK_OPTIONS } from "@/lib/benchmark";
import { ALL_UNIVERSES } from "@/lib/universe-config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

import { CAPITAL_PRESETS, STRATEGIES } from "./constants";
import { DateRangeFields } from "./date-range-fields";
import { FormMessages, UniverseStatusNotice, WarmupWarning } from "./form-errors";
import { RunFormSubmitButton } from "./run-form-submit";

import type { UniverseBatchStatusSummary } from "@/app/actions/runs";
import type { Dispatch, SetStateAction } from "react";
import type { UserSettings } from "@/lib/supabase/types";
import type { UniverseId } from "@/lib/universe-config";
import type { DataCoverage } from "./run-form-schema";

type RunFormFieldsProps = {
  defaults: UserSettings | null;
  capital: {
    display: string;
    value: number;
    onBlur: () => void;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    setPreset: (value: number) => void;
  };
  dates: {
    coverageMin: Date | null;
    dataCoverage?: DataCoverage | null;
    dataCurrencyStr: string | null;
    endDate?: Date;
    endDateStr: string | null;
    endOpen: boolean;
    maxEndDateStr: string;
    minStartDateStr: string | null;
    setDateAdjustmentMessage: Dispatch<SetStateAction<string | null>>;
    setEndDate: Dispatch<SetStateAction<Date | undefined>>;
    setEndOpen: Dispatch<SetStateAction<boolean>>;
    setStartDate: Dispatch<SetStateAction<Date | undefined>>;
    setStartOpen: Dispatch<SetStateAction<boolean>>;
    startDate?: Date;
    startDateStr: string | null;
    startOpen: boolean;
  };
  options: {
    applyCosts: boolean;
    benchmark: (typeof BENCHMARK_OPTIONS)[number];
    setApplyCosts: Dispatch<SetStateAction<boolean>>;
    setBenchmark: Dispatch<SetStateAction<(typeof BENCHMARK_OPTIONS)[number]>>;
    setTopNValue: Dispatch<SetStateAction<string>>;
    topNMax: number;
    topNValue: string;
  };
  status: {
    dateAdjustmentMessage: string | null;
    isPreflighting: boolean;
    isQueueDisabled: boolean;
    isSubmitting: boolean;
    submitError: string | null;
  };
  strategy: {
    effectiveStrategyStart: string | null;
    setValue: Dispatch<SetStateAction<string>>;
    showWarmupWarning: boolean;
    value: string;
    warmupDays: number;
    warmupDesc: string;
  };
  universe: {
    batchId: string | null;
    batchStatus: UniverseBatchStatusSummary | null;
    hasMissingTickers: boolean;
    isLoading: boolean;
    isReady: boolean;
    loadState: (universeId: UniverseId, options?: { createBatch?: boolean }) => Promise<void>;
    minStartDateStr: string | null;
    missingTickers: string[];
    setValue: Dispatch<SetStateAction<UniverseId>>;
    value: UniverseId;
  };
};

export function RunFormFields({
  capital,
  dates,
  defaults,
  options,
  status,
  strategy,
  universe,
}: RunFormFieldsProps) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name" className="text-muted-foreground text-[12px] font-medium">
          Run name
        </Label>
        <Input
          id="name"
          name="name"
          placeholder="e.g. Momentum 2015–2020"
          className="bg-secondary/40 border-border h-8 text-[13px]"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-muted-foreground text-[12px] font-medium">Strategy</Label>
        <NativeSelect
          name="strategy_id"
          value={strategy.value}
          onChange={(e) => strategy.setValue(e.target.value)}
          required
          hasValue={!!strategy.value}
          className="border-border bg-secondary/40 h-8 pr-8 pl-3 text-[13px]"
        >
          <option value="" disabled>
            Select a strategy...
          </option>
          {STRATEGIES.map(([id, label]) => (
            <option key={id} value={id} className="text-foreground">
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-muted-foreground text-[12px] font-medium">Universe</Label>
        <NativeSelect
          name="universe"
          value={universe.value}
          onChange={(e) => universe.setValue(e.target.value as UniverseId)}
          required
          hasValue
          className="border-border bg-secondary/40 h-8 pr-8 pl-3 text-[13px]"
        >
          {ALL_UNIVERSES.map((preset) => (
            <option key={preset} value={preset} className="text-foreground">
              {preset}
            </option>
          ))}
        </NativeSelect>
        {universe.minStartDateStr ? (
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            Earliest valid start for this universe:{" "}
            <span className="text-foreground font-mono">{universe.minStartDateStr}</span> (because
            some assets started later).
          </p>
        ) : (
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            Earliest valid start will appear once every ticker in this universe is ingested.
          </p>
        )}
        <UniverseStatusNotice
          batchStatus={universe.batchStatus}
          hasMissingTickers={universe.hasMissingTickers}
          isUniverseLoading={universe.isLoading}
          isUniverseReady={universe.isReady}
          loadUniverseState={universe.loadState}
          missingTickers={universe.missingTickers}
          universe={universe.value}
          universeBatchId={universe.batchId}
        />
      </div>

      <DateRangeFields
        coverageMin={dates.coverageMin}
        dataCoverage={dates.dataCoverage}
        dataCurrencyStr={dates.dataCurrencyStr}
        endDate={dates.endDate}
        endDateStr={dates.endDateStr}
        endOpen={dates.endOpen}
        maxEndDateStr={dates.maxEndDateStr}
        minStartDateStr={dates.minStartDateStr}
        setDateAdjustmentMessage={dates.setDateAdjustmentMessage}
        setEndDate={dates.setEndDate}
        setEndOpen={dates.setEndOpen}
        setStartDate={dates.setStartDate}
        setStartOpen={dates.setStartOpen}
        startDate={dates.startDate}
        startDateStr={dates.startDateStr}
        startOpen={dates.startOpen}
      />

      <WarmupWarning
        effectiveStrategyStart={strategy.effectiveStrategyStart}
        showWarmupWarning={strategy.showWarmupWarning}
        strategy={strategy.value}
        warmupDays={strategy.warmupDays}
        warmupDesc={strategy.warmupDesc}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="initial_capital" className="text-muted-foreground text-[12px] font-medium">
          Initial Capital ($)
        </Label>
        <div className="flex gap-2">
          <Input
            id="initial_capital"
            type="text"
            inputMode="numeric"
            value={capital.display}
            onChange={capital.onChange}
            onBlur={capital.onBlur}
            className="bg-secondary/40 border-border h-8 min-w-0 flex-1 text-[13px]"
          />
          <div className="flex shrink-0 gap-1">
            {CAPITAL_PRESETS.map(({ label, value }) => (
              <Button
                key={label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => capital.setPreset(value)}
                className={cn(
                  "border-border bg-secondary/40 h-8 px-2.5 text-[11px] font-medium",
                  capital.value === value && "border-emerald-700 bg-emerald-950/30 text-emerald-400"
                )}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="benchmark" className="text-muted-foreground text-[12px] font-medium">
            Benchmark
          </Label>
          <NativeSelect
            id="benchmark"
            name="benchmark"
            value={options.benchmark}
            onChange={(e) =>
              options.setBenchmark(e.target.value as (typeof BENCHMARK_OPTIONS)[number])
            }
            hasValue
            className="border-border bg-secondary/40 h-8 pr-8 pl-3 text-[13px]"
          >
            {BENCHMARK_OPTIONS.map((b) => (
              <option key={b} value={b} className="text-foreground">
                {b}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="costs_bps" className="text-muted-foreground text-[12px] font-medium">
            Costs (bps)
          </Label>
          <Input
            id="costs_bps"
            name="costs_bps"
            type="number"
            min={0}
            max={500}
            step={1}
            defaultValue={defaults?.default_costs_bps ?? 10}
            className="bg-secondary/40 border-border h-8 text-[13px]"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="top_n" className="text-muted-foreground text-[12px] font-medium">
            Top N
          </Label>
          <Input
            id="top_n"
            name="top_n"
            type="number"
            min={1}
            max={options.topNMax}
            step={1}
            value={options.topNValue}
            onChange={(e) => options.setTopNValue(e.target.value)}
            className="bg-secondary/40 border-border h-8 text-[13px]"
            required
          />
          <span className="text-muted-foreground text-[11px]">
            Max {options.topNMax} for {universe.value}
          </span>
        </div>
      </div>

      <Separator className="bg-border/50 my-1" />

      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Label
            htmlFor="apply_costs_toggle"
            className="text-foreground cursor-pointer text-[12px] font-medium"
          >
            Apply transaction costs
          </Label>
          <span className="text-muted-foreground text-[11px]">
            Deduct costs_bps from returns at each rebalance
          </span>
        </div>
        <Switch
          id="apply_costs_toggle"
          checked={options.applyCosts}
          onCheckedChange={options.setApplyCosts}
          className="data-[state=checked]:bg-emerald-600"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slippage_bps" className="text-muted-foreground text-[12px] font-medium">
          Slippage (bps)
          <span className="ml-1.5 text-[11px] font-normal opacity-60">optional</span>
        </Label>
        <Input
          id="slippage_bps"
          name="slippage_bps"
          type="number"
          min={0}
          max={500}
          step={1}
          defaultValue={defaults?.slippage_bps_default ?? 0}
          className="bg-secondary/40 border-border h-8 text-[13px]"
        />
      </div>

      <FormMessages
        dateAdjustmentMessage={status.dateAdjustmentMessage}
        submitError={status.submitError}
      />

      <RunFormSubmitButton
        isPreflighting={status.isPreflighting}
        isQueueDisabled={status.isQueueDisabled}
        isSubmitting={status.isSubmitting}
      />
    </>
  );
}
