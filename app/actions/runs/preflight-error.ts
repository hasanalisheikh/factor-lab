import "server-only";

import { finalizeRunPreflightResult, type RunPreflightResult } from "@/lib/coverage-check";
import { getLastCompleteTradingDayUtc } from "@/lib/data-cutoff";
import type { UniverseConstraintsSnapshot } from "@/lib/supabase/queries";

export function buildErrorPreflightResult(
  message: string,
  constraints: UniverseConstraintsSnapshot
): RunPreflightResult {
  const maxEndDate = getLastCompleteTradingDayUtc();
  return finalizeRunPreflightResult({
    constraints: {
      dataCutoffDate: maxEndDate,
      universeEarliestStart: constraints.universeEarliestStart,
      universeValidFrom: constraints.universeValidFrom,
      minStartDate:
        constraints.universeEarliestStart && constraints.universeValidFrom
          ? constraints.universeEarliestStart > constraints.universeValidFrom
            ? constraints.universeEarliestStart
            : constraints.universeValidFrom
          : (constraints.universeEarliestStart ?? constraints.universeValidFrom ?? null),
      maxEndDate,
      missingTickers: constraints.missingTickers,
      warmupStart: "",
      requiredStart: "",
      requiredEnd: maxEndDate,
    },
    coverage: {
      benchmark: {
        status: "blocked",
        reason: message,
        metricSourceUsed: "db_wide",
        trueMissingRate: 1,
        symbol: "",
        windowStartUsed: "",
        windowEndUsed: maxEndDate,
        expectedDays: 0,
        actualDays: 0,
        missingDays: 0,
      },
      universe: {
        status: "blocked",
        reason: message,
        over2Percent: [],
        over10Percent: [],
        affectedShare: 0,
      },
      symbols: [],
      benchmarkCandidates: [],
    },
    warmupStart: "",
    requiredStart: "",
    requiredEnd: maxEndDate,
    issues: [
      {
        severity: "blocked",
        code: "config_error",
        reason: message,
        fix: "Update the run settings, then try again.",
        action: null,
      },
    ],
  });
}
