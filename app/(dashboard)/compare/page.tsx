import { AppShell } from "@/components/layout/app-shell"
import { Card, CardContent } from "@/components/ui/card"
import { GitCompare } from "lucide-react"

export default function ComparePage() {
  return (
    <AppShell title="Compare">
      <Card className="bg-card border-border">
        <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center">
            <GitCompare className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <h2 className="text-sm font-semibold text-foreground">
              Compare backtest runs
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-[320px]">
              Select two or more runs to compare their performance, risk metrics, and factor exposures side by side.
            </p>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  )
}
