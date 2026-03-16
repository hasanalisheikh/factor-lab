"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { DeleteRunDialog } from "@/components/delete-run-dialog"
import { Button } from "@/components/ui/button"
import type { RunStatus } from "@/lib/types"

const RUN_DELETE_BLOCKED_STATUSES = new Set<RunStatus>(["queued", "running", "waiting_for_data"])

type RunDeleteButtonProps = {
  runId: string
  status: RunStatus
}

export function RunDeleteButton({ runId, status }: RunDeleteButtonProps) {
  const [open, setOpen] = useState(false)
  const disabled = RUN_DELETE_BLOCKED_STATUSES.has(status)

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? "Delete is unavailable while this run is queued, running, or waiting for data." : undefined}
        className="h-8 text-[12px] font-medium shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
        Delete run
      </Button>
      <DeleteRunDialog open={open} onOpenChange={setOpen} runId={runId} />
    </>
  )
}
