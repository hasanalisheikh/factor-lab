import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";

const DEFAULT_SUPABASE_FETCH_TIMEOUT_MS = 15000;

function getSupabaseFetchTimeoutMs(): number {
  const raw = process.env.SUPABASE_FETCH_TIMEOUT_MS;
  if (!raw) return DEFAULT_SUPABASE_FETCH_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SUPABASE_FETCH_TIMEOUT_MS;
}

function combineAbortSignals(
  signals: Array<AbortSignal | null | undefined>
): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => signal != null);

  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(activeSignals);
  }

  const controller = new AbortController();
  const forwardAbort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      forwardAbort(signal);
      break;
    }
    signal.addEventListener("abort", () => forwardAbort(signal), { once: true });
  }

  return controller.signal;
}

export async function createClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars");
  }

  return createServerClient<Database>(url, anonKey, {
    global: {
      fetch: async (input, init) => {
        const timeoutController = new AbortController();
        const timeoutMs = getSupabaseFetchTimeoutMs();
        const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
        try {
          return await fetch(input, {
            ...init,
            signal: combineAbortSignals([init?.signal, timeoutController.signal]),
          });
        } finally {
          clearTimeout(timeoutId);
        }
      },
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — safe to ignore.
          // Add middleware to refresh sessions if you use auth.
        }
      },
    },
  });
}
