"use client";

import { useState, useEffect } from "react";
import { AlertCircle, Clock, Download, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { JobRow } from "@/lib/supabase/types";
import type { RunStatus } from "@/lib/types";
import type { IngestProgress } from "@/lib/supabase/queries";
import { computeEtaSeconds, formatEtaSeconds } from "@/lib/eta";
import { deriveRunDetailDisplayState } from "@/components/run-detail/run-status-state";

const ERROR_TRUNCATE_CHARS = 200;

const STAGE_LABELS: Record<string, string> = {
  ingest: "Initializing",
  load_data: "Loading price data",
  compute_signals: "Computing signals",
  rebalance: "Rebalancing portfolio",
  metrics: "Calculating performance",
  persist: "Saving results",
  report: "Generating report",
  features: "Building ML features",
  train: "Training models",
  download: "Downloading data",
  transform: "Processing data",
  upsert_prices: "Storing prices",
  finalize: "Completing",
};

const STAGE_DESCRIPTIONS: Record<string, string> = {
  ingest: "Setting up the backtest environment…",
  load_data: "Fetching price history and applying warmup period…",
  compute_signals: "Scoring each asset with the strategy…",
  rebalance: "Building portfolio weights and applying transaction costs…",
  metrics: "Computing Sharpe ratio, CAGR, drawdown, and more…",
  persist: "Writing results to the database…",
  report: "Building the HTML performance report…",
  features: "Generating momentum, volatility, and factor features…",
  train: "Running walk-forward model training…",
  download: "Downloading price history…",
  transform: "Processing and normalizing price data…",
  upsert_prices: "Storing price data in the database…",
  finalize: "Completing data processing…",
};

function FailedErrorMessage({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = message.length > ERROR_TRUNCATE_CHARS;
  const displayed = !isLong || expanded ? message : message.slice(0, ERROR_TRUNCATE_CHARS) + "…";

  return (
    <span>
      <span className="font-mono break-all">{displayed}</span>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-primary ml-1.5 text-[11px] underline underline-offset-2 hover:no-underline"
        >
          {expanded ? "collapse" : "expand"}
        </button>
      )}
    </span>
  );
}

interface JobStatusPanelProps {
  job: JobRow | null;
  runStatus: RunStatus;
  /** Aggregated ingest progress — present when runStatus === "waiting_for_data". */
  ingestProgress?: IngestProgress | null;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function JobStatusPanel({ job, runStatus, ingestProgress }: JobStatusPanelProps) {
  const displayState = deriveRunDetailDisplayState({
    runStatus,
    jobStatus: job?.status,
    jobProgress: job?.progress,
  });
  const isQueued = displayState.status === "queued";
  const isRunning = displayState.status === "running";
  const isWaiting = displayState.status === "waiting_for_data";
  const isFinishing = displayState.status === "finishing";
  const isFailed = displayState.status === "failed";
  const isBlocked = displayState.status === "blocked";

  // Elapsed-time counter shown while the run is waiting for a worker to pick it up.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isQueued) return;
    const createdMs = job?.created_at ? new Date(job.created_at).getTime() : Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - createdMs) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isQueued, job?.created_at]);

  // Elapsed-time counter shown while the backtest is actively running.
  const [runElapsed, setRunElapsed] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const startMs = job?.started_at ? new Date(job.started_at).getTime() : Date.now();
    const tick = () => setRunElapsed(Math.floor((Date.now() - startMs) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isRunning, job?.started_at]);

  // Elapsed-time counter for data ingestion (tracks how long we've been waiting for data).
  const [ingestElapsed, setIngestElapsed] = useState(0);
  useEffect(() => {
    if (!isWaiting || !ingestProgress?.minStartedAt) return;
    const startMs = new Date(ingestProgress.minStartedAt).getTime();
    const tick = () => setIngestElapsed(Math.floor((Date.now() - startMs) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isWaiting, ingestProgress?.minStartedAt]);

  if (displayState.status === "completed") return null;

  const progress = displayState.progress ?? 0;
  const stage = job?.stage ?? "ingest";
  const stageLabel = STAGE_LABELS[stage] ?? stage;
  const errorText = job?.error_message || null;

  // ETA for the running backtest (uses job.started_at from DB).
  const backtestEta = isRunning
    ? formatEtaSeconds(computeEtaSeconds(progress, job?.started_at ?? null))
    : "";

  // ETA for data ingestion (aggregated across all ingest jobs for this run).
  const ingestAvg = ingestProgress?.avgProgress ?? 0;
  const ingestEta =
    isWaiting && ingestProgress
      ? formatEtaSeconds(computeEtaSeconds(ingestAvg, ingestProgress.minStartedAt))
      : "";

  // Dynamic queued copy — avoids the false promise of "usually starts in seconds".
  function queuedSubtext(): string {
    if (elapsed < 30) return `Waiting for worker pickup… (${formatElapsed(elapsed)} elapsed)`;
    if (elapsed < 120)
      return `Still in queue — the worker will pick this up soon. (${formatElapsed(elapsed)} elapsed)`;
    return `Queued for ${formatElapsed(elapsed)} — the worker may be processing other jobs.`;
  }

  // Summary line for the waiting-for-data state.
  const ingestElapsedStr = ingestProgress?.minStartedAt ? formatElapsed(ingestElapsed) : null;
  const ingestSummary =
    ingestProgress && ingestProgress.totalJobs > 0
      ? `Downloading data for ${ingestProgress.totalJobs} ticker${ingestProgress.totalJobs !== 1 ? "s" : ""} (${ingestProgress.completedJobs}/${ingestProgress.totalJobs} done)${ingestElapsedStr ? ` — ${ingestElapsedStr} elapsed` : ""}`
      : "Ingesting required price history — the backtest will start automatically when done.";

  return (
    <Card className="bg-card border-border">
      <CardContent className="px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="mt-0.5 shrink-0">
            {isRunning ? (
              <Loader2 className="text-warning h-4 w-4 animate-spin" />
            ) : isFinishing ? (
              <Loader2 className="text-warning h-4 w-4 animate-spin" />
            ) : isWaiting ? (
              <Download className="h-4 w-4 text-blue-500" />
            ) : isBlocked ? (
              <Clock className="h-4 w-4 text-amber-300" />
            ) : isFailed ? (
              <AlertCircle className="text-destructive h-4 w-4" />
            ) : (
              <Clock className="text-muted-foreground h-4 w-4" />
            )}
          </div>

          {/* Text + progress */}
          <div className="min-w-0 flex-1">
            <p className="text-card-foreground text-[13px] font-medium">
              {isQueued
                ? "Queued"
                : isFinishing
                  ? "Finalizing results…"
                  : isWaiting
                    ? "Preparing data…"
                    : isBlocked
                      ? "Run blocked"
                      : isFailed
                        ? "Run failed"
                        : `Running backtest — ${stageLabel}`}
            </p>
            <p className="text-muted-foreground mt-0.5 text-[12px]">
              {isQueued ? (
                queuedSubtext()
              ) : isFinishing ? (
                "Writing final results and report data. This should finish shortly."
              ) : isWaiting ? (
                ingestSummary
              ) : isRunning ? (
                `${STAGE_DESCRIPTIONS[stage] ?? "Processing…"} (${formatElapsed(runElapsed)} elapsed)`
              ) : (isFailed || isBlocked) && errorText ? (
                <FailedErrorMessage message={errorText} />
              ) : isBlocked ? (
                "Required data could not be loaded. Visit the Data page to check coverage, then delete and re-create this run."
              ) : (
                "The worker failed before completion."
              )}
            </p>

            {/* ── Ingest progress bar (waiting_for_data) ─────────────────── */}
            {isWaiting && ingestProgress && ingestProgress.totalJobs > 0 && (
              <div className="mt-2.5 flex items-center gap-2.5">
                <div className="bg-secondary h-1.5 max-w-[280px] flex-1 overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${ingestAvg}%` }}
                  />
                </div>
                <span className="w-9 text-right font-mono text-[11px] text-blue-500 tabular-nums">
                  {ingestAvg}%
                </span>
                {ingestEta && (
                  <span className="text-muted-foreground text-[11px]">{ingestEta}</span>
                )}
              </div>
            )}

            {/* ── Backtest progress bar (running) ────────────────────────── */}
            {(isRunning || isFinishing) && (
              <div className="mt-2.5 flex items-center gap-2.5">
                <div className="bg-secondary h-1.5 max-w-[280px] flex-1 overflow-hidden rounded-full">
                  <div
                    className="bg-warning h-full rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-warning w-9 text-right font-mono text-[11px] tabular-nums">
                  {progress}%
                </span>
                {backtestEta && (
                  <span className="text-muted-foreground text-[11px]">{backtestEta}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
