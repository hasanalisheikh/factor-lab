"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isPollingDataIngestStatus } from "@/lib/data-ingest-jobs";
import { useDiagnosticsMode } from "./diagnostics-toggle";
import { getBenchmarkCoverageActionState } from "./benchmark-coverage-card/action-state";
import { BenchmarkRow } from "./benchmark-coverage-card/benchmark-row";

import type { BenchmarkCoverageCardProps, BenchmarkRowData } from "./benchmark-coverage-card/types";

export type { BenchmarkRowData };

export function BenchmarkCoverageCard({
  benchmarks,
  isDev: _isDev = false,
}: BenchmarkCoverageCardProps) {
  const router = useRouter();
  const { enabled: diagnosticsEnabled } = useDiagnosticsMode();
  const [isCancellingAll, setIsCancellingAll] = useState(false);

  const hasRepairableBenchmarks = (benchmarks ?? []).some((benchmark) => {
    const actionState = getBenchmarkCoverageActionState(benchmark.coverage);
    return (
      actionState.status === "not_ingested" ||
      actionState.needsWindowBackfill ||
      actionState.isBehindCutoff
    );
  });
  const hasOptionalFullHistoryBenchmarks = (benchmarks ?? []).some(
    (benchmark) =>
      getBenchmarkCoverageActionState(benchmark.coverage).hasOptionalFullHistoryBackfill
  );
  const queuedCount = (benchmarks ?? []).filter((benchmark) =>
    benchmark.initialJob
      ? isPollingDataIngestStatus(benchmark.initialJob.status, benchmark.initialJob.finished_at)
      : false
  ).length;

  const handleCancelAll = async () => {
    setIsCancellingAll(true);
    try {
      await fetch("/api/data/ingest-benchmark?cancelAll=1", { method: "DELETE" });
      router.refresh();
    } catch {
      /* ignore */
    } finally {
      setIsCancellingAll(false);
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-foreground text-sm font-semibold">
            Benchmark Coverage
          </CardTitle>
          {diagnosticsEnabled && queuedCount >= 1 && (
            <Button
              size="sm"
              variant="outline"
              className="border-muted-foreground/30 text-muted-foreground hover:text-foreground h-6 flex-shrink-0 px-2 text-[11px]"
              onClick={handleCancelAll}
              disabled={isCancellingAll}
            >
              {isCancellingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : "Cancel all"}
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          Coverage inside the monitored research window, plus inception-based historical backfill
          detection.
        </p>
      </CardHeader>

      <CardContent className="space-y-0">
        {benchmarks === null ? (
          <div className="bg-muted/40 border-border flex items-start gap-1.5 rounded-md border px-2.5 py-3">
            <AlertTriangle className="text-muted-foreground mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <p className="text-muted-foreground text-xs leading-snug">
              Coverage data temporarily unavailable.{" "}
              <a href="/data" className="hover:text-foreground underline underline-offset-2">
                Retry
              </a>
            </p>
          </div>
        ) : (
          <>
            {hasRepairableBenchmarks && (
              <div className="mb-3 flex items-start gap-1.5 rounded-md border border-amber-800/40 bg-amber-950/30 px-2.5 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
                <p className="text-[11px] leading-snug text-amber-300/80">
                  {diagnosticsEnabled
                    ? "Some benchmarks need repair inside the monitored research window or are behind the cutoff. Use the row actions on affected benchmarks."
                    : "Automatic repairs run in the background. Enable diagnostics to inspect or intervene."}
                </p>
              </div>
            )}
            {!hasRepairableBenchmarks && diagnosticsEnabled && hasOptionalFullHistoryBenchmarks && (
              <div className="bg-muted/40 border-border mb-3 flex items-start gap-1.5 rounded-md border px-2.5 py-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
                <p className="text-muted-foreground text-[11px] leading-snug">
                  Research window coverage is already healthy.{" "}
                  <strong className="text-foreground">Backfill full history</strong> is optional and
                  downloads history from ticker inception.
                </p>
              </div>
            )}

            <div className="border-border/50 flex items-center gap-2 border-b pb-1.5">
              <span className="text-muted-foreground w-10 flex-shrink-0 text-[10px]">Ticker</span>
              <span className="text-muted-foreground w-12 flex-shrink-0 text-right text-[10px]">
                Cover.
              </span>
              <span className="text-muted-foreground flex-1 text-[10px]">Status</span>
            </div>

            {benchmarks.map((benchmark) => (
              <BenchmarkRow
                key={benchmark.ticker}
                ticker={benchmark.ticker}
                coverage={benchmark.coverage}
                initialJob={benchmark.initialJob}
              />
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
