import "server-only"

/**
 * Server-only admin client — uses the service role key, bypasses RLS entirely.
 * NEVER import this in client components or expose it to the browser.
 */
import { createClient } from "@supabase/supabase-js"
import type { Database } from "./types"

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    )
  }

  return createClient<Database, "public">(url, key, {
    auth: { persistSession: false },
  })
}
