"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  hydrateBrowserSession,
  type BrowserSessionHydrationState,
} from "@/lib/auth/client-session-hydration";
import { createClient } from "@/lib/supabase/client";
import { broadcastEmailVerificationComplete } from "@/lib/auth/email-verification-sync";

/**
 * Authoritative client-side completion surface for verification links.
 *
 * It hydrates the auth session from URL hash tokens or cookies, then broadcasts
 * a cross-tab completion signal so the original /login?tab=verify tab can
 * continue to /dashboard automatically.
 */
export function SessionBroadcast() {
  const [state, setState] = useState<BrowserSessionHydrationState>({
    status: "pending",
    error: null,
  });
  const hasBroadcastRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    async function finalizeVerification() {
      const result = await hydrateBrowserSession(
        supabase,
        "We couldn't finish verifying your email. Please request a new verification email and try again."
      );

      if (cancelled) return;

      setState(result);

      if (result.status === "authenticated" && !hasBroadcastRef.current) {
        hasBroadcastRef.current = true;
        broadcastEmailVerificationComplete();
      }
    }

    void finalizeVerification();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "pending") {
    return (
      <>
        <div className="bg-primary/10 text-primary mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full">
          <Spinner className="size-4" />
        </div>
        <h1 className="text-foreground mb-2 text-lg font-semibold">Finishing verification...</h1>
        <p className="text-muted-foreground text-sm">
          We&apos;re signing you in now. This tab will be ready in a moment.
        </p>
      </>
    );
  }

  if (state.status === "failed") {
    return (
      <>
        <AlertCircle className="mx-auto mb-4 h-10 w-10 text-rose-400" />
        <h1 className="text-foreground mb-2 text-lg font-semibold">
          We couldn&apos;t finish your sign-in
        </h1>
        <p className="text-muted-foreground mb-4 text-sm">{state.error}</p>
        <p className="text-muted-foreground/60 text-xs">
          You can{" "}
          <Link
            href="/login?tab=verify"
            className="text-primary underline-offset-2 hover:underline"
          >
            return to verification
          </Link>{" "}
          and request a fresh link.
        </p>
      </>
    );
  }

  return (
    <>
      <CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-emerald-400" />
      <h1 className="text-foreground mb-2 text-lg font-semibold">Email Confirmed</h1>
      <p className="text-muted-foreground mb-4 text-sm">
        You&apos;re signed in now. You can close this tab. If your original login window is still
        open, it will refresh and continue automatically.
      </p>
      <p className="text-muted-foreground/60 text-xs">
        If you need it,{" "}
        <Link href="/dashboard" className="text-primary underline-offset-2 hover:underline">
          go to your dashboard
        </Link>
        .
      </p>
    </>
  );
}
