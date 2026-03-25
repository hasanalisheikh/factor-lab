import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/types";

const statusConfig: Record<RunStatus, { className: string }> = {
  completed: { className: "text-success border-success/20 bg-success/8" },
  running: { className: "text-warning border-warning/20 bg-warning/8" },
  failed: { className: "text-destructive border-destructive/20 bg-destructive/8" },
  blocked: { className: "text-amber-300 border-amber-500/30 bg-amber-500/10" },
  queued: { className: "text-muted-foreground border-border bg-muted/50" },
  waiting_for_data: { className: "text-blue-500 border-blue-500/20 bg-blue-500/8" },
};

const statusLabels: Record<RunStatus, string> = {
  completed: "Completed",
  running: "Running",
  failed: "Failed",
  blocked: "Blocked",
  queued: "Queued",
  waiting_for_data: "Waiting for Data",
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge
      variant="outline"
      data-testid="run-status-badge"
      data-status={status}
      className={cn(
        "h-5 rounded-md px-2 py-0 text-[10px] leading-5 font-medium capitalize",
        statusConfig[status].className
      )}
    >
      {statusLabels[status]}
    </Badge>
  );
}
