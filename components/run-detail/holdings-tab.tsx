import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { holdings } from "@/lib/mock"

const sectorColors: Record<string, string> = {
  Technology: "border-chart-1/30 text-chart-1 bg-chart-1/8",
  Financials: "border-chart-2/30 text-chart-2 bg-chart-2/8",
  Healthcare: "border-chart-3/30 text-chart-3 bg-chart-3/8",
  Energy: "border-chart-4/30 text-chart-4 bg-chart-4/8",
  "Consumer Disc.": "border-primary/30 text-primary bg-primary/8",
  "Consumer Staples": "border-chart-5/30 text-chart-5 bg-chart-5/8",
  Industrials: "border-chart-3/30 text-chart-3 bg-chart-3/8",
}

export function HoldingsTab() {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[13px] font-medium text-card-foreground">
            Current Holdings
          </CardTitle>
          <span className="text-[11px] text-muted-foreground font-mono">
            {holdings.length} positions
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-1">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-[11px] text-muted-foreground font-medium pl-4">
                  Ticker
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium hidden sm:table-cell">
                  Name
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium">
                  Sector
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium text-right">
                  Weight
                </TableHead>
                <TableHead className="text-[11px] text-muted-foreground font-medium text-right pr-4">
                  P&L
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holdings.map((h) => (
                <TableRow key={h.ticker} className="border-border/40 hover:bg-accent/30">
                  <TableCell className="pl-4 py-2.5 text-[13px] font-mono font-medium text-card-foreground">
                    {h.ticker}
                  </TableCell>
                  <TableCell className="py-2.5 text-[12px] text-muted-foreground hidden sm:table-cell">
                    {h.name}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] font-medium px-2 py-0 h-5 leading-5 rounded-md",
                        sectorColors[h.sector] || "border-border text-muted-foreground bg-muted/50"
                      )}
                    >
                      {h.sector}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2.5 text-[13px] font-mono text-right text-card-foreground">
                    {h.weight.toFixed(1)}%
                  </TableCell>
                  <TableCell
                    className={cn(
                      "py-2.5 text-[13px] font-mono text-right pr-4",
                      h.pnl >= 0 ? "text-success" : "text-destructive"
                    )}
                  >
                    {h.pnl >= 0 ? "+" : ""}${Math.abs(h.pnl).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
