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
export type ResendState = { error: string } | { success: true } | null

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

  // Build the callback URL for email verification.
  // NEXT_PUBLIC_SITE_URL should be set to https://factor-lab.vercel.app in production.
  // Falls back to the request origin (works for local dev automatically).
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (await headers()).get("origin") ??
    "http://localhost:3000"
  const emailRedirectTo = `${origin}/auth/callback`

  const { data: signUpData, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo },
  })

  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      return { error: "An account with this email already exists. Please sign in." }
    }
    return { error: error.message }
  }

  if (!signUpData.session) {
    // Email confirmation required — session will be established when they click the link
    const verifyUrl = `/login?tab=verify&email=${encodeURIComponent(parsed.data.email)}`
    redirect(verifyUrl)
  }

  // Auto-confirmed (email confirmation disabled) — session already set in cookies
  if (guestUserId && signUpData.user && signUpData.user.id !== guestUserId) {
    await transferGuestRuns(guestUserId, signUpData.user.id)
  }

  redirect("/dashboard")
}

// ─── Sign Out ────────────────────────────────────────────────────────────────

export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}

// ─── Resend Verification Email ────────────────────────────────────────────────

export async function resendVerificationAction(
  _prev: ResendState,
  formData: FormData
): Promise<ResendState> {
  const email = String(formData.get("email") ?? "").trim()
  if (!email) {
    return { error: "Email address is required." }
  }

  const headersList = await headers()
  const ip = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  const { allowed, error: rateLimitError } = await checkAccountCreationRateLimit(ip)
  if (!allowed) {
    return { error: rateLimitError ?? "Rate limit exceeded. Try again later." }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resend({ type: "signup", email })

  if (error) {
    return { error: error.message }
  }

  return { success: true }
}
