"use client"

import { CircleHelp } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface BenchmarkOverlapWarningProps {
  benchmark: string
}

export function BenchmarkOverlapWarning({ benchmark }: BenchmarkOverlapWarningProps) {
  const message = `This strategy holds ${benchmark} while using it as the benchmark. This is not incorrect, but 'vs ${benchmark}' deltas may be less informative because part of the portfolio is the benchmark.`

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100">
      <div className="flex items-center gap-1.5">
        <span>{`Note: ${message}`}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-amber-200 underline underline-offset-2"
            >
              <CircleHelp className="h-3 w-3" />
              Why?
            </button>
          </TooltipTrigger>
          <TooltipContent sideOffset={8} className="max-w-xs">
            {message}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
