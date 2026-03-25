"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useDiagnosticsMode() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const enabled = searchParams.get("diagnostics") === "1";

  const toggle = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (enabled) {
      params.delete("diagnostics");
    } else {
      params.set("diagnostics", "1");
    }

    const nextHref = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(nextHref, { scroll: false });
  };

  return { enabled, toggle };
}

export function DiagnosticsToggle() {
  const { enabled, toggle } = useDiagnosticsMode();

  return (
    <button
      onClick={toggle}
      aria-pressed={enabled}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        enabled
          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
          : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
      }`}
    >
      Diagnostics
    </button>
  );
}
