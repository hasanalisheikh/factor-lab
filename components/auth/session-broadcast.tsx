"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { broadcastEmailVerificationComplete } from "@/lib/auth/email-verification-sync";

/**
 * Invisible component included on the /auth/verified page.
 *
 * After a PKCE magic-link activation, the callback establishes the session
 * server-side (cookies). Calling getSession() here causes the Supabase browser
 * client to read those cookies and sync the session to localStorage, which
 * fires an onAuthStateChange SIGNED_IN event in any other open tab that is
 * listening (e.g. the verify-tab on /login).
 */
export function SessionBroadcast() {
  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getSession().finally(() => {
      broadcastEmailVerificationComplete();
    });
  }, []);
  return null;
}
