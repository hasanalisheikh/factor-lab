"use client"

import { useState } from "react"
import type { TickerMissingness } from "@/lib/supabase/queries"

const INITIAL_ROWS = 10

export function TopMissingTable({ rows }: { rows: TickerMissingness[] }) {
  const [showAll, setShowAll] = useState(false)

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        No missing ticker-days detected. All tickers have full coverage.
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
            <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Missing Days</th>
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
                <td className="py-1.5 pr-3 text-right text-foreground">
                  {row.missingDays.toLocaleString()}
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
