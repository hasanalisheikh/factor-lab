"use client";

import { useEffect, useRef } from "react";
import { Topbar } from "@/components/layout/topbar";

export function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    // react-remove-scroll (used by Radix UI Select) registers a document-level
    // wheel capture listener that calls preventDefault() for all events outside
    // the locked element. We register our own capture listener first (before any
    // Select opens), so it fires first. When the event target is inside <main>,
    // we call stopImmediatePropagation() to prevent react-remove-scroll from
    // cancelling the scroll, allowing normal page scrolling while dropdowns are open.
    const isSelectEventTarget = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      const element = target instanceof Element ? target : target.parentElement;
      return !!element?.closest('[data-radix-select-viewport], [data-slot="select-content"]');
    };

    const handler = (event: Event) => {
      if (!(event.target instanceof Node)) return;
      if (!document.body.hasAttribute("data-scroll-locked")) return;

      // Let Radix Select's own scroll container handle wheel events normally.
      if (isSelectEventTarget(event.target)) {
        return;
      }

      if (el.contains(event.target)) {
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener("wheel", handler, { capture: true });
    document.addEventListener("touchmove", handler, { capture: true });
    return () => {
      document.removeEventListener("wheel", handler, { capture: true });
      document.removeEventListener("touchmove", handler, { capture: true });
    };
  }, []);

  return (
    <>
      <Topbar title={title} />
      <main ref={mainRef} className="w-full min-w-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-4 p-4 lg:p-6">{children}</div>
      </main>
    </>
  );
}
