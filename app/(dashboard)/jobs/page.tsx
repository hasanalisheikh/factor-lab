import { DashboardHeader } from "@/components/dashboard-header"
import { Card, CardContent } from "@/components/ui/card"
import { Server } from "lucide-react"

export default function JobsPage() {
  return (
    <>
      <DashboardHeader title="Jobs" />
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 lg:p-6 flex flex-col gap-6 max-w-[1440px]">
          <Card className="bg-card border-border">
            <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center">
                <Server className="w-6 h-6 text-muted-foreground" />
              </div>
              <div className="text-center">
                <h2 className="text-sm font-semibold text-foreground">
                  Job queue
                </h2>
                <p className="text-xs text-muted-foreground mt-1 max-w-[320px]">
                  Monitor running, queued, and completed backtest jobs. View logs, cancel pending runs, or requeue failed ones.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  )
}
