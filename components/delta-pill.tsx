import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

interface DeltaPillProps {
  /** Raw signed number – used only to determine green vs red direction */
  deltaRaw: number | null;
  /** Pre-formatted string to display, e.g. "+3.2 pp" or "+0.15" */
  deltaFormatted: string | null;
  /** Short suffix label, e.g. "vs SPY" */
  label?: string;
  /**
   * When true: negative delta is GOOD (lower-is-better metrics like Max Drawdown).
   * Defaults to false (higher-is-better).
   */
  lowerIsBetter?: boolean;
  className?: string;
}

export function DeltaPill({
  deltaRaw,
  deltaFormatted,
  label,
  lowerIsBetter = false,
  className,
}: DeltaPillProps) {
  // Null / unavailable delta → neutral pill
  if (deltaRaw === null || deltaFormatted === null) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
          "text-muted-foreground bg-muted/30",
          className
        )}
      >
        —{label ? ` ${label}` : ""}
      </span>
    );
  }

  // Higher-is-better: positive = green. Lower-is-better: negative = green.
  // Zero delta is neutral.
  const isNeutral = deltaRaw === 0;
  const isGood = lowerIsBetter ? deltaRaw < 0 : deltaRaw > 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        isNeutral
          ? "text-muted-foreground bg-muted/30"
          : isGood
            ? "text-success bg-success/8"
            : "text-destructive bg-destructive/8",
        className
      )}
    >
      {isNeutral ? null : isGood ? (
        <TrendingUp className="h-3 w-3 shrink-0" />
      ) : (
        <TrendingDown className="h-3 w-3 shrink-0" />
      )}
      {deltaFormatted}
      {label ? ` ${label}` : ""}
    </span>
  );
}
