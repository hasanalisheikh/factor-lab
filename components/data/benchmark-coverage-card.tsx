"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BenchmarkCoverage, DataIngestJobStatus } from "@/lib/supabase/types";
import { TICKER_INCEPTION_DATES, getIngestJobError } from "@/lib/supabase/types";
import { isPollingDataIngestStatus } from "@/lib/data-ingest-jobs";
import { useDiagnosticsMode } from "./diagnostics-toggle";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BenchmarkRowData = {
  ticker: string;
  coverage: BenchmarkCoverage | null;
  initialJob: DataIngestJobStatus | null;
};

type Props = {
  /** null signals a query failure — renders "Coverage unavailable" instead of "Not ingested" */
  benchmarks: BenchmarkRowData[] | null;
  isDev?: boolean;
};

type BenchmarkCoverageActionState = {
  status: BenchmarkCoverage["status"] | "not_ingested";
  needsWindowBackfill: boolean;
  isBehindCutoff: boolean;
  hasOptionalFullHistoryBackfill: boolean;
};

function getBenchmarkCoverageActionState(
  coverage: BenchmarkCoverage | null
): BenchmarkCoverageActionState {
  const status = coverage?.status ?? "not_ingested";
  const coveragePercent = coverage?.coveragePercent ?? 0;
  const latestDate = coverage?.latestDate ?? null;
  const windowEnd = coverage?.windowEnd ?? null;
  const needsHistoricalBackfill = coverage?.needsHistoricalBackfill ?? false;

  const needsWindowBackfill = status !== "not_ingested" && coveragePercent < 100;
  const isBehindCutoff =
    status !== "not_ingested" &&
    latestDate !== null &&
    windowEnd !== null &&
    latestDate < windowEnd;
  const hasOptionalFullHistoryBackfill =
    status === "ok" && coveragePercent >= 100 && !isBehindCutoff && needsHistoricalBackfill;

  return {
    status,
    needsWindowBackfill,
    isBehindCutoff,
    hasOptionalFullHistoryBackfill,
  };
}

// ---------------------------------------------------------------------------
// Per-ticker row component
// ---------------------------------------------------------------------------

function BenchmarkRow({
  ticker,
  coverage,
  initialJob,
}: {
  ticker: string;
  coverage: BenchmarkCoverage | null;
  initialJob: DataIngestJobStatus | null;
}) {
  const router = useRouter();
  const { enabled: diagnosticsEnabled, toggle } = useDiagnosticsMode();
  const [job, setJob] = useState<DataIngestJobStatus | null>(initialJob);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Sync from server re-renders
  useEffect(() => {
    setJob(initialJob);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJob?.id, initialJob?.status, initialJob?.progress]);

  const isPolling = job ? isPollingDataIngestStatus(job.status, job.finished_at) : false;

  // A running job is "stalled" when its heartbeat (updated_at) is older than 2 min.
  // This mirrors the Python stall_minutes=2 threshold.
  // Falls back gracefully: if updated_at is null (old schema or queued job), never stalled.
  const STALL_MS = 2 * 60 * 1000;
  const isStalled =
    job?.status === "running" && isPolling && !!(job?.last_heartbeat_at ?? job?.updated_at)
      ? Date.now() - new Date(job.last_heartbeat_at ?? job.updated_at ?? "").getTime() > STALL_MS
      : false;

  // Poll every 3 s while active
  useEffect(() => {
    if (!isPolling || !job?.id) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/data/ingest-benchmark?jobId=${job.id}`);
        if (!res.ok) return;
        const data = (await res.json()) as DataIngestJobStatus;
        setJob(data);
        if (data.finished_at || data.status === "blocked") {
          router.refresh();
        }
      } catch {
        /* ignore transient errors */
      }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [isPolling, job?.id, router]);

  const handleAction = async (forceStart?: string) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, string> = { ticker };
      if (forceStart) body.force_start_date = forceStart;
      const res = await fetch("/api/data/ingest-benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Failed to start ingestion.");
        return;
      }
      if (data.already_active && data.jobId) {
        const statusRes = await fetch(`/api/data/ingest-benchmark?jobId=${data.jobId}`);
        if (statusRes.ok) {
          const activeJob = (await statusRes.json()) as DataIngestJobStatus;
          setJob(activeJob);
          return;
        }
      }
      setJob({
        id: data.jobId,
        status: "queued",
        stage: "download",
        progress: 0,
        error_message: null,
        created_at: new Date().toISOString(),
        started_at: null,
        updated_at: null,
        finished_at: null,
        rows_inserted: null,
        next_retry_at: null,
        attempt_count: 0,
      });
    } catch {
      setSubmitError("Failed to connect. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!job?.id) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await fetch(`/api/data/ingest-benchmark?jobId=${job.id}`, { method: "DELETE" });
      setJob((prev) =>
        prev
          ? {
              ...prev,
              status: "failed",
              error: "Cancelled by user.",
              error_message: "Cancelled by user.",
              finished_at: new Date().toISOString(),
              next_retry_at: null,
            }
          : prev
      );
    } catch {
      setSubmitError("Failed to cancel.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Per-ticker inception date for accurate backfill start
  const inceptionDate = TICKER_INCEPTION_DATES[ticker] ?? "1993-01-01";

  // Derive display values
  const status = coverage?.status ?? "not_ingested";
  const needsBackfill = coverage?.needsHistoricalBackfill ?? false;
  const coveragePct = coverage?.coveragePercent ?? 0;
  const { needsWindowBackfill, isBehindCutoff, hasOptionalFullHistoryBackfill } =
    getBenchmarkCoverageActionState(coverage);

  const isBlocked = job?.status === "blocked";
  const hasScheduledRetry =
    job?.status === "retrying" || (job?.status === "failed" && !!job?.next_retry_at);
  const isRetrying =
    job?.status === "retrying" ||
    ((job?.status === "queued" || job?.status === "running") && (job?.attempt_count ?? 0) > 0);

  const pctColor =
    status === "ok"
      ? "text-emerald-400"
      : status === "not_ingested"
        ? "text-muted-foreground"
        : needsBackfill || status === "missing"
          ? "text-red-400"
          : "text-amber-400";

  const statusLabel =
    status === "ok"
      ? "Healthy"
      : status === "not_ingested"
        ? "Not ingested"
        : needsBackfill || status === "missing"
          ? "Needs backfill"
          : "Partial";

  const statusColor =
    status === "ok"
      ? "text-emerald-400"
      : status === "not_ingested"
        ? "text-muted-foreground"
        : needsBackfill || status === "missing"
          ? "text-red-400"
          : "text-amber-400";

  const canShowManualAction = !isPolling && !hasScheduledRetry && !isBlocked;
  const showRepairBackfillBtn = canShowManualAction && (needsWindowBackfill || isBehindCutoff);
  const showOptionalFullHistoryBtn =
    diagnosticsEnabled && canShowManualAction && hasOptionalFullHistoryBackfill;
  const showBackfillBtn =
    diagnosticsEnabled && (showRepairBackfillBtn || showOptionalFullHistoryBtn);
  const showIngestBtn = !isPolling && !hasScheduledRetry && !isBlocked && status === "not_ingested";
  const isFailed = job?.status === "failed" && !job?.next_retry_at;
  // "Retry" for permanently-failed or stalled jobs
  const showRetryBtn = (isFailed && !isBlocked) || isStalled;
  // "Retry now" for blocked jobs or scheduled retries (skip the wait)
  const showRetryNowBtn = isBlocked || hasScheduledRetry;
  // "Cancel" for queued or running jobs (not stalled — stalled already shows Retry)
  const showCancelBtn = isPolling && !isStalled;
  const showUpToDateLabel =
    diagnosticsEnabled &&
    !showBackfillBtn &&
    !showIngestBtn &&
    !showRetryBtn &&
    !showRetryNowBtn &&
    !showCancelBtn &&
    status === "ok";
  const actionStartDate =
    job?.start_date ??
    (needsBackfill || needsWindowBackfill || showOptionalFullHistoryBtn
      ? inceptionDate
      : undefined);

  const canEnableDiagnostics =
    !diagnosticsEnabled &&
    (showRepairBackfillBtn || showIngestBtn || showRetryBtn || showRetryNowBtn);

  return (
    <div className="border-border/50 border-b py-2 first:pt-0 last:border-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2">
        {/* Ticker */}
        <span className="text-foreground w-10 flex-shrink-0 font-mono text-xs">{ticker}</span>

        {/* Coverage % */}
        <span className={`w-12 flex-shrink-0 text-right text-xs font-semibold ${pctColor}`}>
          {status === "not_ingested" ? "—" : `${coveragePct.toFixed(1)}%`}
        </span>

        <span className={`min-w-0 flex-1 text-[11px] ${statusColor}`}>
          {isStalled ? (
            <span className="flex items-center gap-1 text-amber-400">
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">Stalled</span>
            </span>
          ) : hasScheduledRetry && job?.next_retry_at ? (
            <span className="flex items-center gap-1 text-amber-400">
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">
                Retrying at{" "}
                {new Date(job.next_retry_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </span>
          ) : isPolling ? (
            <span className="flex items-center gap-1 text-blue-400">
              <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" />
              <span className="truncate">
                {isRetrying
                  ? "Retrying…"
                  : job?.status === "queued"
                    ? "Queued…"
                    : job?.stage === "download"
                      ? "Downloading…"
                      : "Ingesting…"}
                {job && job.progress > 0 ? ` ${job.progress}%` : ""}
                {job?.status === "running" && (job?.last_heartbeat_at ?? job?.updated_at)
                  ? ` · ${Math.round((Date.now() - new Date(job.last_heartbeat_at ?? job.updated_at ?? "").getTime()) / 1000)}s ago`
                  : ""}
              </span>
            </span>
          ) : isBlocked ? (
            <span className="flex items-center gap-1 text-red-400">
              <XCircle className="h-3 w-3 flex-shrink-0" />
              <span className="truncate" title={getIngestJobError(job) ?? undefined}>
                Blocked
              </span>
            </span>
          ) : isFailed ? (
            <span className="flex items-center gap-1 text-red-400">
              <XCircle className="h-3 w-3 flex-shrink-0" />
              Failed
            </span>
          ) : status === "ok" ? (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
              Healthy
              {job?.status === "succeeded" && job.rows_inserted !== undefined && (
                <span className="text-muted-foreground">· {job.rows_inserted ?? 0} rows</span>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-1">
              {status !== "not_ingested" && <AlertTriangle className="h-3 w-3 flex-shrink-0" />}
              {statusLabel}
            </span>
          )}
        </span>

        {/* Action buttons — diagnostics mode only */}
        {diagnosticsEnabled && (
          <>
            {showBackfillBtn && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 flex-shrink-0 border-amber-800/50 px-2 text-[11px] text-amber-400 hover:text-amber-300"
                    onClick={() => handleAction(actionStartDate)}
                    disabled={isSubmitting}
                    title={
                      showOptionalFullHistoryBtn
                        ? "Optional. Research window is already healthy."
                        : undefined
                    }
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : showOptionalFullHistoryBtn ? (
                      "Backfill full history"
                    ) : (
                      "Backfill"
                    )}
                  </Button>
                </TooltipTrigger>
                {showOptionalFullHistoryBtn && (
                  <TooltipContent side="top" className="max-w-[220px] text-xs leading-relaxed">
                    Optional. Research window is already healthy.
                  </TooltipContent>
                )}
              </Tooltip>
            )}
            {showIngestBtn && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 flex-shrink-0 px-2 text-[11px]"
                onClick={() => handleAction()}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Ingest"}
              </Button>
            )}
            {showRetryBtn && (
              <Button
                size="sm"
                variant="outline"
                className={`h-6 flex-shrink-0 px-2 text-[11px] ${
                  isStalled
                    ? "border-amber-800/50 text-amber-400 hover:text-amber-300"
                    : "border-red-800/50 text-red-400 hover:text-red-300"
                }`}
                onClick={() => handleAction(actionStartDate)}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Retry"}
              </Button>
            )}
            {showRetryNowBtn && (
              <Button
                size="sm"
                variant="outline"
                className={`h-6 flex-shrink-0 px-2 text-[11px] ${
                  isBlocked
                    ? "border-red-800/50 text-red-400 hover:text-red-300"
                    : "border-amber-800/50 text-amber-400 hover:text-amber-300"
                }`}
                onClick={() => handleAction(actionStartDate)}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Retry now"}
              </Button>
            )}
            {showCancelBtn && (
              <Button
                size="sm"
                variant="outline"
                className="border-muted-foreground/30 text-muted-foreground hover:text-foreground h-6 flex-shrink-0 px-2 text-[11px]"
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Cancel"}
              </Button>
            )}
            {showUpToDateLabel && (
              <span className="text-muted-foreground flex-shrink-0 text-[10px]">Up to date</span>
            )}
          </>
        )}

        {canEnableDiagnostics && (
          <button
            onClick={toggle}
            className="text-muted-foreground hover:text-foreground text-[10px] underline underline-offset-2 transition-colors"
          >
            Enable diagnostics
          </button>
        )}
      </div>

      {submitError && <p className="mt-1 pl-10 text-[11px] text-red-400">{submitError}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------

export function BenchmarkCoverageCard({ benchmarks, isDev: _isDev = false }: Props) {
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
  const queuedCount = (benchmarks ?? []).filter((b) =>
    b.initialJob ? isPollingDataIngestStatus(b.initialJob.status, b.initialJob.finished_at) : false
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
          /* Coverage query failed — avoid showing "Not ingested" for ingested tickers */
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

            {/* Column headers */}
            <div className="border-border/50 flex items-center gap-2 border-b pb-1.5">
              <span className="text-muted-foreground w-10 flex-shrink-0 text-[10px]">Ticker</span>
              <span className="text-muted-foreground w-12 flex-shrink-0 text-right text-[10px]">
                Cover.
              </span>
              <span className="text-muted-foreground flex-1 text-[10px]">Status</span>
            </div>

            {benchmarks.map((b) => (
              <BenchmarkRow
                key={b.ticker}
                ticker={b.ticker}
                coverage={b.coverage}
                initialJob={b.initialJob}
              />
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
