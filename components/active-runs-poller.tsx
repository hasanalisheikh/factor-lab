"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

// Poll faster for the first 30 seconds (catches newly queued runs quickly),
// then back off to a gentler cadence to reduce DB load.
const FAST_INTERVAL_MS = 1500
const SLOW_INTERVAL_MS = 3000
const FAST_PHASE_MS = 30_000

/**
 * Polls the current page while `hasActiveRuns` is true.
 * Runs at 1.5 s for the first 30 s, then at 3 s thereafter.
 * Stops automatically once all runs have settled (completed / failed).
 */
export function ActiveRunsPoller({ hasActiveRuns }: { hasActiveRuns: boolean }) {
  const router = useRouter()
  const startedAtRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!hasActiveRuns) {
      startedAtRef.current = null
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }

    startedAtRef.current = Date.now()

    function schedule() {
      const elapsed = Date.now() - (startedAtRef.current ?? 0)
      const delay = elapsed < FAST_PHASE_MS ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS
      timerRef.current = setTimeout(() => {
        router.refresh()
        schedule()
      }, delay)
    }

    schedule()

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [hasActiveRuns, router])

  return null
}
