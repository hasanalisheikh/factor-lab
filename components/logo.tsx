import { cn } from "@/lib/utils"

interface LogoMarkProps {
  size?: number
  className?: string
}

/** Inline SVG icon mark: shield outline with an upward equity-curve arrow inside. */
export function LogoMark({ size = 24, className }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Shield outline */}
      <path
        d="M12 2L4 5.5V11C4 16.25 7.4 21.08 12 22.5C16.6 21.08 20 16.25 20 11V5.5L12 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-foreground/60"
      />
      {/* Equity curve arrow going up inside the shield */}
      <path
        d="M7.5 15.5L10.5 12L13 14L16.5 8.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary"
      />
      {/* Arrow head */}
      <path
        d="M14 8.5H16.5V11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary"
      />
    </svg>
  )
}

interface LogoProps {
  /** "default" = icon + wordmark, "mark" = icon only */
  variant?: "default" | "mark"
  /** Icon pixel size */
  size?: number
  className?: string
}

/** Full FactorLab logo with icon mark + split-color wordmark. */
export function Logo({ variant = "default", size = 24, className }: LogoProps) {
  if (variant === "mark") {
    return <LogoMark size={size} className={className} />
  }

  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark size={size} />
      <span className="text-[13px] font-semibold tracking-tight leading-none">
        <span className="text-foreground">Factor</span>
        <span className="text-primary">Lab</span>
      </span>
    </span>
  )
}
