import { AppShell } from "@/components/layout/app-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getStrategyComparisonRuns, type RunMetricsRow } from "@/lib/supabase/queries"
import { STRATEGY_LABELS, type StrategyId } from "@/lib/types"

function getMetrics(value: RunMetricsRow[] | RunMetricsRow | null): RunMetricsRow | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function fmtPct(value: number | null, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "--"
  return `${(value * 100).toFixed(digits)}%`
}

function fmtNum(value: number | null, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "--"
  return value.toFixed(digits)
}

export default async function ComparePage() {
  const runs = await getStrategyComparisonRuns()
  const rows = runs.map((run) => {
    const metrics = getMetrics(run.run_metrics)
    return {
      run,
      metrics,
      strategyLabel: STRATEGY_LABELS[run.strategy_id as StrategyId] ?? run.strategy_id,
    }
  })
  const baseline = rows.find((r) => r.run.strategy_id === "equal_weight")?.metrics

  return (
    <AppShell title="Compare">
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">
            Strategy Snapshot (Latest Completed Run per Strategy)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No completed runs available.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/70 text-muted-foreground">
                    <th className="text-left py-2 pr-3 font-medium">Strategy</th>
                    <th className="text-right py-2 px-3 font-medium">CAGR</th>
                    <th className="text-right py-2 px-3 font-medium">Sharpe</th>
                    <th className="text-right py-2 px-3 font-medium">Max DD</th>
                    <th className="text-right py-2 px-3 font-medium">Turnover</th>
                    <th className="text-right py-2 pl-3 font-medium">CAGR vs EW</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ run, metrics, strategyLabel }) => {
                    const cagrDelta = metrics && baseline ? metrics.cagr - baseline.cagr : null
                    const isMl = run.strategy_id === "ml_ridge" || run.strategy_id === "ml_lightgbm"
                    return (
                      <tr
                        key={run.id}
                        className={`border-b border-border/40 last:border-0 ${isMl ? "bg-accent/40" : ""}`}
                      >
                        <td className="py-2 pr-3 text-foreground font-medium">{strategyLabel}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmtPct(metrics?.cagr ?? null)}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmtNum(metrics?.sharpe ?? null)}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmtPct(metrics?.max_drawdown ?? null)}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmtPct(metrics?.turnover ?? null)}</td>
                        <td className="py-2 pl-3 text-right font-mono">
                          {cagrDelta == null ? "--" : `${cagrDelta >= 0 ? "+" : ""}${fmtPct(cagrDelta)}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  )
}
