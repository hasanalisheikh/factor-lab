"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Bar, BarChart, XAxis, YAxis } from "recharts"
import type { ModelMetadataRow, ModelPredictionRow } from "@/lib/supabase/queries"

const fiConfig = {
  importance: { label: "Importance", color: "var(--color-chart-1)" },
} satisfies ChartConfig

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "--"
  return `${(value * 100).toFixed(2)}%`
}

function getImportanceRows(metadata: ModelMetadataRow | null) {
  if (!metadata) return []
  const raw = metadata.feature_importance
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
  const entries = Object.entries(raw).map(([feature, value]) => ({
    feature,
    importance: Number(value) || 0,
  }))
  return entries.sort((a, b) => b.importance - a.importance)
}

function getLatestSelected(predictions: ModelPredictionRow[]): ModelPredictionRow[] {
  if (predictions.length === 0) return []
  const latestAsOf = predictions[0].as_of_date
  return predictions
    .filter((row) => row.as_of_date === latestAsOf && row.selected)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 10)
}

interface MlInsightsTabProps {
  metadata: ModelMetadataRow | null
  predictions: ModelPredictionRow[]
}

export function MlInsightsTab({ metadata, predictions }: MlInsightsTabProps) {
  const featureImportance = getImportanceRows(metadata)
  const latestSelected = getLatestSelected(predictions)
  const metaRows: { label: string; value: string }[] = [
    { label: "Model", value: metadata?.model_name ?? "--" },
    {
      label: "Train Window",
      value:
        metadata?.train_start && metadata?.train_end
          ? `${metadata.train_start} to ${metadata.train_end}`
          : "--",
    },
    { label: "Training Rows", value: metadata ? metadata.train_rows.toLocaleString() : "--" },
    { label: "Predictions", value: metadata ? metadata.prediction_rows.toLocaleString() : "--" },
    { label: "Rebalances", value: metadata ? metadata.rebalance_count.toLocaleString() : "--" },
    { label: "Top N", value: metadata ? String(metadata.top_n) : "--" },
    { label: "Cost (bps)", value: metadata ? Number(metadata.cost_bps).toFixed(1) : "--" },
  ]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
      {/* Feature importance chart */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-1 px-4 pt-4">
          <CardTitle className="text-[13px] font-medium text-card-foreground">
            Feature Importance
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-3 pt-1">
          {featureImportance.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-[12px] text-muted-foreground">
              No model metadata available for this run.
            </div>
          ) : (
            <ChartContainer config={fiConfig} className="h-[260px] w-full">
              <BarChart
                data={featureImportance}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
              >
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
                  className="text-[10px]"
                  stroke="var(--color-muted-foreground)"
                  opacity={0.5}
                />
                <YAxis
                  type="category"
                  dataKey="feature"
                  tickLine={false}
                  axisLine={false}
                  width={120}
                  className="text-[11px]"
                  stroke="var(--color-muted-foreground)"
                  opacity={0.7}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "Importance"]}
                    />
                  }
                />
                <Bar
                  dataKey="importance"
                  fill="var(--color-chart-1)"
                  radius={[0, 4, 4, 0]}
                  opacity={0.85}
                />
              </BarChart>
            </ChartContainer>
          )}
          <div className="mt-4 border-t border-border/40 pt-3">
            <p className="text-[11px] font-medium text-card-foreground mb-2">
              Latest Rebalance Picks
            </p>
            {latestSelected.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No prediction rows available.</p>
            ) : (
              <div className="space-y-1.5">
                {latestSelected.map((row) => (
                  <div
                    key={`${row.as_of_date}-${row.ticker}`}
                    className="grid grid-cols-[44px_1fr_76px_70px] items-center text-[11px] font-mono border-b border-border/30 pb-1.5"
                  >
                    <span className="text-muted-foreground">#{row.rank}</span>
                    <span className="text-card-foreground">{row.ticker}</span>
                    <span className="text-muted-foreground">{formatPct(row.weight)}</span>
                    <span className="text-card-foreground">{formatPct(row.predicted_return)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Model metadata card */}
      <Card className="bg-card border-border h-fit">
        <CardHeader className="pb-2 px-4 pt-4">
          <CardTitle className="text-[13px] font-medium text-card-foreground">
            Model Metadata
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="flex flex-col gap-0">
            {metaRows.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between py-2 border-b border-border/40 last:border-0"
              >
                <span className="text-[11px] text-muted-foreground">{row.label}</span>
                <span className="text-[12px] font-mono text-card-foreground font-medium">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
