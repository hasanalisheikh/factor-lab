"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import type { Json, ModelMetadataRow, ModelPredictionRow } from "@/lib/supabase/types";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// Human-readable labels for feature codes
const FEATURE_LABELS: Record<string, string> = {
  mom_5d: "5-Day Momentum",
  mom_20d: "1-Month Momentum",
  mom_60d: "3-Month Momentum",
  mom_252d: "12-Month Momentum",
  vol_20d: "20-Day Volatility",
  vol_60d: "60-Day Volatility",
  drawdown_252d: "12-Month Drawdown",
  beta_60d: "60-Day Beta",
};

const fiConfig = {
  importance: { label: "Importance", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "--";
  return `${(value * 100).toFixed(2)}%`;
}

function getImportanceRows(metadata: ModelMetadataRow | null) {
  if (!metadata) return [];
  const raw = metadata.feature_importance;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw)
    .map(([feature, value]) => ({
      feature,
      label: FEATURE_LABELS[feature] ?? feature,
      importance: Number(value) || 0,
    }))
    .sort((a, b) => b.importance - a.importance);
}

function getLatestSelected(predictions: ModelPredictionRow[]): ModelPredictionRow[] {
  if (predictions.length === 0) return [];
  const latestAsOf = predictions[0].as_of_date;
  return predictions
    .filter((row) => row.as_of_date === latestAsOf && row.selected)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 10);
}

interface MlInsightsTabProps {
  metadata: ModelMetadataRow | null;
  predictions: ModelPredictionRow[];
  runMetadata?: Json | null;
}

function asObject(value: Json | null | undefined): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringish(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function MlInsightsTab({ metadata, predictions, runMetadata }: MlInsightsTabProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const featureImportance = getImportanceRows(metadata);
  const latestSelected = getLatestSelected(predictions);
  const runMeta = asObject(runMetadata);

  const modelImpl = readString(runMeta?.model_impl) ?? "--";
  const featureSet = readString(runMeta?.feature_set) ?? "--";
  const modelVersion = readString(runMeta?.model_version) ?? "--";
  const randomSeed = readStringish(runMeta?.random_seed) ?? "--";
  const determinismMode = readString(runMeta?.determinism_mode) ?? "--";
  const lightgbmVersion = readString(runMeta?.lightgbm_version) ?? "--";
  const snapshotMode = readString(runMeta?.data_snapshot_mode) ?? "--";
  const snapshotCutoff = readString(runMeta?.data_snapshot_cutoff) ?? "--";
  const snapshotDigest =
    typeof runMeta?.data_snapshot_digest === "string"
      ? runMeta.data_snapshot_digest.slice(0, 12)
      : "--";
  const predictionsDigest =
    typeof runMeta?.predictions_digest === "string"
      ? runMeta.predictions_digest.slice(0, 12)
      : "--";
  const positionsDigest =
    typeof runMeta?.positions_digest === "string" ? runMeta.positions_digest.slice(0, 12) : "--";
  const equityDigest =
    typeof runMeta?.equity_digest === "string" ? runMeta.equity_digest.slice(0, 12) : "--";
  const runtimeDownloadUsed =
    typeof runMeta?.runtime_download_used === "boolean"
      ? runMeta.runtime_download_used
        ? "Yes"
        : "No"
      : "--";

  const topN = metadata?.top_n ?? null;

  const keyRows: { label: string; value: string }[] = [
    { label: "Model", value: metadata?.model_name ?? "--" },
    { label: "Algorithm", value: modelImpl },
    {
      label: "Train Window",
      value:
        metadata?.train_start && metadata?.train_end
          ? `${metadata.train_start} → ${metadata.train_end}`
          : "--",
    },
    { label: "Top N", value: topN !== null ? String(topN) : "--" },
    { label: "Cost (bps)", value: metadata ? Number(metadata.cost_bps).toFixed(1) : "--" },
    { label: "Rebalances", value: metadata ? metadata.rebalance_count.toLocaleString() : "--" },
  ];

  const advancedRows: { label: string; value: string; tooltip?: string }[] = [
    { label: "Model Version", value: modelVersion },
    { label: "Feature Set", value: featureSet },
    { label: "Random Seed", value: randomSeed },
    { label: "Determinism Mode", value: determinismMode },
    { label: "LightGBM Version", value: lightgbmVersion },
    { label: "Training Rows", value: metadata ? metadata.train_rows.toLocaleString() : "--" },
    { label: "Predictions", value: metadata ? metadata.prediction_rows.toLocaleString() : "--" },
    { label: "Snapshot Mode", value: snapshotMode },
    { label: "Snapshot Cutoff", value: snapshotCutoff },
    { label: "Snapshot Digest", value: snapshotDigest, tooltip: "Input price-frame checksum" },
    { label: "Runtime Download", value: runtimeDownloadUsed },
    {
      label: "Predictions Digest",
      value: predictionsDigest,
      tooltip: "Reproducibility checksum",
    },
    { label: "Positions Digest", value: positionsDigest, tooltip: "Reproducibility checksum" },
    { label: "Equity Digest", value: equityDigest, tooltip: "Reproducibility checksum" },
  ];

  return (
    <div className="space-y-4">
      {/* Plain-English summary */}
      <Card className="bg-card border-border">
        <CardContent className="px-4 py-3">
          <p className="text-muted-foreground text-[12px] leading-relaxed">
            <span className="text-card-foreground font-medium">How it works: </span>
            Every trading day, the model scores each asset using price-based signals — momentum
            (recent vs. historical returns), volatility (how much prices fluctuate), drawdown (peak
            loss), and beta (sensitivity to the market) — then selects the{" "}
            {topN !== null ? (
              <span className="text-card-foreground font-medium">top {topN}</span>
            ) : (
              "top N"
            )}{" "}
            highest-ranked assets for equal-weight allocation. It retrains periodically on a rolling
            window of history so its predictions stay current. The{" "}
            <span className="text-card-foreground font-medium">Feature Importance</span> chart below
            shows which signals influenced rankings most — taller bars mean the model leaned on that
            signal more heavily.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        {/* Feature importance chart + latest picks */}
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-card-foreground text-[13px] font-medium">
              Feature Importance
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pt-1 pb-3">
            {featureImportance.length === 0 ? (
              <div className="text-muted-foreground flex h-[200px] items-center justify-center text-[12px]">
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
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    width={145}
                    className="text-[11px]"
                    stroke="var(--color-muted-foreground)"
                    opacity={0.7}
                  />
                  <ChartTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as {
                        feature: string;
                        label: string;
                        importance: number;
                      };
                      return (
                        <div className="border-border bg-popover rounded-md border px-3 py-2 shadow-sm">
                          <div className="text-popover-foreground text-[12px] font-medium">
                            {d.label}
                          </div>
                          <div className="text-muted-foreground font-mono text-[10px]">
                            {d.feature}
                          </div>
                          <div className="text-popover-foreground mt-1 text-[12px]">
                            {(d.importance * 100).toFixed(1)}% importance
                          </div>
                        </div>
                      );
                    }}
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
            <div className="border-border/40 mt-4 border-t pt-3">
              <p className="text-card-foreground mb-2 text-[11px] font-medium">
                Latest Rebalance Picks
              </p>
              {latestSelected.length === 0 ? (
                <p className="text-muted-foreground text-[11px]">No prediction rows available.</p>
              ) : (
                <div className="space-y-1.5">
                  {latestSelected.map((row) => (
                    <div
                      key={`${row.as_of_date}-${row.ticker}`}
                      className="border-border/30 grid grid-cols-[44px_1fr_76px_70px] items-center border-b pb-1.5 font-mono text-[11px]"
                    >
                      <span className="text-muted-foreground">#{row.rank}</span>
                      <span className="text-card-foreground">{row.ticker}</span>
                      <span className="text-muted-foreground" data-testid="ml-pick-weight">
                        {formatPct(row.weight)}
                      </span>
                      <span className="text-card-foreground">
                        {formatPct(row.predicted_return)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Model metadata card */}
        <Card className="bg-card border-border h-fit">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-card-foreground text-[13px] font-medium">
              Model Details
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {/* Key details */}
            <div className="flex flex-col gap-0">
              {keyRows.map((row) => (
                <div
                  key={row.label}
                  className="border-border/40 flex items-center justify-between border-b py-2 last:border-0"
                >
                  <span className="text-muted-foreground text-[11px]">{row.label}</span>
                  <span className="text-card-foreground font-mono text-[12px] font-medium">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Advanced details (collapsible) */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="mt-3">
              <CollapsibleTrigger className="text-muted-foreground hover:text-card-foreground flex items-center gap-1 text-[11px] transition-colors">
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform duration-200",
                    advancedOpen && "rotate-180"
                  )}
                />
                Advanced details
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <div className="border-border/40 flex flex-col gap-0 border-t pt-1">
                  {advancedRows.map((row) => (
                    <div
                      key={row.label}
                      className="border-border/30 flex items-center justify-between border-b py-2 last:border-0"
                    >
                      <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
                        {row.label}
                        {row.tooltip && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="text-muted-foreground/50 h-3 w-3 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>{row.tooltip}</TooltipContent>
                          </Tooltip>
                        )}
                      </span>
                      <span className="text-card-foreground font-mono text-[12px] font-medium">
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
