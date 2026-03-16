"use client"

import { useState, useTransition } from "react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { deleteRunAction } from "@/app/actions/runs"

type DeleteRunDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  runId: string
}

export function DeleteRunDialog({ open, onOpenChange, runId }: DeleteRunDialogProps) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleOpenChange = (nextOpen: boolean) => {
    if (isPending) return
    if (!nextOpen) {
      setError(null)
    }
    onOpenChange(nextOpen)
  }

  const handleDelete = () => {
    startTransition(async () => {
      setError(null)
      const result = await deleteRunAction(runId)
      if (result?.error) {
        setError(result.error)
      }
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this run?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the run, its jobs, metrics, equity curve, holdings/trades,
            and report. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="text-[12px] text-destructive">{error}</p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isPending}
          >
            {isPending ? "Deleting..." : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
