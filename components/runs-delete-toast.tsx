"use client"

import { useEffect, useRef } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { toast } from "@/hooks/use-toast"

export function RunsDeleteToast() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const lastSeenRef = useRef<string | null>(null)

  useEffect(() => {
    if (searchParams.get("deleted") !== "1") return

    const currentParams = searchParams.toString()
    if (lastSeenRef.current === currentParams) return
    lastSeenRef.current = currentParams

    toast({ title: "Run deleted" })

    const nextParams = new URLSearchParams(currentParams)
    nextParams.delete("deleted")
    const nextQuery = nextParams.toString()
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname)
  }, [pathname, router, searchParams])

  return null
}
