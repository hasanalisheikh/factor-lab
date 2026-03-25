import { cn } from "@/lib/utils";

const MAX_WIDTHS = {
  narrow: "max-w-[900px]",
  medium: "max-w-[1100px]",
  wide: "max-w-[1400px]",
} as const;

type Size = keyof typeof MAX_WIDTHS;

export function PageContainer({
  size = "medium",
  className,
  children,
}: {
  size?: Size;
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("mx-auto w-full", MAX_WIDTHS[size], className)}>{children}</div>;
}
