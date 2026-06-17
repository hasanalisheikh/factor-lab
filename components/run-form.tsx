"use client";

import { useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { RunFormFields } from "./run-form/run-form-fields";
import { PreflightDialogs } from "./run-form/run-form-submit";
import { useCapitalSettings } from "./run-form/use-capital-settings";
import { useRunFormDateRange } from "./run-form/use-run-form-date-range";
import { useRunFormOptions } from "./run-form/use-run-form-options";
import { useRunFormSubmit } from "./run-form/use-run-form-submit";
import { useUniverseReadiness } from "./run-form/use-universe-readiness";

import type { RunFormProps } from "./run-form/run-form-schema";

export function RunForm({
  defaults,
  dataCoverage,
  initialUniverseState,
  diagnostics = false,
}: RunFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const universe = useUniverseReadiness({ defaults, initialUniverseState });
  const dateRange = useRunFormDateRange({
    dataCoverage,
    dataCurrencyStr: universe.state.constraints.dataCutoffDate ?? dataCoverage?.maxDateStr ?? null,
    defaults,
    initialUniverseState,
    minStartDateStr: universe.minStartDateStr,
    universe: universe.value,
  });
  const capital = useCapitalSettings(defaults);
  const runOptions = useRunFormOptions({
    dataCoverage,
    defaults,
    startDateStr: dateRange.startDateStr,
    universe: universe.value,
  });
  const submit = useRunFormSubmit({
    applyCosts: runOptions.applyCosts,
    benchmark: runOptions.benchmark,
    capitalValue: capital.value,
    endDate: dateRange.endDate,
    formRef,
    loadUniverseState: universe.loadState,
    router,
    setBenchmark: runOptions.setBenchmark,
    setDateAdjustmentMessage: dateRange.setDateAdjustmentMessage,
    setEndDate: dateRange.setEndDate,
    setStartDate: dateRange.setStartDate,
    setTopNValue: runOptions.setTopNValue,
    startDate: dateRange.startDate,
    topNValue: runOptions.topNValue,
    universe: universe.value,
    universeState: universe.state,
  });

  const isQueueDisabled =
    !runOptions.strategy ||
    universe.isLoading ||
    submit.isPreflighting ||
    submit.isSubmitting ||
    !universe.isReady;
  const submitError = submit.submitError ?? universe.loadError;

  return (
    <>
      <div className="mb-1 flex items-center gap-3">
        <Link href="/runs">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground h-8 w-8"
            aria-label="Back to runs"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h2 className="text-foreground text-base font-semibold">New Backtest Run</h2>
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="px-5 pt-5 pb-3">
          <CardTitle className="text-card-foreground text-[13px] font-medium">
            Configure Run
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <form ref={formRef} onSubmit={submit.handleSubmit} className="flex flex-col gap-4">
            <RunFormFields
              capital={capital.controller}
              dates={dateRange.controller}
              defaults={defaults}
              options={runOptions.optionsController}
              status={{
                dateAdjustmentMessage: dateRange.dateAdjustmentMessage,
                isPreflighting: submit.isPreflighting,
                isQueueDisabled,
                isSubmitting: submit.isSubmitting,
                submitError,
              }}
              strategy={runOptions.strategyController}
              universe={universe.controller}
            />
          </form>
        </CardContent>
      </Card>

      <PreflightDialogs
        applySuggestedFix={submit.applySuggestedFix}
        blockResult={submit.blockResult}
        diagnostics={diagnostics}
        runCreate={submit.runCreate}
        setBlockResult={submit.setBlockResult}
        setWarnResult={submit.setWarnResult}
        warnResult={submit.warnResult}
      />
    </>
  );
}
