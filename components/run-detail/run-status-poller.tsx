"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import type { RunStatus } from "@/lib/types"

const POLL_INTERVAL_MS = 3000

export function RunStatusPoller({ status }: { status: RunStatus }) {
  const router = useRouter()

  useEffect(() => {
    if (status !== "queued" && status !== "running" && status !== "waiting_for_data") return

    const id = setInterval(() => {
      router.refresh()
    }, POLL_INTERVAL_MS)

    return () => clearInterval(id)
  }, [status, router])

  return null
}
