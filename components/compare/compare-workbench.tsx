"use client";

import { useMemo, useState } from "react";

import {
  buildDrawdownChartData,
  getSharedComparisonPoints,
  RUN_COMPARE_CONFIG,
} from "@/components/compare/compare-workbench/chart-data";
import { ComparisonCharts } from "@/components/compare/compare-workbench/comparison-charts";
import { EmptyCompareState } from "@/components/compare/compare-workbench/empty-compare-state";
import { MetricDiffCard } from "@/components/compare/compare-workbench/metric-diff-card";
import { SelectRunsCard } from "@/components/compare/compare-workbench/select-runs-card";
import type { ChartConfig } from "@/components/ui/chart";
import { getRunBenchmark } from "@/lib/benchmark";
import type { CompareRunBundle } from "@/lib/supabase/types";

type Props = {
  bundles: CompareRunBundle[];
};

export function CompareWorkbench({ bundles }: Props) {
  const [runAId, setRunAId] = useState(bundles[0]?.run.id ?? "");
  const [runBId, setRunBId] = useState(bundles[1]?.run.id ?? bundles[0]?.run.id ?? "");

  const runA = bundles.find((bundle) => bundle.run.id === runAId) ?? null;
  const runB = bundles.find((bundle) => bundle.run.id === runBId) ?? null;

  const benchLabelA = runA ? getRunBenchmark(runA.run) : "Benchmark";
  const benchLabelB = runB ? getRunBenchmark(runB.run) : "Benchmark";

  const equityConfig = useMemo(
    () =>
      ({
        ...RUN_COMPARE_CONFIG,
        benchA: { label: `${benchLabelA} (A)`, color: "var(--color-chart-2)" },
        benchB: { label: `${benchLabelB} (B)`, color: "var(--color-chart-4)" },
      }) satisfies ChartConfig,
    [benchLabelA, benchLabelB]
  );

  const sharedComparisonPoints = useMemo(() => {
    if (!runA || !runB) return [];
    return getSharedComparisonPoints(runA.equity, runB.equity);
  }, [runA, runB]);

  const equityChartData = useMemo(() => {
    if (sharedComparisonPoints.length === 0) return [];

    const firstRunA = sharedComparisonPoints[0].runA.portfolio;
    const firstRunB = sharedComparisonPoints[0].runB.portfolio;
    const firstBenchA = sharedComparisonPoints[0].runA.benchmark;
    const firstBenchB = sharedComparisonPoints[0].runB.benchmark;

    return sharedComparisonPoints.map(({ date, runA: pointA, runB: pointB }) => ({
      date,
      runA: firstRunA > 0 ? (pointA.portfolio / firstRunA) * 100 : 100,
      runB: firstRunB > 0 ? (pointB.portfolio / firstRunB) * 100 : 100,
      benchA: firstBenchA > 0 ? (pointA.benchmark / firstBenchA) * 100 : 100,
      benchB: firstBenchB > 0 ? (pointB.benchmark / firstBenchB) * 100 : 100,
    }));
  }, [sharedComparisonPoints]);

  const drawdownChartData = useMemo(
    () => buildDrawdownChartData(sharedComparisonPoints),
    [sharedComparisonPoints]
  );

  const drawdownDomain = useMemo(() => {
    if (drawdownChartData.length === 0) return undefined;

    return [Math.min(...drawdownChartData.flatMap((point) => [point.runA, point.runB]), 0), 0] as [
      number,
      number,
    ];
  }, [drawdownChartData]);

  if (bundles.length < 2) {
    return <EmptyCompareState bundleCount={bundles.length} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <SelectRunsCard
        bundles={bundles}
        runAId={runAId}
        runBId={runBId}
        onRunAChange={setRunAId}
        onRunBChange={setRunBId}
      />

      <ComparisonCharts
        equityConfig={equityConfig}
        equityChartData={equityChartData}
        drawdownChartData={drawdownChartData}
        drawdownDomain={drawdownDomain}
      />

      {runA && runB && <MetricDiffCard runA={runA} runB={runB} />}
    </div>
  );
}
