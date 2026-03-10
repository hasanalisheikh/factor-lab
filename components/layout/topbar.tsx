"use client"

import Link from "next/link"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet"
import { MobileNav } from "@/components/layout/mobile-nav"
import { Logo } from "@/components/logo"
import { TopbarUserMenu } from "@/components/layout/topbar-user-menu"
import { TopbarSearch } from "@/components/layout/topbar-search"
import { TopbarNotifications } from "@/components/layout/topbar-notifications"
import { DiagnosticsToggle } from "@/components/data/diagnostics-toggle"
import { usePathname } from "next/navigation"

export function Topbar({ title = "Dashboard" }: { title?: string }) {
  const pathname = usePathname()
  return (
    <header className="flex items-center justify-between h-14 px-4 lg:px-6 border-b border-border bg-card/40 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-3">
        {/* Mobile menu */}
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-muted-foreground h-8 w-8"
              aria-label="Open navigation menu"
            >
              <Menu className="w-4 h-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[220px] p-0 bg-sidebar border-sidebar-border">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <MobileNav />
          </SheetContent>
        </Sheet>

        {/* Mobile logo */}
        <div className="lg:hidden">
          <Link href="/dashboard" aria-label="Go to dashboard">
            <Logo size={48} />
          </Link>
        </div>

        {/* Desktop title */}
        <h1 className="hidden lg:block text-[13px] font-medium text-foreground">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-1">
        <TopbarSearch />
        {pathname === "/data" && <DiagnosticsToggle />}
        <TopbarNotifications />
        <TopbarUserMenu />
      </div>
    </header>
  )
}
