"use client";

import type { RunStatus } from "@/lib/types";

export type RunDetailDisplayStatus = RunStatus | "finishing";

export interface RunDetailDisplayState {
  status: RunDetailDisplayStatus;
  progress: number | null;
  hasTerminalSignal: boolean;
}

const ACTIVE_RUN_STATUSES: RunStatus[] = ["queued", "running", "waiting_for_data"];
const TERMINAL_RUN_STATUSES: RunStatus[] = ["completed", "failed", "blocked"];
const TERMINAL_JOB_STATUSES = ["completed", "failed", "blocked"] as const;

function clampProgress(progress: number | null | undefined): number {
  if (typeof progress !== "number" || Number.isNaN(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

export function isActiveRunStatus(status: RunStatus): boolean {
  return ACTIVE_RUN_STATUSES.includes(status);
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

export function isTerminalJobStatus(
  status: string | null | undefined
): status is (typeof TERMINAL_JOB_STATUSES)[number] {
  return (
    status != null &&
    TERMINAL_JOB_STATUSES.includes(status as (typeof TERMINAL_JOB_STATUSES)[number])
  );
}

export function deriveRunDetailDisplayState({
  runStatus,
  jobStatus,
  jobProgress,
}: {
  runStatus: RunStatus;
  jobStatus: string | null | undefined;
  jobProgress: number | null | undefined;
}): RunDetailDisplayState {
  if (isTerminalRunStatus(runStatus)) {
    return {
      status: runStatus,
      progress: 100,
      hasTerminalSignal: true,
    };
  }

  if (jobStatus === "failed" || jobStatus === "blocked") {
    return {
      status: jobStatus,
      progress: 100,
      hasTerminalSignal: true,
    };
  }

  if (jobStatus === "completed") {
    return {
      status: "finishing",
      progress: 100,
      hasTerminalSignal: true,
    };
  }

  return {
    status: runStatus,
    progress: runStatus === "running" ? clampProgress(jobProgress) : null,
    hasTerminalSignal: false,
  };
}
