"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { mainNavItems, bottomNavItems, isNavItemActive } from "@/lib/nav-items";

export function MobileNav() {
  const pathname = usePathname();
  const allItems = [...mainNavItems, ...bottomNavItems];

  return (
    <div className="flex h-full flex-col">
      <div className="border-sidebar-border flex h-14 items-center border-b px-5">
        <Link href="/dashboard" aria-label="Go to dashboard">
          <Logo size={52} />
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4" aria-label="Mobile navigation">
        {[...mainNavItems, ...bottomNavItems].map((item) => {
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
    </div>
  );
}
