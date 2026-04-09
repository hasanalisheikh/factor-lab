"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Logo } from "@/components/logo";
import { TopbarUserMenu } from "@/components/layout/topbar-user-menu";
import { TopbarSearch } from "@/components/layout/topbar-search";
import { TopbarNotifications } from "@/components/layout/topbar-notifications";
import { DiagnosticsToggle } from "@/components/data/diagnostics-toggle";
import { usePathname } from "next/navigation";

export function Topbar({
  title = "Dashboard",
  showDataDiagnosticsToggle = true,
}: {
  title?: string;
  showDataDiagnosticsToggle?: boolean;
}) {
  const pathname = usePathname();
  const showDiagnosticsToggle =
    pathname === "/runs/new" || (pathname === "/data" && showDataDiagnosticsToggle);

  return (
    <header className="border-border bg-card/40 flex h-14 shrink-0 items-center justify-between border-b px-4 backdrop-blur-sm lg:px-6">
      <div className="flex items-center gap-3">
        {/* Mobile menu */}
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground h-8 w-8 lg:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="bg-sidebar border-sidebar-border w-[220px] p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <MobileNav />
          </SheetContent>
        </Sheet>

        {/* Tablet logo; hidden on small mobile screens */}
        <div className="hidden md:block lg:hidden">
          <Link href="/dashboard" aria-label="Go to dashboard">
            <Logo size={48} />
          </Link>
        </div>

        {/* Desktop title */}
        <h1 className="text-foreground hidden text-[13px] font-medium lg:block">{title}</h1>
      </div>

      <div className="flex items-center gap-1">
        <TopbarSearch />
        {showDiagnosticsToggle && <DiagnosticsToggle />}
        <TopbarNotifications />
        <TopbarUserMenu />
      </div>
    </header>
  );
}
