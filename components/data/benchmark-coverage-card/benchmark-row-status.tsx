import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";

import { getIngestJobError } from "@/lib/supabase/types";

import type { BenchmarkCoverage, DataIngestJobStatus } from "@/lib/supabase/types";

type BenchmarkRowStatusProps = {
  status: BenchmarkCoverage["status"] | "not_ingested";
  statusColor: string;
  statusLabel: string;
  job: DataIngestJobStatus | null;
  isStalled: boolean;
  hasScheduledRetry: boolean;
  isPolling: boolean;
  isRetrying: boolean;
  isBlocked: boolean;
  isFailed: boolean;
  heartbeatAgeSeconds: number | null;
};

export function BenchmarkRowStatus({
  status,
  statusColor,
  statusLabel,
  job,
  isStalled,
  hasScheduledRetry,
  isPolling,
  isRetrying,
  isBlocked,
  isFailed,
  heartbeatAgeSeconds,
}: BenchmarkRowStatusProps) {
  return (
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
            {heartbeatAgeSeconds !== null ? ` · ${heartbeatAgeSeconds}s ago` : ""}
          </span>
        </span>
      ) : isBlocked ? (
        <span className="flex items-center gap-1 text-red-400">
          <XCircle className="h-3 w-3 flex-shrink-0" />
          <span
            className="truncate"
            title={job ? (getIngestJobError(job) ?? undefined) : undefined}
          >
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
  );
}
