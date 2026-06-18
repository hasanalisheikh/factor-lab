"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { TICKER_INCEPTION_DATES } from "@/lib/supabase/types";
import { isPollingDataIngestStatus } from "@/lib/data-ingest-jobs";
import { useDiagnosticsMode } from "../diagnostics-toggle";
import { getBenchmarkCoverageActionState } from "./action-state";
import { BenchmarkRowActions } from "./benchmark-row-actions";
import { BenchmarkRowStatus } from "./benchmark-row-status";

import type { BenchmarkRowData } from "./types";
import type { DataIngestJobStatus } from "@/lib/supabase/types";

export function BenchmarkRow({ ticker, coverage, initialJob }: BenchmarkRowData) {
  const router = useRouter();
  const { enabled: diagnosticsEnabled, toggle } = useDiagnosticsMode();
  const [job, setJob] = useState<DataIngestJobStatus | null>(initialJob);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);

  // Sync from server re-renders
  useEffect(() => {
    setJob(initialJob);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJob?.id, initialJob?.status, initialJob?.progress]);

  const isPolling = job ? isPollingDataIngestStatus(job.status, job.finished_at) : false;
  const heartbeatAt = job?.last_heartbeat_at ?? job?.updated_at ?? null;

  useEffect(() => {
    if (job?.status !== "running" || !heartbeatAt) {
      setNowMs(null);
      return;
    }

    const updateNow = () => setNowMs(Date.now());
    updateNow();
    const id = setInterval(updateNow, 1000);
    return () => clearInterval(id);
  }, [heartbeatAt, job?.status]);

  // A running job is "stalled" when its heartbeat (updated_at) is older than 2 min.
  // This mirrors the Python stall_minutes=2 threshold.
  // Falls back gracefully: if updated_at is null (old schema or queued job), never stalled.
  const STALL_MS = 2 * 60 * 1000;
  const isStalled =
    job?.status === "running" && isPolling && !!heartbeatAt && nowMs !== null
      ? nowMs - new Date(heartbeatAt).getTime() > STALL_MS
      : false;
  const heartbeatAgeSeconds =
    job?.status === "running" && heartbeatAt && nowMs !== null
      ? Math.round((nowMs - new Date(heartbeatAt).getTime()) / 1000)
      : null;

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

  const inceptionDate = TICKER_INCEPTION_DATES[ticker] ?? "1993-01-01";
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
  const showRetryBtn = (isFailed && !isBlocked) || isStalled;
  const showRetryNowBtn = isBlocked || hasScheduledRetry;
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
        <span className="text-foreground w-10 flex-shrink-0 font-mono text-xs">{ticker}</span>

        <span className={`w-12 flex-shrink-0 text-right text-xs font-semibold ${pctColor}`}>
          {status === "not_ingested" ? "—" : `${coveragePct.toFixed(1)}%`}
        </span>

        <BenchmarkRowStatus
          status={status}
          statusColor={statusColor}
          statusLabel={statusLabel}
          job={job}
          isStalled={isStalled}
          hasScheduledRetry={hasScheduledRetry}
          isPolling={isPolling}
          isRetrying={isRetrying}
          isBlocked={isBlocked}
          isFailed={isFailed}
          heartbeatAgeSeconds={heartbeatAgeSeconds}
        />

        <BenchmarkRowActions
          diagnosticsEnabled={diagnosticsEnabled}
          isSubmitting={isSubmitting}
          isStalled={isStalled}
          isBlocked={isBlocked}
          showBackfillBtn={showBackfillBtn}
          showOptionalFullHistoryBtn={showOptionalFullHistoryBtn}
          showIngestBtn={showIngestBtn}
          showRetryBtn={showRetryBtn}
          showRetryNowBtn={showRetryNowBtn}
          showCancelBtn={showCancelBtn}
          showUpToDateLabel={showUpToDateLabel}
          actionStartDate={actionStartDate}
          onAction={handleAction}
          onCancel={handleCancel}
        />

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
