"use client";

import type { SyntheticEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { DeleteRunDialog } from "@/components/delete-run-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RunStatus } from "@/lib/types";

const RUN_DELETE_BLOCKED_STATUSES = new Set<RunStatus>(["queued", "running", "waiting_for_data"]);

type RunActionsMenuProps = {
  runId: string;
  runName: string;
  status: RunStatus;
  reportUrl?: string | null;
  showReportAction?: boolean;
};

export function RunActionsMenu({
  runId,
  runName,
  status,
  reportUrl = null,
  showReportAction = false,
}: RunActionsMenuProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteDisabled = RUN_DELETE_BLOCKED_STATUSES.has(status);
  const stopRowNavigation = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground h-8 w-8"
            aria-label={`Open actions for ${runName}`}
            onClick={stopRowNavigation}
            onKeyDown={stopRowNavigation}
            onPointerDown={stopRowNavigation}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/runs/${runId}`}>Open run</Link>
          </DropdownMenuItem>
          {showReportAction && reportUrl ? (
            <DropdownMenuItem asChild>
              <a href={reportUrl} target="_blank" rel="noreferrer">
                Download report
              </a>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={deleteDisabled}
            title={
              deleteDisabled
                ? "Delete is unavailable while this run is queued, running, or waiting for data."
                : undefined
            }
            onSelect={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDeleteOpen(true);
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteRunDialog open={deleteOpen} onOpenChange={setDeleteOpen} runId={runId} />
    </>
  );
}
