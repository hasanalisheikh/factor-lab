"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { LogOut, Settings, User } from "lucide-react"
import { signOutAction } from "@/app/actions/auth"
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
  const [isSigningOut, startSignOutTransition] = useTransition()
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    supabase.auth.getUser()
      .then(({ data, error }) => {
        if (cancelled || error || !data.user) return
        setUserInfo({
          email: data.user.email ?? null,
          isGuest: data.user.user_metadata?.is_guest === true,
        })
      })
      .catch(() => {
        // Ignore transient auth fetch failures during fast route transitions.
      })

    return () => {
      cancelled = true
    }
  }, [])

  function handleSignOutClick() {
    if (userInfo?.isGuest) {
      setShowGuestWarning(true)
    } else {
      confirmSignOut()
    }
  }

  async function confirmSignOut() {
    startSignOutTransition(async () => {
      if (userInfo?.isGuest) {
        localStorage.removeItem("fl_notifs_last_seen")
      }

      await signOutAction()
    })
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
          disabled={isSigningOut}
          className="text-[12px] cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="w-3.5 h-3.5 mr-2" />
          {isSigningOut ? "Signing out..." : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <AlertDialog open={showGuestWarning} onOpenChange={setShowGuestWarning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Keep your guest runs?</AlertDialogTitle>
          <AlertDialogDescription>
            Create an account without signing out to keep this guest session&apos;s
            runs and settings on the same account.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 sm:flex-row">
          <AlertDialogAction
            onClick={() => {
              setShowGuestWarning(false)
              router.push("/login?upgrade=1")
            }}
            className="w-full sm:flex-1 sm:min-w-0"
          >
            Create account
          </AlertDialogAction>
          <AlertDialogAction
            onClick={confirmSignOut}
            disabled={isSigningOut}
            className="w-full sm:flex-1 sm:min-w-0 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isSigningOut ? "Signing out..." : "Sign out"}
          </AlertDialogAction>
          <AlertDialogCancel
            disabled={isSigningOut}
            className="w-full sm:flex-1 sm:min-w-0"
          >
            Keep working
          </AlertDialogCancel>
        </div>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
