"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

const POLL_INTERVAL_MS = 3000

/**
 * Polls the current page every 3 s while `hasActiveRuns` is true.
 * Stops automatically once all runs have settled (completed / failed).
 */
export function ActiveRunsPoller({ hasActiveRuns }: { hasActiveRuns: boolean }) {
  const router = useRouter()

  useEffect(() => {
    if (!hasActiveRuns) return

    const id = setInterval(() => {
      router.refresh()
    }, POLL_INTERVAL_MS)

    return () => clearInterval(id)
  }, [hasActiveRuns, router])

  return null
}
