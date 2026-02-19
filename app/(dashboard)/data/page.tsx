import { AppShell } from "@/components/layout/app-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Database } from "lucide-react"

export default function DataPage() {
  return (
    <AppShell title="Data">
      <Card className="bg-card border-border">
        <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center">
            <Database className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <h2 className="text-sm font-semibold text-foreground">
              Data sources
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-[320px]">
              Manage market data feeds, upload custom datasets, and configure data pipelines for your backtests.
            </p>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  )
}
