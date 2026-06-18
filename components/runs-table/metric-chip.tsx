import { cn } from "@/lib/utils";

export function MetricChip({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="border-border/60 bg-secondary/20 rounded-lg border px-2.5 py-2">
      <div className="text-muted-foreground text-[10px] font-medium tracking-[0.12em] uppercase">
        {label}
      </div>
      <div className={cn("text-card-foreground mt-1 font-mono text-[13px]", valueClassName)}>
        {value}
      </div>
    </div>
  );
}
