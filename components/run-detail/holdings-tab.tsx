import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { ModelPredictionRow } from "@/lib/supabase/queries"

function formatPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "--"
  return `${(Number(v) * 100).toFixed(2)}%`
}

function getLatestHoldings(predictions: ModelPredictionRow[]): ModelPredictionRow[] {
  if (predictions.length === 0) return []
  // Predictions are ordered as_of_date DESC — first row has the latest date
  const latestAsOf = predictions[0].as_of_date
  return predictions
    .filter((r) => r.as_of_date === latestAsOf && r.selected)
    .sort((a, b) => a.rank - b.rank)
}

interface HoldingsTabProps {
  predictions?: ModelPredictionRow[]
}

export function HoldingsTab({ predictions = [] }: HoldingsTabProps) {
  const holdings = getLatestHoldings(predictions)

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[13px] font-medium text-card-foreground">
            Current Holdings
          </CardTitle>
          {holdings.length > 0 && (
            <span className="text-[11px] text-muted-foreground font-mono">
              {holdings.length} positions
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-1">
        {holdings.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
            Holdings breakdown available for ML strategy runs.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-[11px] text-muted-foreground font-medium pl-4 w-12">
                    Rank
                  </TableHead>
                  <TableHead className="text-[11px] text-muted-foreground font-medium">
                    Ticker
                  </TableHead>
                  <TableHead className="text-[11px] text-muted-foreground font-medium text-right">
                    Weight
                  </TableHead>
                  <TableHead className="text-[11px] text-muted-foreground font-medium text-right hidden sm:table-cell">
                    Predicted Ret
                  </TableHead>
                  <TableHead className="text-[11px] text-muted-foreground font-medium text-right pr-4">
                    Realized Ret
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdings.map((h) => (
                  <TableRow
                    key={`${h.as_of_date}-${h.ticker}`}
                    className="border-border/40 hover:bg-accent/30"
                  >
                    <TableCell className="pl-4 py-2.5 text-[12px] font-mono text-muted-foreground">
                      #{h.rank}
                    </TableCell>
                    <TableCell className="py-2.5 text-[13px] font-mono font-medium text-card-foreground">
                      {h.ticker}
                    </TableCell>
                    <TableCell className="py-2.5 text-[13px] font-mono text-right text-card-foreground">
                      {formatPct(Number(h.weight))}
                    </TableCell>
                    <TableCell className="py-2.5 text-[13px] font-mono text-right text-card-foreground hidden sm:table-cell">
                      {formatPct(Number(h.predicted_return))}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "py-2.5 text-[13px] font-mono text-right pr-4",
                        h.realized_return == null
                          ? "text-muted-foreground"
                          : Number(h.realized_return) >= 0
                          ? "text-success"
                          : "text-destructive"
                      )}
                    >
                      {h.realized_return == null ? "--" : formatPct(Number(h.realized_return))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
