import { AppShell } from "@/components/layout/app-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getDataHealthSummary } from "@/lib/supabase/queries"
import { Calendar, Clock3, Database, AlertTriangle } from "lucide-react"

export const dynamic = "force-dynamic"

function formatDate(value: string | null): string {
  if (!value) return "N/A"
  return new Date(`${value}T00:00:00Z`).toLocaleDateString()
}

function formatTimestamp(value: string | null): string {
  if (!value) return "N/A"
  return new Date(value).toLocaleString()
}

export default async function DataPage() {
  const health = await getDataHealthSummary()

  return (
    <AppShell title="Data">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Tickers Ingested
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-2xl font-semibold text-foreground">
              {health.tickersCount}
            </p>
            <Database className="w-5 h-5 text-muted-foreground" />
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Date Coverage
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              {formatDate(health.dateStart)} to {formatDate(health.dateEnd)}
            </p>
            <Calendar className="w-5 h-5 text-muted-foreground" />
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Missing Days
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-2xl font-semibold text-foreground">
              {health.missingDaysCount}
            </p>
            <AlertTriangle className="w-5 h-5 text-muted-foreground" />
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Last Updated
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              {formatTimestamp(health.lastUpdatedAt)}
            </p>
            <Clock3 className="w-5 h-5 text-muted-foreground" />
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border mt-4">
        <CardContent className="flex flex-col items-center justify-center py-8 gap-3">
          <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
            <Database className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="text-center max-w-[520px]">
            <h2 className="text-sm font-semibold text-foreground">Data Health</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Metrics are based on the `prices` and `data_last_updated` tables.
              Missing-days uses business-day approximation (Mon-Fri) across observed
              coverage and ingested ticker set.
            </p>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  )
}
