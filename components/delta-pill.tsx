import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown } from "lucide-react"

export function DeltaPill({
  value,
  label,
  className,
}: {
  value: number
  label?: string
  className?: string
}) {
  const isPositive = value >= 0
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md",
        isPositive
          ? "text-success bg-success/8"
          : "text-destructive bg-destructive/8",
        className
      )}
    >
      {isPositive ? (
        <TrendingUp className="w-3 h-3" />
      ) : (
        <TrendingDown className="w-3 h-3" />
      )}
      {isPositive ? "+" : ""}
      {value}
      {label ? ` ${label}` : ""}
    </span>
  )
}
