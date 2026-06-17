import { format } from "date-fns";

import type { EnsureUniverseDataReadyResult } from "@/app/actions/runs";
import type { UserSettings } from "@/lib/supabase/types";

export type DataCoverage = {
  minDateStr: string;
  maxDateStr: string;
};

export type RunFormProps = {
  defaults: UserSettings | null;
  dataCoverage?: DataCoverage | null;
  initialUniverseState: EnsureUniverseDataReadyResult;
  diagnostics?: boolean;
};

export function toInputDate(d: Date | undefined) {
  return d ? format(d, "yyyy-MM-dd") : "";
}

export function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function resolveMinStartDate(
  universeEarliestStart: string | null,
  universeValidFrom: string | null
): string | null {
  if (universeEarliestStart && universeValidFrom) {
    return universeEarliestStart > universeValidFrom ? universeEarliestStart : universeValidFrom;
  }
  return universeEarliestStart ?? universeValidFrom ?? null;
}
