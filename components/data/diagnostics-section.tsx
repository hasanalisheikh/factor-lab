"use client"

import { useDiagnosticsMode } from "./diagnostics-toggle"

export function DiagnosticsSection({ children }: { children: React.ReactNode }) {
  const { enabled } = useDiagnosticsMode()
  if (!enabled) return null
  return <>{children}</>
}
