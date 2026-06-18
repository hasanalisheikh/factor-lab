import { TICKER_INCEPTION_DATES } from "@/lib/supabase/types";
import {
  addCalendarDays,
  countBusinessDays,
  formatDateForMessage,
} from "@/lib/coverage-check/date-utils";

import type { PreflightStatus, SymbolCoverage } from "@/lib/coverage-check/types";

/**
 * Classify unhealthy symbols as USER_ACTION_REQUIRED vs WAITING_FOR_DATA.
 *
 * A symbol is USER_ACTION_REQUIRED when it has a known inception date that is
 * later than requiredStart AND even with full price history from inception the
 * coverage ratio would still fall below the threshold. This means ingestion
 * cannot fix the problem -- the user must choose a later start date.
 */
export function classifyUnhealthySymbols(
  unhealthy: SymbolCoverage[],
  requiredStart: string,
  requiredEnd: string,
  expectedDays: number,
  warmupDays: number
): { status: PreflightStatus; reasons: string[] } {
  if (unhealthy.length === 0) return { status: "READY", reasons: [] };

  const reasons: string[] = [];
  let hasUserActionRequired = false;

  for (const cov of unhealthy) {
    const inceptionDate = TICKER_INCEPTION_DATES[cov.symbol];

    if (inceptionDate && inceptionDate > requiredStart) {
      const maxPossibleDays = countBusinessDays(inceptionDate, requiredEnd);
      if (expectedDays > 0 && maxPossibleDays / expectedDays < cov.threshold) {
        hasUserActionRequired = true;
        const role = cov.isBenchmark ? "benchmark" : "universe asset";
        const minStart = addCalendarDays(inceptionDate, warmupDays);
        const inceptionFmt = formatDateForMessage(inceptionDate);
        const minStartFmt = formatDateForMessage(minStart);
        if (warmupDays > 0) {
          reasons.push(
            `${cov.symbol} (${role}) started trading on ${inceptionFmt}. ` +
              `This strategy needs ~${warmupDays} calendar days of history before the start date. ` +
              `Please choose a start date of ${minStartFmt} or later.`
          );
        } else {
          reasons.push(
            `${cov.symbol} (${role}) started trading on ${inceptionFmt}. ` +
              `Please choose a start date of ${minStartFmt} or later.`
          );
        }
        continue;
      }
    }

    const role = cov.isBenchmark ? "benchmark" : "universe asset";
    if (cov.status === "not_ingested") {
      reasons.push(
        `We're missing price data for ${cov.symbol} (${role}). ` +
          `Please try again after the data refresh finishes.`
      );
    } else {
      const pct = (cov.coverageRatio * 100).toFixed(0);
      const thr = (cov.threshold * 100).toFixed(0);
      reasons.push(
        `${cov.symbol} (${role}) has ${pct}% of required price history ` +
          `(need ${thr}%). Please try again after the missing days are refreshed.`
      );
    }
  }

  if (hasUserActionRequired) {
    return { status: "USER_ACTION_REQUIRED", reasons };
  }
  return { status: "WAITING_FOR_DATA", reasons };
}

/**
 * Build a human-readable summary of why a run is waiting for data.
 * Used in the UI and in failure error messages.
 */
export function formatPreflightDiagnostic(unhealthy: SymbolCoverage[]): string {
  const lines = unhealthy.map((c) => {
    const pct = (c.coverageRatio * 100).toFixed(1);
    const thr = (c.threshold * 100).toFixed(0);
    const role = c.isBenchmark ? "benchmark" : "universe";
    if (c.status === "not_ingested") {
      return `${c.symbol} (${role}): not ingested`;
    }
    return `${c.symbol} (${role}): ${pct}% < ${thr}% required (${c.actualDays}/${c.expectedDays} days)`;
  });
  return lines.join("; ");
}
