"use client"

import { Bell, Search, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet"
import { MobileNav } from "@/components/layout/mobile-nav"
import { Logo } from "@/components/logo"

export function Topbar({ title = "Dashboard" }: { title?: string }) {
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
          <Logo size={20} />
        </div>

        {/* Desktop title */}
        <h1 className="hidden lg:block text-[13px] font-medium text-foreground">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground h-8 w-8"
          aria-label="Search"
        >
          <Search className="w-[15px] h-[15px]" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground relative h-8 w-8"
          aria-label="Notifications"
        >
          <Bell className="w-[15px] h-[15px]" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary" />
        </Button>
        <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center ml-1.5">
          <span className="text-[10px] font-semibold text-secondary-foreground">JD</span>
        </div>
      </div>
    </header>
  )
}
