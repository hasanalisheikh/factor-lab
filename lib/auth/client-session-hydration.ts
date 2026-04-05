"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type BrowserSessionHydrationState =
  | { status: "pending"; error: null }
  | { status: "authenticated"; error: null }
  | { status: "failed"; error: string };

const DEFAULT_SESSION_HYDRATION_ERROR =
  "We couldn't complete your sign-in. Please request a new verification email and try again.";

export async function hydrateBrowserSession(
  supabase: SupabaseClient<Database>,
  failureMessage = DEFAULT_SESSION_HYDRATION_ERROR
): Promise<Exclude<BrowserSessionHydrationState, { status: "pending"; error: null }>> {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      return {
        status: "failed",
        error: error?.message ?? failureMessage,
      };
    }

    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

    return { status: "authenticated", error: null };
  }

  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    return {
      status: "failed",
      error: error?.message ?? failureMessage,
    };
  }

  return { status: "authenticated", error: null };
}
