"use client"

import { useActionState } from "react"
import { Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { generateRunReport } from "@/app/actions/reports"

interface GenerateReportButtonProps {
  runId: string
}

export function GenerateReportButton({ runId }: GenerateReportButtonProps) {
  const action = generateRunReport.bind(null, runId)
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={isPending}
          className="h-8 text-[12px] font-medium border-border text-muted-foreground hover:text-foreground shrink-0"
        >
          {isPending ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5 mr-1.5" />
          )}
          {isPending ? "Generating…" : "Generate Report"}
        </Button>
      </form>
      {state?.error && (
        <p className="text-[11px] text-destructive max-w-[220px] text-right leading-snug">
          {state.error}
        </p>
      )}
    </div>
  )
}
