"use client";

import { Card, CardContent } from "@/components/ui/card";
import { DeltaPill } from "@/components/delta-pill";
import { Sparkline } from "@/components/sparkline";
import type { DashboardMetric } from "@/lib/types";

interface MetricCardsProps {
  metrics: DashboardMetric[];
}

export function MetricCards({ metrics }: MetricCardsProps) {
  if (metrics.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="bg-secondary/40 h-[60px] animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {metrics.map((m) => (
        <Card key={m.label} className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                  {m.label}
                </p>
                <p className="text-card-foreground font-mono text-xl leading-none font-semibold tracking-tight">
                  {m.value}
                </p>
                <DeltaPill
                  deltaRaw={m.deltaRaw}
                  deltaFormatted={m.deltaFormatted}
                  label={m.deltaLabel}
                  lowerIsBetter={m.lowerIsBetter}
                />
              </div>
              {m.sparkline.length > 1 && (
                <div className="h-8 w-16 shrink-0">
                  <Sparkline data={m.sparkline} height={32} />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
