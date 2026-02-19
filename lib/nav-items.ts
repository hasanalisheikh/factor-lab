import {
  LayoutDashboard,
  FlaskConical,
  Plus,
  GitCompare,
  Server,
  Database,
  Settings,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  name: string
  href: string
  icon: LucideIcon
  /** When true, also match any sub-paths (e.g. /runs/abc123) */
  matchChildren?: boolean
}

export const mainNavItems: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Runs", href: "/runs", icon: FlaskConical, matchChildren: true },
  { name: "New Run", href: "/runs/new", icon: Plus },
  { name: "Compare", href: "/compare", icon: GitCompare },
  { name: "Jobs", href: "/jobs", icon: Server },
  { name: "Data", href: "/data", icon: Database },
]

export const bottomNavItems: NavItem[] = [
  { name: "Settings", href: "/settings", icon: Settings },
]

/**
 * Determines whether a nav item is "active" given the current pathname.
 *
 * - Exact match always wins.
 * - For items with `matchChildren`, any sub-path counts
 *   (e.g. /runs/abc123 activates the Runs item)
 *   UNLESS a *sibling* nav item has an exact match on that sub-path
 *   (e.g. /runs/new should activate "New Run", not "Runs").
 */
export function isNavItemActive(
  item: NavItem,
  pathname: string,
  allItems: NavItem[]
): boolean {
  // Exact match is always active
  if (pathname === item.href) return true

  // For matchChildren items, check if the pathname is a child route
  if (item.matchChildren && pathname.startsWith(item.href + "/")) {
    // But yield to any sibling that has an exact match on this pathname
    const siblingExactMatch = allItems.some(
      (sibling) => sibling !== item && sibling.href === pathname
    )
    return !siblingExactMatch
  }

  return false
}
