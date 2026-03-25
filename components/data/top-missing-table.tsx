"use client";

import { useState } from "react";
import type { TickerMissingnessV2 } from "@/lib/supabase/types";

const DEFAULT_INITIAL_ROWS = 10;

type Props = {
  rows: TickerMissingnessV2[];
  initialRows?: number;
  allowExpand?: boolean;
  showPreInception?: boolean;
  emptyMessage?: string;
  firstDateLabel?: string;
};

export function TopMissingTable({
  rows,
  initialRows = DEFAULT_INITIAL_ROWS,
  allowExpand = true,
  showPreInception = true,
  emptyMessage = "No true data gaps detected. All ingested tickers have full coverage within their own windows.",
  firstDateLabel = "Inception",
}: Props) {
  const [showAll, setShowAll] = useState(false);

  if (rows.length === 0) {
    return <p className="text-muted-foreground py-4 text-center text-xs">{emptyMessage}</p>;
  }

  const displayed = showAll ? rows : rows.slice(0, initialRows);

  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-border border-b">
            <th className="text-muted-foreground py-2 pr-3 text-left font-medium">Ticker</th>
            <th className="text-muted-foreground py-2 pr-2 text-right font-medium">
              {firstDateLabel}
            </th>
            <th className="text-muted-foreground py-2 pr-2 text-right font-medium">True Missing</th>
            {showPreInception && (
              <th className="text-muted-foreground text-muted-foreground/60 py-2 pr-2 text-right font-medium">
                Pre-Inc.
              </th>
            )}
            <th className="text-muted-foreground py-2 text-right font-medium">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {displayed.map((row) => {
            const pct = row.coveragePercent;
            const textColor =
              pct >= 99 ? "text-emerald-400" : pct >= 95 ? "text-amber-400" : "text-red-400";
            return (
              <tr key={row.ticker} className="border-border/50 border-b last:border-0">
                <td className="text-foreground py-1.5 pr-3 font-mono font-medium">{row.ticker}</td>
                <td className="text-muted-foreground py-1.5 pr-2 text-right font-mono">
                  {row.firstDate.slice(0, 7)}
                </td>
                <td className="text-foreground py-1.5 pr-2 text-right">
                  {row.trueMissingDays.toLocaleString()}
                </td>
                {showPreInception && (
                  <td className="text-muted-foreground/50 py-1.5 pr-2 text-right">
                    {row.preInceptionDays > 0 ? row.preInceptionDays.toLocaleString() : "—"}
                  </td>
                )}
                <td className={`py-1.5 text-right font-medium ${textColor}`}>{pct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {allowExpand && rows.length > initialRows && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-muted-foreground hover:text-foreground mt-2 text-xs underline underline-offset-2"
        >
          {showAll ? "Show fewer" : `Show all ${rows.length} tickers`}
        </button>
      )}
    </div>
  );
}
