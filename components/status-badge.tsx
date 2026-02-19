import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { RunStatus } from "@/lib/types"

const statusConfig: Record<RunStatus, { className: string }> = {
  completed: { className: "text-success border-success/20 bg-success/8" },
  running: { className: "text-warning border-warning/20 bg-warning/8" },
  failed: { className: "text-destructive border-destructive/20 bg-destructive/8" },
  queued: { className: "text-muted-foreground border-border bg-muted/50" },
}

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-medium capitalize px-2 py-0 h-5 leading-5 rounded-md",
        statusConfig[status].className
      )}
    >
      {status}
    </Badge>
  )
}
