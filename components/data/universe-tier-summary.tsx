import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import {
  UNIVERSE_PRESETS,
  UNIVERSE_LABELS,
  type UniverseId,
  summarizeUniverseConstraints,
} from "@/lib/universe-config";
import { type TickerDateRange, COVERAGE_WINDOW_START } from "@/lib/supabase/types";
import { formatISODate } from "@/lib/utils/dates";

type Props = {
  ranges: TickerDateRange[];
  notIngested: string[];
  mode: "backtest" | "full";
};

type UniverseSummary = {
  id: string;
  label: string;
  validFrom: string | null;
  ingestedCount: number;
  totalCount: number;
  missingTickers: string[];
};

export function UniverseTierSummary({ ranges, notIngested, mode }: Props) {
  const ingestedSet = new Set(ranges.map((r) => r.ticker));
  const notIngestedSet = new Set(notIngested);

  const summaries: UniverseSummary[] = (
    Object.entries(UNIVERSE_PRESETS) as [UniverseId, readonly string[]][]
  ).map(([id, tickers]) => {
    const summary = summarizeUniverseConstraints(id, ranges);
    const missing = summary.missingTickers.filter(
      (ticker) => notIngestedSet.has(ticker) || !ingestedSet.has(ticker)
    );
    return {
      id,
      label: UNIVERSE_LABELS[id],
      validFrom: summary.validFrom,
      ingestedCount: tickers.length - missing.length,
      totalCount: tickers.length,
      missingTickers: missing,
    };
  });

  // Group by validFrom year bucket
  const tierMap = new Map<string, UniverseSummary[]>();
  for (const s of summaries) {
    const tierLabel = s.validFrom ? `${s.validFrom.slice(0, 4)}+` : "Not available";
    const bucket = tierMap.get(tierLabel);
    if (bucket) {
      bucket.push(s);
    } else {
      tierMap.set(tierLabel, [s]);
    }
  }
  const tiers = [...tierMap.entries()].sort(([a], [b]) => a.localeCompare(b));

  const backtestWindowStart = formatISODate(COVERAGE_WINDOW_START);

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-foreground text-sm font-semibold">
          Universe Tier Summary
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          A universe&apos;s earliest start is the latest inception date among its tickers. We only
          show that date after every ticker in the preset has been ingested.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {tiers.map(([tierLabel, items]) => (
          <div key={tierLabel}>
            {/* Tier divider */}
            <div className="mb-2 flex items-center gap-2">
              <span className="text-muted-foreground/60 bg-muted/40 border-border/50 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
                {tierLabel}
              </span>
              <div className="bg-border/40 h-px flex-1" />
            </div>

            {/* Universe rows */}
            <div className="space-y-2">
              {items.map((s) => {
                const isComplete = s.missingTickers.length === 0;
                return (
                  <div
                    key={s.id}
                    className="bg-muted/20 border-border/30 flex flex-col gap-1 rounded-md border px-2 py-1.5 sm:flex-row sm:items-center sm:gap-3"
                  >
                    {/* Universe name */}
                    <span className="text-foreground min-w-[180px] text-xs font-medium">
                      {s.label}
                    </span>

                    {/* Earliest start */}
                    <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground/60">Earliest start:</span>
                      <span className="text-foreground/80 font-mono">
                        {s.validFrom ? formatISODate(s.validFrom) : "Pending ingest"}
                      </span>
                    </div>

                    {/* Ingested count */}
                    <div className="flex items-center gap-1 text-xs">
                      {isComplete ? (
                        <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="h-3 w-3 flex-shrink-0 text-amber-400" />
                      )}
                      <span className={isComplete ? "text-emerald-400" : "text-amber-400"}>
                        {s.ingestedCount} / {s.totalCount} ingested
                      </span>
                    </div>

                    {/* Missing tickers badge */}
                    {s.missingTickers.length > 0 && (
                      <div className="flex items-center gap-1 rounded border border-amber-800/40 bg-amber-950/40 px-1.5 py-0.5">
                        <AlertTriangle className="h-3 w-3 flex-shrink-0 text-amber-400" />
                        <span className="text-[10px] text-amber-300/80">
                          Missing: <span className="font-mono">{s.missingTickers.join(", ")}</span>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Footer note for backtest mode */}
        {mode === "backtest" && (
          <div className="border-border/40 flex items-start gap-2 border-t pt-2">
            <Info className="text-muted-foreground mt-0.5 h-3 w-3 flex-shrink-0" />
            <p className="text-muted-foreground/70 text-[10px] leading-relaxed">
              In Backtest-ready mode, backtests clamp to{" "}
              <strong>max(valid-from, {backtestWindowStart})</strong>. Presets with valid-from
              before {backtestWindowStart.slice(-4)} can start from {backtestWindowStart}.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
