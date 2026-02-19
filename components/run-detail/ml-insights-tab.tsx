"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Bar, BarChart, XAxis, YAxis } from "recharts"
import { featureImportance, modelMeta } from "@/lib/mock"

const fiConfig = {
  importance: { label: "Importance", color: "var(--color-chart-1)" },
} satisfies ChartConfig

const metaRows: { label: string; value: string }[] = [
  { label: "Model Name", value: modelMeta.name },
  { label: "Type", value: modelMeta.type },
  { label: "Accuracy", value: `${(modelMeta.accuracy * 100).toFixed(1)}%` },
  { label: "Precision", value: `${(modelMeta.precision * 100).toFixed(1)}%` },
  { label: "Recall", value: `${(modelMeta.recall * 100).toFixed(1)}%` },
  { label: "F1 Score", value: `${(modelMeta.f1 * 100).toFixed(1)}%` },
  { label: "AUC", value: `${(modelMeta.auc * 100).toFixed(1)}%` },
  { label: "Train Date", value: modelMeta.trainDate },
  { label: "Features", value: modelMeta.features.toLocaleString() },
  { label: "Samples", value: modelMeta.samples.toLocaleString() },
]

export function MlInsightsTab() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      {/* Feature importance chart */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-1 px-4 pt-4">
          <CardTitle className="text-[13px] font-medium text-card-foreground">
            Feature Importance
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-3 pt-1">
          <ChartContainer config={fiConfig} className="h-[360px] w-full">
            <BarChart
              data={featureImportance}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
            >
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
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
