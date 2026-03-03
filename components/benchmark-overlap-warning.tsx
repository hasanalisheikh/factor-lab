"use client"

import { CircleHelp } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface BenchmarkOverlapWarningProps {
  benchmark: string
}

export function BenchmarkOverlapWarning({ benchmark }: BenchmarkOverlapWarningProps) {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span>
          Note: This strategy holds <strong>{benchmark}</strong> while using it as the benchmark.
          {" "}&ldquo;vs {benchmark}&rdquo; deltas may be less informative.
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-amber-200 underline underline-offset-2 shrink-0"
            >
              <CircleHelp className="h-3 w-3" />
              Why?
            </button>
          </TooltipTrigger>
          <TooltipContent sideOffset={8} className="max-w-xs">
            When a strategy holds the same asset used as its benchmark, part of the
            portfolio <em>is</em> the benchmark. This can understate or overstate relative
            performance deltas (e.g. CAGR vs {benchmark}), since the strategy is partially
            tracking itself against the benchmark.
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
