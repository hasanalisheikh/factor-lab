"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { RunStatus } from "@/lib/types";
import {
  deriveRunDetailDisplayState,
  isActiveRunStatus,
} from "@/components/run-detail/run-status-state";

// Poll faster for the first 30 seconds after a status change,
// then back off to reduce DB load during long-running backtests.
const FAST_INTERVAL_MS = 1500;
const SLOW_INTERVAL_MS = 3000;
const FAST_PHASE_MS = 30_000;
const TRAILING_REFRESH_DELAYS_MS = [300, 1000, 2000, 4000];

function clearPollTimer(timerRef: { current: ReturnType<typeof setTimeout> | null }) {
  if (timerRef.current !== null) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

function clearTrailingTimers(timerRef: { current: Array<ReturnType<typeof setTimeout>> }) {
  timerRef.current.forEach(clearTimeout);
  timerRef.current = [];
}

export function RunStatusPoller({
  status,
  jobStatus,
}: {
  status: RunStatus;
  jobStatus?: string | null;
}) {
  const router = useRouter();
  const startedAtRef = useRef<number | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trailingTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const hasSeenActiveRef = useRef(false);
  const lastBurstKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isActiveRunStatus(status)) {
      startedAtRef.current = null;
      clearPollTimer(pollTimerRef);
      return;
    }

    hasSeenActiveRef.current = true;

    // Reset the fast phase whenever status changes (e.g. queued → running).
    startedAtRef.current = Date.now();

    function schedule() {
      const elapsed = Date.now() - (startedAtRef.current ?? 0);
      // Queued runs don't benefit from fast polling — nothing changes until worker pickup.
      // Only running/waiting_for_data use the 1.5 s fast phase.
      const inFastPhase = status !== "queued" && elapsed < FAST_PHASE_MS;
      const delay = inFastPhase ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
      pollTimerRef.current = setTimeout(() => {
        router.refresh();
        schedule();
      }, delay);
    }

    schedule();

    return () => {
      clearPollTimer(pollTimerRef);
    };
  }, [status, router]);

  useEffect(() => {
    const displayState = deriveRunDetailDisplayState({
      runStatus: status,
      jobStatus,
      jobProgress: null,
    });

    if (!displayState.hasTerminalSignal) {
      lastBurstKeyRef.current = null;
      clearTrailingTimers(trailingTimersRef);
      return;
    }

    if (!hasSeenActiveRef.current) {
      return;
    }

    const burstKey = `${status}:${jobStatus ?? ""}`;
    if (lastBurstKeyRef.current === burstKey) {
      return;
    }

    lastBurstKeyRef.current = burstKey;
    clearTrailingTimers(trailingTimersRef);

    trailingTimersRef.current = TRAILING_REFRESH_DELAYS_MS.map((ms) =>
      setTimeout(() => {
        router.refresh();
      }, ms)
    );
  }, [jobStatus, router, status]);

  useEffect(() => {
    return () => {
      clearPollTimer(pollTimerRef);
      clearTrailingTimers(trailingTimersRef);
    };
  }, []);

  return null;
}
