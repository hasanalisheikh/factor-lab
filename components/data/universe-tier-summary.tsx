import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertTriangle, CheckCircle2, Info } from "lucide-react"
import {
  UNIVERSE_PRESETS,
  UNIVERSE_LABELS,
  type UniverseId,
  summarizeUniverseConstraints,
} from "@/lib/universe-config"
import { type TickerDateRange, COVERAGE_WINDOW_START } from "@/lib/supabase/types"
import { formatISODate } from "@/lib/utils/dates"

type Props = {
  ranges: TickerDateRange[]
  notIngested: string[]
  mode: "backtest" | "full"
}

type UniverseSummary = {
  id: string
  label: string
  validFrom: string | null
  ingestedCount: number
  totalCount: number
  missingTickers: string[]
}

export function UniverseTierSummary({ ranges, notIngested, mode }: Props) {
  const ingestedSet = new Set(ranges.map((r) => r.ticker))
  const notIngestedSet = new Set(notIngested)

  const summaries: UniverseSummary[] = (
    Object.entries(UNIVERSE_PRESETS) as [UniverseId, readonly string[]][]
  ).map(([id, tickers]) => {
    const summary = summarizeUniverseConstraints(id, ranges)
    const missing = summary.missingTickers.filter((ticker) =>
      notIngestedSet.has(ticker) || !ingestedSet.has(ticker)
    )
    return {
      id,
      label: UNIVERSE_LABELS[id],
      validFrom: summary.validFrom,
      ingestedCount: tickers.length - missing.length,
      totalCount: tickers.length,
      missingTickers: missing,
    }
  })

  // Group by validFrom year bucket
  const tierMap = new Map<string, UniverseSummary[]>()
  for (const s of summaries) {
    const tierLabel = s.validFrom ? `${s.validFrom.slice(0, 4)}+` : "Not available"
    const bucket = tierMap.get(tierLabel)
    if (bucket) {
      bucket.push(s)
    } else {
      tierMap.set(tierLabel, [s])
    }
  }
  const tiers = [...tierMap.entries()].sort(([a], [b]) => a.localeCompare(b))

  const backtestWindowStart = formatISODate(COVERAGE_WINDOW_START)

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-foreground">
          Universe Tier Summary
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          A universe&apos;s earliest start is the latest inception date among its tickers.
          We only show that date after every ticker in the preset has been ingested.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {tiers.map(([tierLabel, items]) => (
          <div key={tierLabel}>
            {/* Tier divider */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-1.5 py-0.5 rounded bg-muted/40 border border-border/50">
                {tierLabel}
              </span>
              <div className="flex-1 h-px bg-border/40" />
            </div>

            {/* Universe rows */}
            <div className="space-y-2">
              {items.map((s) => {
                const isComplete = s.missingTickers.length === 0
                return (
                  <div
                    key={s.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 py-1.5 px-2 rounded-md bg-muted/20 border border-border/30"
                  >
                    {/* Universe name */}
                    <span className="text-xs font-medium text-foreground min-w-[180px]">
                      {s.label}
                    </span>

                    {/* Earliest start */}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="text-muted-foreground/60">Earliest start:</span>
                      <span className="font-mono text-foreground/80">
                        {s.validFrom ? formatISODate(s.validFrom) : "Pending ingest"}
                      </span>
                    </div>

                    {/* Ingested count */}
                    <div className="flex items-center gap-1 text-xs">
                      {isComplete ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                      )}
                      <span
                        className={
                          isComplete ? "text-emerald-400" : "text-amber-400"
                        }
                      >
                        {s.ingestedCount} / {s.totalCount} ingested
                      </span>
                    </div>

                    {/* Missing tickers badge */}
                    {s.missingTickers.length > 0 && (
                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-800/40">
                        <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                        <span className="text-[10px] text-amber-300/80">
                          Missing:{" "}
                          <span className="font-mono">{s.missingTickers.join(", ")}</span>
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Footer note for backtest mode */}
        {mode === "backtest" && (
          <div className="flex items-start gap-2 pt-2 border-t border-border/40">
            <Info className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
              In Backtest-ready mode, backtests clamp to{" "}
              <strong>max(valid-from, {backtestWindowStart})</strong>. Presets
              with valid-from before {backtestWindowStart.slice(-4)} can start from{" "}
              {backtestWindowStart}.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
