"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

type NativeSelectProps = React.ComponentProps<"select"> & {
  hasValue?: boolean;
  wrapperClassName?: string;
  iconClassName?: string;
};

const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, wrapperClassName, iconClassName, hasValue = true, children, ...props }, ref) => {
    return (
      <div className={cn("relative", wrapperClassName)}>
        <select
          ref={ref}
          className={cn(
            "focus-visible:border-ring focus-visible:ring-ring/50 w-full appearance-none rounded-md border shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]",
            hasValue ? "text-foreground" : "text-muted-foreground",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className={cn(
            "text-muted-foreground/70 pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2",
            iconClassName
          )}
          aria-hidden="true"
        />
      </div>
    );
  }
);

NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
