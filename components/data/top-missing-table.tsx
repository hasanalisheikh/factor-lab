"use client"

import { useState } from "react"
import type { TickerMissingnessV2 } from "@/lib/supabase/types"

const INITIAL_ROWS = 10

export function TopMissingTable({ rows }: { rows: TickerMissingnessV2[] }) {
  const [showAll, setShowAll] = useState(false)

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        No true data gaps detected. All ingested tickers have full coverage within their own windows.
      </p>
    )
  }

  const displayed = showAll ? rows : rows.slice(0, INITIAL_ROWS)

  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Ticker</th>
            <th className="text-right py-2 pr-2 font-medium text-muted-foreground">Inception</th>
            <th className="text-right py-2 pr-2 font-medium text-muted-foreground">True Missing</th>
            <th className="text-right py-2 pr-2 font-medium text-muted-foreground text-muted-foreground/60">Pre-Inc.</th>
            <th className="text-right py-2 font-medium text-muted-foreground">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {displayed.map((row) => {
            const pct = row.coveragePercent
            const textColor =
              pct >= 99 ? "text-emerald-400" : pct >= 95 ? "text-amber-400" : "text-red-400"
            return (
              <tr key={row.ticker} className="border-b border-border/50 last:border-0">
                <td className="py-1.5 pr-3 font-mono font-medium text-foreground">
                  {row.ticker}
                </td>
                <td className="py-1.5 pr-2 text-right text-muted-foreground font-mono">
                  {row.firstDate.slice(0, 7)}
                </td>
                <td className="py-1.5 pr-2 text-right text-foreground">
                  {row.trueMissingDays.toLocaleString()}
                </td>
                <td className="py-1.5 pr-2 text-right text-muted-foreground/50">
                  {row.preInceptionDays > 0 ? row.preInceptionDays.toLocaleString() : "—"}
                </td>
                <td className={`py-1.5 text-right font-medium ${textColor}`}>
                  {pct.toFixed(1)}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length > INITIAL_ROWS && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          {showAll ? "Show fewer" : `Show all ${rows.length} tickers`}
        </button>
      )}
    </div>
  )
}
