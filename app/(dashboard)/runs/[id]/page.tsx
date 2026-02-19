"use client"

import { use } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AppShell } from "@/components/layout/app-shell"
import { StatusBadge } from "@/components/status-badge"
import { OverviewTab } from "@/components/run-detail/overview-tab"
import { HoldingsTab } from "@/components/run-detail/holdings-tab"
import { TradesTab } from "@/components/run-detail/trades-tab"
import { MlInsightsTab } from "@/components/run-detail/ml-insights-tab"
import { runs } from "@/lib/mock"
import { STRATEGY_LABELS } from "@/lib/types"

export default function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const run = runs.find((r) => r.id === id)

  if (!run) {
    notFound()
  }

  return (
    <AppShell title={run.name}>
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/runs">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Back to runs"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="text-base font-semibold text-foreground truncate">
              {run.name}
            </h2>
            <Badge
              variant="outline"
              className="text-[10px] font-medium px-2 py-0 h-5 leading-5 rounded-md border-border text-muted-foreground bg-secondary/50 shrink-0"
            >
              {STRATEGY_LABELS[run.strategyId]}
            </Badge>
            <StatusBadge status={run.status} />
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[12px] font-medium border-border text-muted-foreground hover:text-foreground shrink-0"
        >
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Download Report
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="bg-secondary/50 h-9 p-0.5 rounded-lg w-fit">
          <TabsTrigger
            value="overview"
            className="text-[12px] font-medium h-8 rounded-md px-3 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="holdings"
            className="text-[12px] font-medium h-8 rounded-md px-3 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
          >
            Holdings
          </TabsTrigger>
          <TabsTrigger
            value="trades"
            className="text-[12px] font-medium h-8 rounded-md px-3 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
          >
            Trades
          </TabsTrigger>
          <TabsTrigger
            value="ml-insights"
            className="text-[12px] font-medium h-8 rounded-md px-3 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
          >
            ML Insights
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab run={run} />
        </TabsContent>
        <TabsContent value="holdings" className="mt-4">
          <HoldingsTab />
        </TabsContent>
        <TabsContent value="trades" className="mt-4">
          <TradesTab />
        </TabsContent>
        <TabsContent value="ml-insights" className="mt-4">
          <MlInsightsTab />
        </TabsContent>
      </Tabs>
    </AppShell>
  )
}
