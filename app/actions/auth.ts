"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { checkAccountCreationRateLimit } from "@/lib/supabase/rate-limit"

async function transferGuestRuns(guestUserId: string, newUserId: string) {
  const admin = createAdminClient()
  await admin.from("runs").update({ user_id: newUserId }).eq("user_id", guestUserId)
  await admin.auth.admin.deleteUser(guestUserId)
}

export type AuthState = { error: string } | null

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character")

const emailPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: passwordSchema,
})

// ─── Sign In ─────────────────────────────────────────────────────────────────

export async function signInAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
  }
  const parsed = emailPasswordSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const supabase = await createClient()

  // Capture any active guest session before it gets replaced
  const { data: { user: currentUser } } = await supabase.auth.getUser()
  const guestUserId =
    currentUser?.user_metadata?.is_guest === true ? currentUser.id : null

  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    const status = (error as { status?: number }).status
    const message = error.message.toLowerCase()
    if (status === 429 || message.includes("rate limit") || message.includes("too many")) {
      return { error: "Too many sign-in attempts. Please wait a bit and try again." }
    }
    return { error: "Invalid email or password." }
  }

  // Transfer any guest runs to the newly signed-in account
  if (guestUserId && signInData.user && signInData.user.id !== guestUserId) {
    await transferGuestRuns(guestUserId, signInData.user.id)
  }

  redirect("/dashboard")
}

// ─── Sign Up ─────────────────────────────────────────────────────────────────

export async function signUpAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
  }
  const parsed = emailPasswordSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  // Rate limit by IP
  const headersList = await headers()
  const ip = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  const { allowed, error: rateLimitError } = await checkAccountCreationRateLimit(ip)
  if (!allowed) {
    return { error: rateLimitError ?? "Rate limit exceeded. Try again later." }
  }

  const supabase = await createClient()

  // Capture any active guest session before it gets replaced
  const { data: { user: currentUser } } = await supabase.auth.getUser()
  const guestUserId =
    currentUser?.user_metadata?.is_guest === true ? currentUser.id : null

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Skip email confirmation for now — enable in Supabase dashboard for production
      emailRedirectTo: undefined,
    },
  })

  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      return { error: "An account with this email already exists. Please sign in." }
    }
    return { error: error.message }
  }

  // Sign in immediately after sign up (auto-confirm flow)
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (signInError) {
    // Account created but couldn't sign in (email confirmation required)
    return {
      error:
        "Account created! Check your email for a confirmation link, then sign in.",
    }
  }

  // Transfer any guest runs to the new account
  if (guestUserId && signInData.user && signInData.user.id !== guestUserId) {
    await transferGuestRuns(guestUserId, signInData.user.id)
  }

  redirect("/dashboard")
}

// ─── Sign Out ────────────────────────────────────────────────────────────────

export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
