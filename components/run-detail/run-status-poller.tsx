"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { RunStatus } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";
import {
  deriveRunDetailDisplayState,
  isActiveRunStatus,
  isRunStatus,
} from "@/components/run-detail/run-status-state";

// Poll faster for the first 30 seconds after a status change,
// then back off to reduce DB load during long-running backtests.
const FAST_INTERVAL_MS = 1500;
const SLOW_INTERVAL_MS = 3000;
const FAST_PHASE_MS = 30_000;
const TRAILING_REFRESH_DELAYS_MS = [300, 1000, 2000, 4000];
const RELOAD_FALLBACK_MS = 5000;

type RunStatusRow = Pick<Database["public"]["Tables"]["runs"]["Row"], "id" | "status">;
type JobStatusRow = Pick<Database["public"]["Tables"]["jobs"]["Row"], "status" | "progress">;

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

function getActivePollDelay(status: RunStatus, startedAt: number | null): number {
  const elapsed = Date.now() - (startedAt ?? 0);
  const inFastPhase = status !== "queued" && elapsed < FAST_PHASE_MS;
  return inFastPhase ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
}

function scheduleRefreshBurst({
  burstKey,
  includeImmediate,
  router,
  lastBurstKeyRef,
  trailingTimersRef,
}: {
  burstKey: string;
  includeImmediate: boolean;
  router: ReturnType<typeof useRouter>;
  lastBurstKeyRef: { current: string | null };
  trailingTimersRef: { current: Array<ReturnType<typeof setTimeout>> };
}): boolean {
  if (lastBurstKeyRef.current === burstKey) {
    return false;
  }

  lastBurstKeyRef.current = burstKey;
  clearTrailingTimers(trailingTimersRef);

  if (includeImmediate) {
    router.refresh();
  }

  trailingTimersRef.current = TRAILING_REFRESH_DELAYS_MS.map((ms) =>
    setTimeout(() => {
      router.refresh();
    }, ms)
  );

  return true;
}

export function RunStatusPoller({
  runId,
  status,
  jobStatus,
}: {
  runId: string;
  status: RunStatus;
  jobStatus?: string | null;
}) {
  const router = useRouter();
  const startedAtRef = useRef<number | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const browserPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trailingTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const hasSeenActiveRef = useRef(false);
  const lastBurstKeyRef = useRef<string | null>(null);
  const lastBrowserRecoveryKeyRef = useRef<string | null>(null);
  const hasReloadedRef = useRef(false);
  const latestStatusRef = useRef(status);

  useEffect(() => {
    latestStatusRef.current = status;
  }, [status]);

  useEffect(() => {
    hasReloadedRef.current = false;
    lastBrowserRecoveryKeyRef.current = null;
    lastBurstKeyRef.current = null;
    clearPollTimer(pollTimerRef);
    clearPollTimer(browserPollTimerRef);
    clearPollTimer(reloadTimerRef);
    clearTrailingTimers(trailingTimersRef);
    startedAtRef.current = null;
    hasSeenActiveRef.current = false;
  }, [runId]);

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
      const delay = getActivePollDelay(status, startedAtRef.current);
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

    const burstKey = `${runId}:${status}:${jobStatus ?? ""}`;
    scheduleRefreshBurst({
      burstKey,
      includeImmediate: false,
      router,
      lastBurstKeyRef,
      trailingTimersRef,
    });
  }, [jobStatus, router, runId, status]);

  useEffect(() => {
    if (!isActiveRunStatus(status)) {
      clearPollTimer(browserPollTimerRef);
      clearPollTimer(reloadTimerRef);
      lastBrowserRecoveryKeyRef.current = null;
      hasReloadedRef.current = false;
      return;
    }

    const supabase = createClient();
    let cancelled = false;

    async function pollBrowserStatus() {
      const [runResult, jobResult] = await Promise.all([
        supabase.from("runs").select("id, status").eq("id", runId).maybeSingle(),
        supabase
          .from("jobs")
          .select("status, progress")
          .eq("run_id", runId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      const runRow = runResult.data as RunStatusRow | null;
      const jobRow = jobResult.data as JobStatusRow | null;
      const browserRunStatus = isRunStatus(runRow?.status)
        ? runRow.status
        : latestStatusRef.current;
      const browserJobStatus = typeof jobRow?.status === "string" ? jobRow.status : null;
      const browserProgress = typeof jobRow?.progress === "number" ? jobRow.progress : null;
      const browserDisplayState = deriveRunDetailDisplayState({
        runStatus: browserRunStatus,
        jobStatus: browserJobStatus,
        jobProgress: browserProgress,
      });

      if (browserDisplayState.hasTerminalSignal) {
        const recoveryKey = `${runId}:${browserRunStatus}:${browserJobStatus ?? ""}`;
        if (lastBrowserRecoveryKeyRef.current === recoveryKey) {
          return;
        }

        lastBrowserRecoveryKeyRef.current = recoveryKey;
        const startedBurst = scheduleRefreshBurst({
          burstKey: recoveryKey,
          includeImmediate: true,
          router,
          lastBurstKeyRef,
          trailingTimersRef,
        });

        if (startedBurst && reloadTimerRef.current === null && !hasReloadedRef.current) {
          reloadTimerRef.current = setTimeout(() => {
            reloadTimerRef.current = null;
            if (hasReloadedRef.current || !isActiveRunStatus(latestStatusRef.current)) {
              return;
            }
            hasReloadedRef.current = true;
            globalThis.location.reload();
          }, RELOAD_FALLBACK_MS);
        }

        return;
      }

      browserPollTimerRef.current = setTimeout(
        () => {
          void pollBrowserStatus();
        },
        getActivePollDelay(latestStatusRef.current, startedAtRef.current)
      );
    }

    void pollBrowserStatus();

    return () => {
      cancelled = true;
      clearPollTimer(browserPollTimerRef);
    };
  }, [router, runId, status]);

  useEffect(() => {
    return () => {
      clearPollTimer(pollTimerRef);
      clearPollTimer(browserPollTimerRef);
      clearPollTimer(reloadTimerRef);
      clearTrailingTimers(trailingTimersRef);
    };
  }, []);

  return null;
}
