"use client"

import { Card, CardContent } from "@/components/ui/card"
import { DeltaPill } from "@/components/delta-pill"
import { Sparkline } from "@/components/sparkline"
import type { DashboardMetric } from "@/lib/types"

interface MetricCardsProps {
  metrics: DashboardMetric[]
}

export function MetricCards({ metrics }: MetricCardsProps) {
  if (metrics.length === 0) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="h-[60px] animate-pulse bg-secondary/40 rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {metrics.map((m) => (
        <Card key={m.label} className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-1.5 min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  {m.label}
                </p>
                <p className="text-xl font-semibold font-mono text-card-foreground tracking-tight leading-none">
                  {m.value}
                </p>
                <DeltaPill value={m.delta} />
              </div>
              <div className="w-16 h-8 shrink-0">
                <Sparkline data={m.sparkline} height={32} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
