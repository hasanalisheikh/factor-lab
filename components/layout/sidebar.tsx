"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { mainNavItems, bottomNavItems, isNavItemActive } from "@/lib/nav-items";

export function Sidebar() {
  const pathname = usePathname();
  const allItems = [...mainNavItems, ...bottomNavItems];

  return (
    <aside className="border-border bg-sidebar hidden shrink-0 border-r lg:flex lg:w-[220px] lg:flex-col">
      {/* Logo */}
      <div className="border-sidebar-border flex h-14 items-center border-b px-5">
        <Link href="/dashboard" aria-label="Go to dashboard">
          <Logo size={52} />
        </Link>
      </div>

      {/* Main nav */}
      <nav className="flex flex-1 flex-col gap-0.5 px-3 pt-4" aria-label="Main navigation">
        {mainNavItems.map((item) => {
          const active = isNavItemActive(item, pathname, allItems);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13px] font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/50 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/80"
              )}
              aria-current={active ? "page" : undefined}
            >
              <item.icon className="h-[15px] w-[15px] shrink-0" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {bottomNavItems.length > 0 ? (
        <div className="border-sidebar-border flex flex-col gap-0.5 border-t px-3 pt-3 pb-4">
          {bottomNavItems.map((item) => {
            const active = isNavItemActive(item, pathname, allItems);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13px] font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/50 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/80"
                )}
                aria-current={active ? "page" : undefined}
              >
                <item.icon className="h-[15px] w-[15px] shrink-0" />
                {item.name}
              </Link>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
}
