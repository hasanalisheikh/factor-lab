"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

const AUTH_SIGN_OUT_TIMEOUT_MS = 1500;
const AUTH_STORAGE_CHUNKS_TO_CLEAR = 8;

function getCookieDeletionSuffix() {
  return window.location.protocol === "https:"
    ? "; path=/; SameSite=Lax; Secure"
    : "; path=/; SameSite=Lax";
}

export function getSupabaseAuthStorageKey(supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  if (!supabaseUrl) {
    return null;
  }

  try {
    return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }
}

function clearBrowserCookie(name: string) {
  document.cookie = `${name}=${getCookieDeletionSuffix()}; Max-Age=0`;
}

function clearBrowserStorageKey(name: string) {
  try {
    window.localStorage.removeItem(name);
  } catch {
    // localStorage may be unavailable in private contexts.
  }
}

function clearChunkedBrowserStorageKey(name: string) {
  clearBrowserCookie(name);
  clearBrowserStorageKey(name);

  for (let index = 0; index < AUTH_STORAGE_CHUNKS_TO_CLEAR; index += 1) {
    const chunkName = `${name}.${index}`;
    clearBrowserCookie(chunkName);
    clearBrowserStorageKey(chunkName);
  }
}

export function clearSupabaseBrowserSession(storageKey = getSupabaseAuthStorageKey()) {
  if (typeof window === "undefined" || !storageKey) {
    return false;
  }

  clearChunkedBrowserStorageKey(storageKey);
  clearChunkedBrowserStorageKey(`${storageKey}-code-verifier`);
  clearChunkedBrowserStorageKey(`${storageKey}-user`);

  return true;
}

export async function finalizePasswordResetSession(
  supabase: Pick<SupabaseClient<Database>, "auth">,
  options?: {
    timeoutMs?: number;
    storageKey?: string | null;
  }
) {
  const timeoutMs = options?.timeoutMs ?? AUTH_SIGN_OUT_TIMEOUT_MS;
  const usedFallback = clearSupabaseBrowserSession(options?.storageKey);

  // Ask the Supabase client to clear any in-memory auth state too, but do not
  // block the UI on this step. The browser storage has already been cleared.
  void Promise.race([
    supabase.auth.signOut({ scope: "local" }),
    new Promise((resolve) => {
      window.setTimeout(resolve, timeoutMs);
    }),
  ]).catch(() => undefined);

  return {
    error: null,
    usedFallback,
  };
}
