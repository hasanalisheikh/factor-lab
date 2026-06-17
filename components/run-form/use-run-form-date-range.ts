"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";

import { parseLocalDate } from "./run-form-schema";
import { useRunFormDefaults } from "./use-run-form-defaults";

import type { Dispatch, SetStateAction } from "react";
import type { EnsureUniverseDataReadyResult } from "@/app/actions/runs";
import type { UserSettings } from "@/lib/supabase/types";
import type { UniverseId } from "@/lib/universe-config";
import type { DataCoverage } from "./run-form-schema";

type UseRunFormDateRangeInput = {
  dataCoverage?: DataCoverage | null;
  dataCurrencyStr: string | null;
  defaults: UserSettings | null;
  initialUniverseState: EnsureUniverseDataReadyResult;
  minStartDateStr: string | null;
  universe: UniverseId;
};

export type RunFormDateRangeController = {
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

export function useRunFormDateRange({
  dataCoverage,
  dataCurrencyStr,
  defaults,
  initialUniverseState,
  minStartDateStr,
  universe,
}: UseRunFormDateRangeInput) {
  const { coverageMin, todayStr, initialStartDate, initialEndDate } = useRunFormDefaults({
    defaults,
    dataCoverage,
    initialUniverseState,
  });
  const [dateAdjustmentMessage, setDateAdjustmentMessage] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date | undefined>(initialStartDate);
  const [endDate, setEndDate] = useState<Date | undefined>(initialEndDate);
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  const maxEndDateStr = todayStr;
  const startDateStr = startDate ? format(startDate, "yyyy-MM-dd") : null;
  const endDateStr = endDate ? format(endDate, "yyyy-MM-dd") : null;

  useEffect(() => {
    if (!startDateStr && !endDateStr) return;

    let nextStart = startDate;
    let nextEnd = endDate;
    let snappedMessage: string | null = null;

    if (minStartDateStr && startDateStr && startDateStr < minStartDateStr) {
      nextStart = parseLocalDate(minStartDateStr);
      snappedMessage = `Start date snapped to ${minStartDateStr} because some assets in ${universe} started later.`;
    }

    if (maxEndDateStr && endDateStr && endDateStr > maxEndDateStr) {
      nextEnd = parseLocalDate(maxEndDateStr);
      snappedMessage = `End date snapped to ${maxEndDateStr} (last complete trading day).`;
    }

    const nextStartStr = nextStart ? format(nextStart, "yyyy-MM-dd") : null;
    const nextEndStr = nextEnd ? format(nextEnd, "yyyy-MM-dd") : null;
    if (nextStartStr && nextEndStr && nextStartStr > nextEndStr) {
      nextEnd = parseLocalDate(nextStartStr);
      snappedMessage = `End date snapped to ${nextStartStr} to keep the date range valid.`;
    }

    if (nextStart !== startDate || nextEnd !== endDate || snappedMessage) {
      queueMicrotask(() => {
        if (nextStart !== startDate) setStartDate(nextStart);
        if (nextEnd !== endDate) setEndDate(nextEnd);
        if (snappedMessage) setDateAdjustmentMessage(snappedMessage);
      });
    }
  }, [endDate, endDateStr, maxEndDateStr, minStartDateStr, startDate, startDateStr, universe]);

  return {
    controller: {
      coverageMin,
      dataCoverage,
      dataCurrencyStr,
      endDate,
      endDateStr,
      endOpen,
      maxEndDateStr,
      minStartDateStr,
      setDateAdjustmentMessage,
      setEndDate,
      setEndOpen,
      setStartDate,
      setStartOpen,
      startDate,
      startDateStr,
      startOpen,
    },
    dateAdjustmentMessage,
    endDate,
    endDateStr,
    maxEndDateStr,
    setDateAdjustmentMessage,
    setEndDate,
    setStartDate,
    startDate,
    startDateStr,
  };
}
