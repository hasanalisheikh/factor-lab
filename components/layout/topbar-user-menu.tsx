"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Settings, User } from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

type UserInfo = {
  email: string | null;
  isGuest: boolean;
} | null;

export function TopbarUserMenu() {
  const [userInfo, setUserInfo] = useState<UserInfo>(null);
  const [showGuestWarning, setShowGuestWarning] = useState(false);
  const [isSigningOut, startSignOutTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data, error }) => {
        if (cancelled || error || !data.user) return;
        setUserInfo({
          email: data.user.email ?? null,
          isGuest: data.user.user_metadata?.is_guest === true,
        });
      })
      .catch(() => {
        // Ignore transient auth fetch failures during fast route transitions.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleSignOutClick() {
    if (userInfo?.isGuest) {
      setShowGuestWarning(true);
    } else {
      confirmSignOut();
    }
  }

  async function confirmSignOut() {
    startSignOutTransition(async () => {
      if (userInfo?.isGuest) {
        localStorage.removeItem("fl_notifs_last_seen");
      }

      await signOutAction();
    });
  }

  const initials = userInfo?.isGuest ? "G" : (userInfo?.email?.[0]?.toUpperCase() ?? "?");

  const displayName = userInfo?.isGuest ? "Guest" : (userInfo?.email ?? "…");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="bg-secondary hover:ring-primary/30 focus-visible:ring-primary/50 ml-1.5 flex h-7 w-7 items-center justify-center rounded-full transition-shadow hover:ring-2 focus-visible:ring-2 focus-visible:outline-none"
            aria-label="User menu"
          >
            <span className="text-secondary-foreground text-[10px] font-semibold">{initials}</span>
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
            <div className="bg-secondary flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
              <span className="text-secondary-foreground text-[9px] font-semibold">{initials}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-foreground mb-0.5 truncate text-[12px] leading-none font-medium">
                {userInfo?.isGuest ? "Guest" : (userInfo?.email?.split("@")[0] ?? "…")}
              </p>
              <p className="text-muted-foreground truncate text-[11px] leading-none">
                {userInfo?.isGuest ? "Limited access" : (userInfo?.email ?? "")}
              </p>
            </div>
            {userInfo?.isGuest && (
              <Badge variant="secondary" className="h-4 shrink-0 px-1.5 py-0 text-[9px]">
                Guest
              </Badge>
            )}
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => router.push("/settings")}
            className="cursor-pointer text-[12px]"
          >
            <Settings className="mr-2 h-3.5 w-3.5" />
            Settings
          </DropdownMenuItem>

          <DropdownMenuItem className="cursor-pointer text-[12px]" disabled>
            <User className="mr-2 h-3.5 w-3.5" />
            {displayName}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={handleSignOutClick}
            disabled={isSigningOut}
            className="text-destructive focus:text-destructive cursor-pointer text-[12px]"
          >
            <LogOut className="mr-2 h-3.5 w-3.5" />
            {isSigningOut ? "Signing out..." : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showGuestWarning} onOpenChange={setShowGuestWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Keep your guest runs?</AlertDialogTitle>
            <AlertDialogDescription>
              Create an account without signing out to keep this guest session&apos;s runs and
              settings on the same account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row">
            <AlertDialogAction
              onClick={() => {
                setShowGuestWarning(false);
                router.push("/login?upgrade=1");
              }}
              className="w-full sm:min-w-0 sm:flex-1"
            >
              Create account
            </AlertDialogAction>
            <AlertDialogAction
              onClick={confirmSignOut}
              disabled={isSigningOut}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 w-full sm:min-w-0 sm:flex-1"
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </AlertDialogAction>
            <AlertDialogCancel disabled={isSigningOut} className="w-full sm:min-w-0 sm:flex-1">
              Keep working
            </AlertDialogCancel>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
