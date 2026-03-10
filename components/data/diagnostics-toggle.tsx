"use client"

import { useSyncExternalStore } from "react"

const STORAGE_KEY = "factorlab:data:diagnostics"
const SYNC_EVENT = "factorlab:diagnostics-changed"

function subscribe(callback: () => void) {
  window.addEventListener(SYNC_EVENT, callback)
  return () => window.removeEventListener(SYNC_EVENT, callback)
}

function getSnapshot() {
  return localStorage.getItem(STORAGE_KEY) === "true"
}

function getServerSnapshot() {
  return false
}

export function useDiagnosticsMode() {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const toggle = () => {
    const next = !enabled
    localStorage.setItem(STORAGE_KEY, String(next))
    window.dispatchEvent(new CustomEvent(SYNC_EVENT))
  }

  return { enabled, toggle }
}

export function DiagnosticsToggle() {
  const { enabled, toggle } = useDiagnosticsMode()

  return (
    <button
      onClick={toggle}
      aria-pressed={enabled}
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
        enabled
          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
          : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
      }`}
    >
      Diagnostics
    </button>
  )
}
