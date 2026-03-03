"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut, Settings, User } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"

type UserInfo = {
  email: string | null
  isGuest: boolean
} | null

export function TopbarUserMenu() {
  const [userInfo, setUserInfo] = useState<UserInfo>(null)
  const [showGuestWarning, setShowGuestWarning] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return
      setUserInfo({
        email: data.user.email ?? null,
        isGuest: data.user.user_metadata?.is_guest === true,
      })
    })
  }, [])

  function handleSignOutClick() {
    if (userInfo?.isGuest) {
      setShowGuestWarning(true)
    } else {
      confirmSignOut()
    }
  }

  async function confirmSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = "/login"
  }

  const initials = userInfo?.isGuest
    ? "G"
    : userInfo?.email?.[0]?.toUpperCase() ?? "?"

  const displayName = userInfo?.isGuest
    ? "Guest"
    : (userInfo?.email ?? "…")

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center ml-1.5 hover:ring-2 hover:ring-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-shadow"
          aria-label="User menu"
        >
          <span className="text-[10px] font-semibold text-secondary-foreground">
            {initials}
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={8}
        avoidCollisions
        collisionPadding={12}
        className="w-52"
      >
        <DropdownMenuLabel className="flex items-center gap-2 py-2">
          <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center shrink-0">
            <span className="text-[9px] font-semibold text-secondary-foreground">
              {initials}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-foreground truncate leading-none mb-0.5">
              {userInfo?.isGuest ? "Guest" : (userInfo?.email?.split("@")[0] ?? "…")}
            </p>
            <p className="text-[11px] text-muted-foreground truncate leading-none">
              {userInfo?.isGuest ? "Limited access" : (userInfo?.email ?? "")}
            </p>
          </div>
          {userInfo?.isGuest && (
            <Badge
              variant="secondary"
              className="text-[9px] px-1.5 py-0 h-4 shrink-0"
            >
              Guest
            </Badge>
          )}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => router.push("/settings")}
          className="text-[12px] cursor-pointer"
        >
          <Settings className="w-3.5 h-3.5 mr-2" />
          Settings
        </DropdownMenuItem>

        <DropdownMenuItem
          className="text-[12px] cursor-pointer"
          disabled
        >
          <User className="w-3.5 h-3.5 mr-2" />
          {displayName}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={handleSignOutClick}
          className="text-[12px] cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="w-3.5 h-3.5 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <AlertDialog open={showGuestWarning} onOpenChange={setShowGuestWarning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Your work won&apos;t be saved</AlertDialogTitle>
          <AlertDialogDescription>
            Guest sessions are temporary. Create an account to keep your runs
            and settings, or sign in to an existing account.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogAction onClick={() => router.push("/settings?tab=account")}>
            Create account
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => router.push("/login")}
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
          >
            Sign in
          </AlertDialogAction>
          <AlertDialogCancel onClick={confirmSignOut}>
            Sign out anyway
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
