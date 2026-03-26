"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { RunStatus } from "@/lib/types";

// Poll faster for the first 30 seconds after a status change,
// then back off to reduce DB load during long-running backtests.
const FAST_INTERVAL_MS = 1500;
const SLOW_INTERVAL_MS = 3000;
const FAST_PHASE_MS = 30_000;

export function RunStatusPoller({ status }: { status: RunStatus }) {
  const router = useRouter();
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status !== "queued" && status !== "running" && status !== "waiting_for_data") {
      startedAtRef.current = null;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Reset the fast phase whenever status changes (e.g. queued → running).
    startedAtRef.current = Date.now();

    function schedule() {
      const elapsed = Date.now() - (startedAtRef.current ?? 0);
      // Queued runs don't benefit from fast polling — nothing changes until worker pickup.
      // Only running/waiting_for_data use the 1.5 s fast phase.
      const inFastPhase = status !== "queued" && elapsed < FAST_PHASE_MS;
      const delay = inFastPhase ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
      timerRef.current = setTimeout(() => {
        router.refresh();
        schedule();
      }, delay);
    }

    schedule();

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [status, router]);

  return null;
}
