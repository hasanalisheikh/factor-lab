import { format } from "date-fns";

import { getLastCompleteTradingDayUtc } from "@/lib/data-cutoff";

import { parseLocalDate, resolveMinStartDate } from "./run-form-schema";

import type { EnsureUniverseDataReadyResult } from "@/app/actions/runs";
import type { UserSettings } from "@/lib/supabase/types";
import type { DataCoverage } from "./run-form-schema";

type RunFormDefaultsInput = {
  defaults: UserSettings | null;
  dataCoverage?: DataCoverage | null;
  initialUniverseState: EnsureUniverseDataReadyResult;
};

export function useRunFormDefaults({
  defaults,
  dataCoverage,
  initialUniverseState,
}: RunFormDefaultsInput) {
  const coverageMin = dataCoverage ? parseLocalDate(dataCoverage.minDateStr) : null;
  // Always allow runs up to today. The preflight system queues data-ingest jobs
  // for any coverage gap and advances the run through waiting_for_data.
  const todayStr = getLastCompleteTradingDayUtc();
  // initialMaxEndDate drives the default end-date value shown in the form.
  // Do NOT use dataCutoffDate here — it may be stale (e.g. March 2025) and would
  // cause every new run to silently default to the old cutoff. todayStr is the
  // correct default; dataCutoffDate is only shown in the informational label.
  const initialMaxEndDate = todayStr;
  const initialMinStartDate = resolveMinStartDate(
    initialUniverseState.constraints.universeEarliestStart,
    initialUniverseState.constraints.universeValidFrom
  );
  const initialStartDate = (() => {
    const yearsBack = defaults?.default_date_range_years ?? 5;
    if (initialMaxEndDate) {
      const candidate = parseLocalDate(initialMaxEndDate);
      candidate.setFullYear(candidate.getFullYear() - yearsBack);
      if (coverageMin && candidate < coverageMin) {
        return new Date(coverageMin);
      }
      if (initialMinStartDate && format(candidate, "yyyy-MM-dd") < initialMinStartDate) {
        return parseLocalDate(initialMinStartDate);
      }
      return candidate;
    }
    return undefined;
  })();
  const initialEndDate = initialMaxEndDate ? parseLocalDate(initialMaxEndDate) : undefined;

  return {
    coverageMin,
    todayStr,
    initialMaxEndDate,
    initialMinStartDate,
    initialStartDate,
    initialEndDate,
  };
}
